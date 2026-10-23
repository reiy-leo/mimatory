//! Mimatory as a WebAuthn authenticator for the browser extension (owner 2026-10-18: "完整passkey支持").
//!
//! The extension hands a site's `navigator.credentials.create()` / `.get()` to the bridge after the user
//! picked Mimatory in its prompt. A registration mints a P-256 key (ES256, the one algorithm every relying
//! party accepts) and answers with "none" attestation; the private key is stored in the item's encrypted
//! custom fields as a `passkey_credential` field and never leaves the app — the extension only ever sees
//! public data and signatures. A sign-in signs `authenticatorData || SHA-256(clientDataJSON)`.
//!
//! The flags claim user presence and verification (the vault is unlocked and the user clicked in the
//! prompt) and backup eligibility/state (the vault is synced like any item), the same as other password
//! managers' passkeys. The signature counter stays 0, as the spec allows for synced credentials.

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey, VerifyingKey};
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::site_match::parse_site;
use crate::vault::CustomField;

pub const PASSKEY_CREDENTIAL_FIELD: &str = "passkey_credential";
/// COSE algorithm ES256.
pub const ES256: i64 = -7;

const FLAG_UP: u8 = 0x01;
const FLAG_UV: u8 = 0x04;
const FLAG_BE: u8 = 0x08;
const FLAG_BS: u8 = 0x10;
const FLAG_AT: u8 = 0x40;

/// What the vault keeps for one passkey, as JSON in a `passkey_credential` field labelled by its RP ID.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct StoredPasskey {
    pub credential_id: String,
    pub rp_id: String,
    pub user_handle: String,
    pub user_name: String,
    #[serde(default)]
    pub user_display_name: String,
    /// PKCS#8 DER, base64.
    pub private_key: String,
    #[serde(default)]
    pub created_at: String,
}

impl StoredPasskey {
    pub fn to_field(&self) -> CustomField {
        CustomField {
            label: self.rp_id.clone(),
            value: serde_json::to_string(self).unwrap_or_default(),
            field_type: PASSKEY_CREDENTIAL_FIELD.to_string(),
        }
    }

    pub fn from_field(field: &CustomField) -> Option<Self> {
        if field.field_type != PASSKEY_CREDENTIAL_FIELD {
            return None;
        }
        serde_json::from_str(&field.value).ok()
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PasskeyError {
    #[error("this page may not use that relying party ID")]
    RpIdMismatch,
    #[error("passkeys need a secure (https) page")]
    InsecureOrigin,
    #[error("only ES256 passkeys are supported")]
    UnsupportedAlgorithm,
    #[error("invalid base64url value")]
    BadEncoding,
    #[error("the stored passkey key is unreadable")]
    BadKey,
}

/// The RP ID a page may use: its own host or a parent of it that is not a public suffix, on https
/// (or http://localhost, which browsers treat as secure).
pub fn check_rp_id(origin: &str, rp_id: &str) -> Result<String, PasskeyError> {
    let url = url::Url::parse(origin).map_err(|_| PasskeyError::RpIdMismatch)?;
    let site = parse_site(origin).ok_or(PasskeyError::RpIdMismatch)?;
    let localhost = site.host == "localhost" || site.host.ends_with(".localhost");
    if url.scheme() != "https" && !(url.scheme() == "http" && localhost) {
        return Err(PasskeyError::InsecureOrigin);
    }
    let rp = rp_id.trim().trim_end_matches('.').to_ascii_lowercase();
    let rp = if rp.is_empty() { site.host.clone() } else { rp };
    if site.is_ip {
        return if rp == site.host { Ok(rp) } else { Err(PasskeyError::RpIdMismatch) };
    }
    let fits = site.host == rp || site.host.ends_with(&format!(".{rp}"));
    let registrable = localhost || psl::domain_str(&rp).is_some();
    if fits && registrable {
        Ok(rp)
    } else {
        Err(PasskeyError::RpIdMismatch)
    }
}

pub fn b64url_decode(value: &str) -> Result<Vec<u8>, PasskeyError> {
    URL_SAFE_NO_PAD
        .decode(value.trim().trim_end_matches('='))
        .map_err(|_| PasskeyError::BadEncoding)
}

pub fn b64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// The JSON the browser itself would have produced for this ceremony; the RP checks its type,
/// challenge and origin, and the signature covers its hash.
pub fn client_data_json(kind: &str, challenge: &str, origin: &str) -> String {
    format!(
        "{{\"type\":{},\"challenge\":{},\"origin\":{},\"crossOrigin\":false}}",
        serde_json::to_string(kind).unwrap_or_default(),
        serde_json::to_string(challenge.trim_end_matches('=')).unwrap_or_default(),
        serde_json::to_string(origin.trim_end_matches('/')).unwrap_or_default(),
    )
}

fn rp_id_hash(rp_id: &str) -> [u8; 32] {
    Sha256::digest(rp_id.as_bytes()).into()
}

// ── Minimal canonical CBOR (just what attestation objects and COSE keys need) ─────────────────────────

fn cbor_head(out: &mut Vec<u8>, major: u8, value: u64) {
    let major = major << 5;
    match value {
        0..=23 => out.push(major | value as u8),
        24..=0xff => out.extend([major | 24, value as u8]),
        0x100..=0xffff => {
            out.push(major | 25);
            out.extend((value as u16).to_be_bytes());
        }
        _ => {
            out.push(major | 26);
            out.extend((value as u32).to_be_bytes());
        }
    }
}

fn cbor_int(out: &mut Vec<u8>, value: i64) {
    if value >= 0 {
        cbor_head(out, 0, value as u64);
    } else {
        cbor_head(out, 1, (-1 - value) as u64);
    }
}

fn cbor_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    cbor_head(out, 2, bytes.len() as u64);
    out.extend_from_slice(bytes);
}

fn cbor_text(out: &mut Vec<u8>, text: &str) {
    cbor_head(out, 3, text.len() as u64);
    out.extend_from_slice(text.as_bytes());
}

/// COSE_Key for an EC2 P-256 public key: {1: 2, 3: -7, -1: 1, -2: x, -3: y}.
fn cose_public_key(key: &VerifyingKey) -> Vec<u8> {
    let point = key.to_encoded_point(false);
    let mut out = Vec::new();
    cbor_head(&mut out, 5, 5);
    cbor_int(&mut out, 1);
    cbor_int(&mut out, 2);
    cbor_int(&mut out, 3);
    cbor_int(&mut out, ES256);
    cbor_int(&mut out, -1);
    cbor_int(&mut out, 1);
    cbor_int(&mut out, -2);
    cbor_bytes(&mut out, point.x().map(|x| x.as_slice()).unwrap_or_default());
    cbor_int(&mut out, -3);
    cbor_bytes(&mut out, point.y().map(|y| y.as_slice()).unwrap_or_default());
    out
}

/// What a registration returns to the page, every binary value base64url.
#[derive(Debug, Serialize)]
pub struct Registration {
    pub credential_id: String,
    pub client_data_json: String,
    pub attestation_object: String,
    pub authenticator_data: String,
    pub public_key: String,
    pub public_key_algorithm: i64,
    pub transports: Vec<&'static str>,
}

/// What a sign-in returns to the page, every binary value base64url.
#[derive(Debug, Serialize)]
pub struct Assertion {
    pub credential_id: String,
    pub client_data_json: String,
    pub authenticator_data: String,
    pub signature: String,
    pub user_handle: String,
}

pub struct NewPasskey {
    pub stored: StoredPasskey,
    pub registration: Registration,
}

pub struct CreateRequest<'a> {
    pub origin: &'a str,
    pub rp_id: &'a str,
    pub challenge: &'a str,
    pub user_handle: &'a str,
    pub user_name: &'a str,
    pub user_display_name: &'a str,
    pub algorithms: &'a [i64],
}

pub fn create(request: &CreateRequest) -> Result<NewPasskey, PasskeyError> {
    let rp_id = check_rp_id(request.origin, request.rp_id)?;
    if !request.algorithms.is_empty() && !request.algorithms.contains(&ES256) {
        return Err(PasskeyError::UnsupportedAlgorithm);
    }
    b64url_decode(request.challenge)?;
    b64url_decode(request.user_handle)?;

    let signing_key = SigningKey::random(&mut OsRng);
    let verifying_key = VerifyingKey::from(&signing_key);
    let mut credential_id = [0_u8; 16];
    OsRng.fill_bytes(&mut credential_id);

    let mut auth_data = Vec::with_capacity(160);
    auth_data.extend(rp_id_hash(&rp_id));
    auth_data.push(FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | FLAG_AT);
    auth_data.extend(0_u32.to_be_bytes());
    auth_data.extend([0_u8; 16]); // AAGUID: none attestation
    auth_data.extend((credential_id.len() as u16).to_be_bytes());
    auth_data.extend(credential_id);
    auth_data.extend(cose_public_key(&verifying_key));

    let mut attestation = Vec::with_capacity(auth_data.len() + 32);
    cbor_head(&mut attestation, 5, 3);
    cbor_text(&mut attestation, "fmt");
    cbor_text(&mut attestation, "none");
    cbor_text(&mut attestation, "attStmt");
    cbor_head(&mut attestation, 5, 0);
    cbor_text(&mut attestation, "authData");
    cbor_bytes(&mut attestation, &auth_data);

    let private_key = signing_key.to_pkcs8_der().map_err(|_| PasskeyError::BadKey)?;
    let public_key = verifying_key.to_public_key_der().map_err(|_| PasskeyError::BadKey)?;
    let client_data = client_data_json("webauthn.create", request.challenge, request.origin);

    Ok(NewPasskey {
        stored: StoredPasskey {
            credential_id: b64url(&credential_id),
            rp_id,
            user_handle: request.user_handle.trim_end_matches('=').to_string(),
            user_name: request.user_name.to_string(),
            user_display_name: request.user_display_name.to_string(),
            private_key: STANDARD.encode(private_key.as_bytes()),
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        registration: Registration {
            credential_id: b64url(&credential_id),
            client_data_json: b64url(client_data.as_bytes()),
            attestation_object: b64url(&attestation),
            authenticator_data: b64url(&auth_data),
            public_key: b64url(public_key.as_bytes()),
            public_key_algorithm: ES256,
            transports: vec!["hybrid", "internal"],
        },
    })
}

pub fn assert(
    stored: &StoredPasskey,
    origin: &str,
    rp_id: &str,
    challenge: &str,
) -> Result<Assertion, PasskeyError> {
    let rp_id = check_rp_id(origin, rp_id)?;
    if rp_id != stored.rp_id {
        return Err(PasskeyError::RpIdMismatch);
    }
    b64url_decode(challenge)?;
    let der = STANDARD.decode(&stored.private_key).map_err(|_| PasskeyError::BadKey)?;
    let signing_key = SigningKey::from_pkcs8_der(&der).map_err(|_| PasskeyError::BadKey)?;

    let mut auth_data = Vec::with_capacity(37);
    auth_data.extend(rp_id_hash(&rp_id));
    auth_data.push(FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS);
    auth_data.extend(0_u32.to_be_bytes());

    let client_data = client_data_json("webauthn.get", challenge, origin);
    let mut signed = auth_data.clone();
    signed.extend(Sha256::digest(client_data.as_bytes()));
    let signature: Signature = signing_key.sign(&signed);

    Ok(Assertion {
        credential_id: stored.credential_id.clone(),
        client_data_json: b64url(client_data.as_bytes()),
        authenticator_data: b64url(&auth_data),
        signature: b64url(signature.to_der().as_bytes()),
        user_handle: stored.user_handle.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::Verifier;
    use p256::pkcs8::DecodePublicKey;

    fn request<'a>(origin: &'a str, rp_id: &'a str) -> CreateRequest<'a> {
        CreateRequest {
            origin,
            rp_id,
            challenge: "Y2hhbGxlbmdl",
            user_handle: "dXNlci0x",
            user_name: "rei@example.com",
            user_display_name: "Rei",
            algorithms: &[-8, ES256, -257],
        }
    }

    #[test]
    fn rp_ids_are_the_page_or_a_registrable_parent() {
        assert_eq!(check_rp_id("https://login.example.com", "example.com").as_deref(), Ok("example.com"));
        assert_eq!(check_rp_id("https://example.com", "").as_deref(), Ok("example.com"));
        assert_eq!(check_rp_id("https://example.com", "other.com"), Err(PasskeyError::RpIdMismatch));
        assert_eq!(check_rp_id("https://a.github.io", "github.io"), Err(PasskeyError::RpIdMismatch));
        assert_eq!(check_rp_id("https://example.co.uk", "co.uk"), Err(PasskeyError::RpIdMismatch));
        assert_eq!(check_rp_id("http://example.com", "example.com"), Err(PasskeyError::InsecureOrigin));
        assert_eq!(check_rp_id("http://localhost:3000", "localhost").as_deref(), Ok("localhost"));
    }

    #[test]
    fn a_registration_and_sign_in_verify_with_the_published_key() {
        let created = create(&request("https://login.example.com", "example.com")).expect("create");
        let attestation = b64url_decode(&created.registration.attestation_object).unwrap();
        assert_eq!(&attestation[..4], &[0xa3, 0x63, b'f', b'm']);
        let auth_data = b64url_decode(&created.registration.authenticator_data).unwrap();
        assert_eq!(&auth_data[..32], Sha256::digest(b"example.com").as_slice());
        assert_eq!(auth_data[32], 0x5d);
        let client: serde_json::Value =
            serde_json::from_slice(&b64url_decode(&created.registration.client_data_json).unwrap()).unwrap();
        assert_eq!(client["type"], "webauthn.create");
        assert_eq!(client["origin"], "https://login.example.com");

        let round_trip = StoredPasskey::from_field(&created.stored.to_field()).expect("field");
        assert_eq!(round_trip, created.stored);

        let assertion = assert(&round_trip, "https://example.com", "example.com", "bmV3LWNoYWxsZW5nZQ").expect("assert");
        let public_key =
            VerifyingKey::from_public_key_der(&b64url_decode(&created.registration.public_key).unwrap()).unwrap();
        let mut signed = b64url_decode(&assertion.authenticator_data).unwrap();
        signed.extend(Sha256::digest(b64url_decode(&assertion.client_data_json).unwrap()));
        let signature = Signature::from_der(&b64url_decode(&assertion.signature).unwrap()).unwrap();
        assert!(public_key.verify(&signed, &signature).is_ok());
        assert_eq!(assertion.user_handle, "dXNlci0x");
    }

    #[test]
    fn a_sign_in_for_another_relying_party_is_refused() {
        let created = create(&request("https://example.com", "example.com")).expect("create");
        assert!(assert(&created.stored, "https://evil.com", "evil.com", "Y2g").is_err());
        assert!(create(&CreateRequest { algorithms: &[-257], ..request("https://example.com", "") }).is_err());
    }
}
