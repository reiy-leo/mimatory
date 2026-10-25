//! 1Password's `.1pux` export (File ▸ Import ▸ 1Password). A `.1pux` is a zip holding `export.data` (JSON:
//! accounts → vaults → items) and `files/<documentId>__<name>` for attachments. Nothing in it is encrypted.
//!
//! Every 1Password vault lands in the Mimatory vault of the same name, created when there is none. Items keep
//! their category where Mimatory has one (the rest become Secure Notes), their template fields where the two
//! line up (stored with the template `key`, so they read exactly like fields typed here), and everything else as
//! labelled custom fields or sections. Archived items stay archived; items in 1Password's trash are skipped.
//! Passkeys are not in a desktop `.1pux` at all (1Password exports them only through CXP on iOS/Android).

#[cfg(test)]
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;
use zip::ZipArchive;

use crate::site_match;
use crate::vault::{CustomField, ItemUrl, LoginItemInput, Session, VaultError, VaultService};

#[derive(Debug, Error)]
pub enum Import1PuxError {
    #[error("could not read the file: {0}")]
    Io(#[from] std::io::Error),
    #[error("not a 1Password export (.1pux): {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("the export's data is not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("this file has no export.data, so it is not a 1Password export")]
    NoData,
    #[error(transparent)]
    Vault(#[from] VaultError),
}

impl From<Import1PuxError> for String {
    fn from(error: Import1PuxError) -> Self {
        match error {
            Import1PuxError::Vault(error) => String::from(error),
            other => other.to_string(),
        }
    }
}

/// What the confirmation sheet shows before anything is written.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ImportPreview {
    pub path: String,
    pub vaults: Vec<PreviewVault>,
    pub item_count: usize,
    pub attachment_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PreviewVault {
    pub name: String,
    pub item_count: usize,
    /// A Mimatory vault of this name exists already, so the items go there instead of a new vault.
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct ImportSummary {
    pub item_count: usize,
    pub vaults_created: usize,
    pub attachment_count: usize,
    pub archived_count: usize,
}

#[derive(Debug, Clone)]
struct ParsedVault {
    name: String,
    items: Vec<ParsedItem>,
}

#[derive(Debug, Clone)]
struct ParsedItem {
    /// The item's 1Password uuid, so another item's "Sign in with" can find it after import.
    uuid: String,
    /// The 1Password uuid of the account this item signs in with (its `ssoLogin.item`).
    sign_in_ref: Option<String>,
    /// 1Password uuids of this item's "Related Items" (fields whose value is `{"reference": …}`).
    related_refs: Vec<String>,
    input: LoginItemInput,
    archived: bool,
    created_at: Option<i64>,
    updated_at: Option<i64>,
    /// (zip entry name, file name shown in Mimatory).
    attachments: Vec<(String, String)>,
}

pub fn preview(path: &Path, service: &VaultService, session: &Session) -> Result<ImportPreview, Import1PuxError> {
    let (vaults, _) = read_export(path)?;
    let existing = service.list_vaults(session)?;
    let preview_vaults = vaults
        .iter()
        .map(|vault| PreviewVault {
            name: vault.name.clone(),
            item_count: vault.items.len(),
            exists: existing
                .iter()
                .any(|known| !known.archived && known.name.eq_ignore_ascii_case(&vault.name)),
        })
        .collect::<Vec<_>>();
    Ok(ImportPreview {
        path: path.to_string_lossy().to_string(),
        item_count: vaults.iter().map(|vault| vault.items.len()).sum(),
        attachment_count: vaults
            .iter()
            .flat_map(|vault| vault.items.iter())
            .map(|item| item.attachments.len())
            .sum(),
        vaults: preview_vaults,
    })
}

pub fn import(path: &Path, service: &mut VaultService, session: &Session) -> Result<ImportSummary, Import1PuxError> {
    let (vaults, mut archive) = read_export(path)?;
    let mut summary = ImportSummary::default();
    // 1Password uuid → (Mimatory vault, Mimatory item id), and the sign-in links to make once every
    // item exists: an account can come after the item that signs in with it.
    let mut imported: HashMap<String, (String, String)> = HashMap::new();
    let mut sign_in_links: Vec<(String, String, String)> = Vec::new();
    let mut related_links: Vec<(String, String, String)> = Vec::new();
    for vault in vaults {
        if vault.items.is_empty() {
            continue;
        }
        let known = service
            .list_vaults(session)?
            .into_iter()
            .find(|known| !known.archived && known.name.eq_ignore_ascii_case(&vault.name));
        let vault_id = match known {
            Some(known) => known.id,
            None => {
                summary.vaults_created += 1;
                service.create_vault(session, &vault.name)?.id
            }
        };
        let target = session.for_vault(&vault_id);
        for item in vault.items {
            let created = service.create_login_item(&target, item.input.clone())?;
            if !item.uuid.is_empty() {
                imported.insert(item.uuid.clone(), (vault_id.clone(), created.id.clone()));
            }
            if let Some(reference) = &item.sign_in_ref {
                sign_in_links.push((vault_id.clone(), created.id.clone(), reference.clone()));
            }
            for reference in &item.related_refs {
                related_links.push((vault_id.clone(), created.id.clone(), reference.clone()));
            }
            let mut files = Vec::new();
            for (entry, name) in &item.attachments {
                let Ok(mut file) = archive.by_name(entry) else { continue };
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes)?;
                files.push(service.add_attachment_bytes(&target, &created.id, name, &bytes)?);
            }
            summary.attachment_count += files.len();
            let mut input = item.input;
            input.custom_fields.extend(files);
            service.finish_imported_item(
                &target,
                &created.id,
                &input,
                item.created_at.and_then(rfc3339),
                item.updated_at.and_then(rfc3339),
                item.archived,
            )?;
            summary.item_count += 1;
            if item.archived {
                summary.archived_count += 1;
            }
        }
    }
    // A Mimatory link stays inside one vault, so an account 1Password keeps in another vault leaves
    // the item with its provider only — the same as a hand-made "Sign in with" with no account.
    for (vault_id, item_id, reference) in sign_in_links {
        let Some((account_vault, account_id)) = imported.get(&reference) else { continue };
        if *account_vault != vault_id {
            continue;
        }
        let _ = service.set_item_sign_in(&session.for_vault(&vault_id), &item_id, Some(account_id));
    }
    // 1Password "Related Items" become peer links. Links stay inside one vault, so a related item
    // 1Password keeps in another vault (or one left out of the export) is skipped.
    for (vault_id, item_id, reference) in related_links {
        let Some((other_vault, other_id)) = imported.get(&reference) else { continue };
        if *other_vault != vault_id || *other_id == item_id {
            continue;
        }
        let _ = service.link_related_items(&session.for_vault(&vault_id), &item_id, other_id);
    }
    Ok(summary)
}

fn rfc3339(seconds: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(seconds, 0).map(|stamp| stamp.to_rfc3339())
}

fn read_export(path: &Path) -> Result<(Vec<ParsedVault>, ZipArchive<File>), Import1PuxError> {
    let mut archive = ZipArchive::new(File::open(path)?)?;
    let data: Value = {
        let mut entry = archive.by_name("export.data").map_err(|_| Import1PuxError::NoData)?;
        let mut contents = String::new();
        entry.read_to_string(&mut contents)?;
        serde_json::from_str(&contents)?
    };
    let names = archive.file_names().map(str::to_string).collect::<Vec<_>>();
    Ok((parse_export(&data, &names), archive))
}

fn parse_export(data: &Value, zip_names: &[String]) -> Vec<ParsedVault> {
    let mut vaults: Vec<ParsedVault> = Vec::new();
    for account in array(data, "accounts") {
        for vault in array(account, "vaults") {
            let name = text(&vault["attrs"], "name");
            let name = if name.trim().is_empty() { "1Password".to_string() } else { name };
            let items = array(vault, "items")
                .iter()
                .filter_map(|item| parse_item(item, zip_names))
                .collect::<Vec<_>>();
            // Two accounts with a "Personal" vault each end up in one Mimatory vault, as the import would anyway.
            match vaults.iter_mut().find(|known| known.name.eq_ignore_ascii_case(&name)) {
                Some(known) => known.items.extend(items),
                None => vaults.push(ParsedVault { name, items }),
            }
        }
    }
    vaults
}

fn array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn text(value: &Value, key: &str) -> String {
    match value.get(key) {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.to_string(),
        _ => String::new(),
    }
}

/// 1Password's category UUIDs, mapped to the Mimatory item type. Categories Mimatory has no template for become
/// Secure Notes, their fields kept as sections.
fn item_type_for(category: &str) -> &'static str {
    match category {
        "001" => "login",
        "002" => "credit_card",
        "004" => "identity",
        "005" => "password",
        "100" => "software_license",
        "101" => "bank_account",
        "102" => "database",
        "103" => "driver_license",
        "106" => "passport",
        "109" => "router",
        "110" => "server",
        "111" => "email",
        "112" => "api_credential",
        "114" => "ssh_key",
        "115" => "crypto_wallet",
        // 003 Secure Note, 006 Document, 104 Outdoor License, 105 Membership, 107 Reward Program,
        // 108 Social Security Number, 113 Medical Record, and anything newer.
        _ => "secure_note",
    }
}

/// Where a 1Password field goes on the Mimatory side.
enum Target {
    Username,
    Password,
    /// (template section key, template field key, Mimatory field type)
    Template(&'static str, &'static str, &'static str),
}

fn target_for(item_type: &str, field_id: &str) -> Option<Target> {
    use Target::{Password, Template as T, Username};
    let id = field_id.to_ascii_lowercase();
    Some(match (item_type, id.as_str()) {
        ("credit_card", "cardholder") => T("card", "cardholder", "text"),
        ("credit_card", "type") => T("card", "brand", "select"),
        ("credit_card", "ccnum") => T("card", "number", "card_number"),
        ("credit_card", "expiry") => T("card", "expiry", "month_year"),
        ("credit_card", "validfrom") => T("card", "validFrom", "month_year"),
        ("credit_card", "cvv") => T("card", "cvv", "concealed"),
        ("credit_card", "pin") => T("card", "pin", "concealed"),
        ("credit_card", "bank") => T("issuer", "issuingBank", "text"),
        ("credit_card", "phonelocal" | "phonetollfree" | "phoneintl") => T("issuer", "issuerPhone", "phone"),
        ("credit_card", "website") => T("issuer", "issuerWebsite", "url"),
        ("identity", "firstname") => T("identification", "firstName", "text"),
        ("identity", "initial") => T("identification", "middleName", "text"),
        ("identity", "lastname") => T("identification", "lastName", "text"),
        ("identity", "sex") => T("identification", "gender", "select"),
        ("identity", "birthdate") => T("identification", "birthDate", "date"),
        ("identity", "email") => T("contact", "email", "email"),
        ("identity", "defphone" | "cellphone" | "homephone") => T("contact", "phone", "phone"),
        ("identity", "address") => T("contact", "address", "address"),
        ("identity", "company") => T("work", "company", "text"),
        ("identity", "jobtitle") => T("work", "jobTitle", "text"),
        ("software_license", "reg_code") => T("license", "licenseKey", "concealed"),
        ("software_license", "product_version") => T("license", "version", "text"),
        ("software_license", "reg_name") => T("license", "issuedTo", "text"),
        ("software_license", "reg_email") => T("license", "registeredEmail", "email"),
        ("software_license", "company") => T("license", "company", "text"),
        ("software_license", "download_link") => T("license", "downloadPage", "url"),
        ("software_license", "order_date") => T("license", "purchaseDate", "date"),
        ("software_license", "order_number") => T("license", "orderNumber", "text"),
        ("software_license", "expiry_date") => T("license", "expiryDate", "date"),
        ("bank_account", "bankname") => T("account", "bankName", "text"),
        ("bank_account", "owner") => T("account", "accountHolder", "text"),
        ("bank_account", "accounttype") => T("account", "accountType", "select"),
        ("bank_account", "accountno") => T("account", "accountNumber", "concealed"),
        ("bank_account", "routingno") => T("account", "routingNumber", "text"),
        ("bank_account", "swift") => T("account", "swift", "text"),
        ("bank_account", "iban") => T("account", "iban", "text"),
        ("bank_account", "telephonepin") => T("account", "pin", "concealed"),
        ("bank_account", "branchphone") => T("branch", "branchPhone", "phone"),
        ("bank_account", "branchaddress") => T("branch", "branchAddress", "address"),
        ("database", "database_type") => T("connection", "databaseType", "select"),
        ("database", "hostname") => T("connection", "server", "text"),
        ("database", "port") => T("connection", "port", "text"),
        ("database", "database") => T("connection", "database", "text"),
        ("database", "options") => T("connection", "connectionOptions", "text"),
        ("driver_license", "fullname") => T("license", "fullName", "text"),
        ("driver_license", "number") => T("license", "number", "text"),
        ("driver_license", "class") => T("license", "class", "text"),
        ("driver_license", "state") => T("license", "region", "text"),
        ("driver_license", "country") => T("license", "country", "text"),
        ("driver_license", "expiry_date") => T("license", "expiryDate", "date"),
        ("driver_license", "birthdate") => T("license", "birthDate", "date"),
        ("driver_license", "address") => T("license", "address", "address"),
        ("passport", "type") => T("passport", "type", "select"),
        ("passport", "issuing_country") => T("passport", "issuingCountry", "text"),
        ("passport", "number") => T("passport", "number", "text"),
        ("passport", "fullname") => T("passport", "fullName", "text"),
        ("passport", "sex") => T("passport", "sex", "select"),
        ("passport", "nationality") => T("passport", "nationality", "text"),
        ("passport", "birthdate") => T("passport", "birthDate", "date"),
        ("passport", "birthplace") => T("passport", "birthPlace", "text"),
        ("passport", "issue_date") => T("passport", "issueDate", "date"),
        ("passport", "expiry_date") => T("passport", "expiryDate", "date"),
        ("passport", "issuing_authority") => T("passport", "authority", "text"),
        ("router", "name") => T("baseStation", "baseStationName", "text"),
        ("router", "password") => T("baseStation", "baseStationPassword", "password"),
        ("router", "server") => T("baseStation", "serverIp", "text"),
        ("router", "network_name") => T("wireless", "networkName", "text"),
        ("router", "security") => T("wireless", "wirelessSecurity", "select"),
        ("router", "wireless_password") => T("wireless", "wirelessPassword", "password"),
        ("server", "url") => T("server", "url", "url"),
        ("server", "admin_console_url") => T("server", "adminConsoleUrl", "url"),
        ("server", "name") => T("server", "hostingProvider", "text"),
        ("email", "pop_type") => T("incoming", "serverType", "select"),
        ("email", "pop_server") => T("incoming", "server", "text"),
        ("email", "pop_port") => T("incoming", "port", "text"),
        ("email", "pop_security") => T("incoming", "security", "select"),
        ("email", "smtp_server") => T("outgoing", "smtpServer", "text"),
        ("email", "smtp_port") => T("outgoing", "smtpPort", "text"),
        ("email", "smtp_security") => T("outgoing", "smtpSecurity", "select"),
        ("email", "pop_username") => Username,
        ("email", "pop_password") => Password,
        ("api_credential", "type") => T("details", "type", "text"),
        ("api_credential", "hostname") => T("details", "hostname", "text"),
        ("api_credential", "validfrom") => T("details", "validFrom", "date"),
        ("api_credential", "expires") => T("details", "expires", "date"),
        ("api_credential", "credential") => Password,
        ("ssh_key", "private_key") => T("key", "privateKey", "concealed_multiline"),
        ("ssh_key", "passphrase") => T("key", "passphrase", "password"),
        ("crypto_wallet", "recoveryphrase") => T("wallet", "recoveryPhrase", "concealed_multiline"),
        ("crypto_wallet", "password") => T("wallet", "walletPassword", "password"),
        ("crypto_wallet", "walletaddress") => T("wallet", "walletAddress", "text"),
        ("crypto_wallet", "network") => T("wallet", "network", "text"),
        ("api_credential" | "database" | "server" | "password", "username") => Username,
        ("api_credential" | "database" | "server" | "password", "password") => Password,
        _ => return None,
    })
}

/// A 1Password field value (`{"<kind>": …}`), as the Mimatory field type and the string Mimatory stores.
fn field_value(value: &Value) -> Option<(&'static str, String)> {
    let (kind, inner) = value.as_object()?.iter().next()?;
    let plain = || match inner {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        _ => String::new(),
    };
    Some(match kind.as_str() {
        "concealed" => ("concealed", plain()),
        "totp" => ("otp", normalize_otp(&plain())),
        "email" => ("email", inner.get("email_address").map(|_| text(inner, "email_address")).unwrap_or_else(plain)),
        "url" => ("url", plain()),
        "phone" => ("phone", plain()),
        "date" => ("date", inner.as_i64().and_then(iso_date).unwrap_or_else(plain)),
        "monthYear" => ("month_year", inner.as_i64().map(month_year).unwrap_or_else(plain)),
        "creditCardNumber" => ("card_number", plain()),
        "creditCardType" => ("select", card_brand(&plain())),
        "address" => ("address", address(inner)),
        "sshKey" => ("concealed_multiline", text(inner, "privateKey")),
        "file" | "reference" => return None,
        "string" | "menu" | "gender" => ("text", plain()),
        _ => ("text", plain()),
    })
}

fn iso_date(seconds: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(seconds, 0).map(|stamp| stamp.format("%Y-%m-%d").to_string())
}

/// 1Password packs a month/year as `YYYYMM`.
fn month_year(packed: i64) -> String {
    format!("{:04}-{:02}", packed / 100, packed % 100)
}

fn card_brand(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "mc" | "mastercard" => "mastercard".to_string(),
        "amex" | "american express" => "amex".to_string(),
        "diners" | "dinersclub" => "diners".to_string(),
        other => other.to_string(),
    }
}

fn address(value: &Value) -> String {
    let line2 = [text(value, "city"), text(value, "state"), text(value, "zip")]
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    [text(value, "street"), line2, text(value, "country")]
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// What the OTP editor stores: the bare base32 key. An `otpauth://` link gives up its `secret`.
fn normalize_otp(value: &str) -> String {
    let trimmed = value.trim();
    let secret = if trimmed.to_ascii_lowercase().starts_with("otpauth://") {
        url::Url::parse(trimmed)
            .ok()
            .and_then(|link| link.query_pairs().find(|(key, _)| key == "secret").map(|(_, v)| v.to_string()))
            .unwrap_or_else(|| trimmed.to_string())
    } else {
        trimmed.to_string()
    };
    secret
        .chars()
        .filter(|character| !character.is_whitespace() && *character != '=' && *character != '-')
        .collect::<String>()
        .to_ascii_uppercase()
}

fn url_mode(mode: &str) -> String {
    match mode {
        "exact" => site_match::MODE_EXACT,
        "never" => site_match::MODE_NEVER,
        _ => site_match::MODE_DOMAIN,
    }
    .to_string()
}

fn child(field_type: &str, key: Option<&str>, label: &str, value: String) -> Value {
    let mut map = serde_json::Map::new();
    map.insert("field_type".into(), Value::String(field_type.to_string()));
    map.insert("id".into(), Value::String(Uuid::new_v4().to_string()));
    if let Some(key) = key {
        map.insert("key".into(), Value::String(key.to_string()));
    }
    map.insert("label".into(), Value::String(label.to_string()));
    map.insert("value".into(), Value::String(value));
    Value::Object(map)
}

fn section_field(label: &str, children: Vec<Value>) -> CustomField {
    CustomField {
        label: label.to_string(),
        value: Value::Array(children).to_string(),
        field_type: "section".to_string(),
    }
}

fn file_entry(zip_names: &[String], document_id: &str, file_name: &str) -> Option<String> {
    if document_id.is_empty() {
        return None;
    }
    let prefix = format!("files/{document_id}");
    zip_names
        .iter()
        .find(|name| name.starts_with(&prefix))
        .or_else(|| zip_names.iter().find(|name| name.starts_with("files/") && name.ends_with(file_name) && !file_name.is_empty()))
        .cloned()
}

fn parse_item(item: &Value, zip_names: &[String]) -> Option<ParsedItem> {
    let state = text(item, "state");
    if state == "deleted" || state == "trashed" {
        return None;
    }
    let category = text(item, "categoryUuid");
    let item_type = item_type_for(&category);
    let overview = &item["overview"];
    let details = &item["details"];

    let title = text(overview, "title");
    let mut input = LoginItemInput {
        item_type: item_type.to_string(),
        title: if title.trim().is_empty() { "Untitled".to_string() } else { title },
        username: String::new(),
        password: String::new(),
        website: String::new(),
        urls: Vec::new(),
        notes: text(details, "notesPlain"),
        tags: array(overview, "tags").iter().filter_map(Value::as_str).map(str::to_string).collect(),
        custom_fields: Vec::new(),
        favorite: item.get("favIndex").and_then(Value::as_i64).unwrap_or(0) > 0,
    };

    for url in array(overview, "urls") {
        let address = text(url, "url");
        if address.trim().is_empty() || input.urls.iter().any(|known| known.url == address) {
            continue;
        }
        let label = text(url, "label");
        input.urls.push(ItemUrl {
            label: if label.trim().is_empty() { "website".to_string() } else { label },
            url: address,
            match_type: url_mode(&text(url, "mode")),
        });
    }
    let primary = text(overview, "url");
    if !primary.trim().is_empty() && !input.urls.iter().any(|known| known.url == primary) {
        input.urls.insert(
            0,
            ItemUrl { label: "website".to_string(), url: primary, match_type: site_match::MODE_DOMAIN.to_string() },
        );
    }
    input.website = input.urls.first().map(|url| url.url.clone()).unwrap_or_default();

    for field in array(details, "loginFields") {
        let value = text(field, "value");
        match text(field, "designation").as_str() {
            "username" if input.username.is_empty() => input.username = value,
            "password" if input.password.is_empty() => input.password = value,
            _ => {}
        }
    }
    if input.password.is_empty() {
        input.password = text(details, "password");
    }

    let mut otp_fields = Vec::new();
    let mut top_fields = Vec::new();
    // Template children grouped by template section key, in first-seen order.
    let mut template_sections: Vec<(&'static str, Vec<Value>)> = Vec::new();
    let mut other_sections = Vec::new();
    let mut attachments = Vec::new();
    let mut ssh_public_key = String::new();
    let mut sign_in_field: Option<CustomField> = None;
    let mut sign_in_ref = None;
    let mut related_refs: Vec<String> = Vec::new();

    if let Some(document) = details.get("documentAttributes") {
        let name = text(document, "fileName");
        if let Some(entry) = file_entry(zip_names, &text(document, "documentId"), &name) {
            attachments.push((entry, if name.is_empty() { "attachment".to_string() } else { name }));
        }
    }

    for section in array(details, "sections") {
        let section_title = text(section, "title");
        let mut loose = Vec::new();
        for field in array(section, "fields") {
            let value = &field["value"];
            if let Some(file) = value.get("file") {
                let name = text(file, "fileName");
                if let Some(entry) = file_entry(zip_names, &text(file, "documentId"), &name) {
                    attachments.push((entry, if name.is_empty() { "attachment".to_string() } else { name }));
                }
                continue;
            }
            // "Sign in with": `{"ssoLogin": {"provider": "github", "item": {"vaultUuid", "itemUuid"}}}`.
            if let Some(sso) = value.get("ssoLogin") {
                let provider = text(sso, "provider").trim().to_lowercase();
                if sign_in_field.is_none() && !provider.is_empty() {
                    sign_in_field = Some(CustomField {
                        label: String::new(),
                        value: provider,
                        field_type: "sign_in_with".to_string(),
                    });
                    let reference = text(&sso["item"], "itemUuid");
                    if !reference.trim().is_empty() {
                        sign_in_ref = Some(reference);
                    }
                }
                continue;
            }
            // "Related Items": `{"reference": "<item uuid>"}` (older exports nest it as `{"itemUuid": …}`).
            if let Some(reference) = value.get("reference") {
                let uuid = match reference {
                    Value::String(uuid) => uuid.clone(),
                    other => text(other, "itemUuid"),
                };
                let uuid = uuid.trim().to_string();
                if !uuid.is_empty() && !related_refs.contains(&uuid) {
                    related_refs.push(uuid);
                }
                continue;
            }
            if let Some(ssh) = value.get("sshKey") {
                ssh_public_key = text(&ssh["metadata"], "publicKey");
            }
            let Some((field_type, stored)) = field_value(value) else { continue };
            if stored.trim().is_empty() {
                continue;
            }
            let label = text(field, "title");
            let field_id = text(field, "id");
            if field_type == "otp" {
                otp_fields.push(CustomField { label, value: stored, field_type: "otp".to_string() });
                continue;
            }
            match target_for(item_type, &field_id) {
                Some(Target::Username) if input.username.is_empty() => input.username = stored,
                Some(Target::Password) if input.password.is_empty() => input.password = stored,
                Some(Target::Template(section_key, key, template_type)) => {
                    let entry = match template_sections.iter_mut().find(|(known, _)| *known == section_key) {
                        Some(entry) => entry,
                        None => {
                            template_sections.push((section_key, Vec::new()));
                            template_sections.last_mut().expect("just pushed")
                        }
                    };
                    // Two 1Password fields for one template slot (three phone numbers): the first gets the slot.
                    let taken = entry.1.iter().any(|existing| existing.get("key").and_then(Value::as_str) == Some(key));
                    if taken {
                        loose.push((field_type, label, stored));
                    } else {
                        entry.1.push(child(template_type, Some(key), "", stored));
                    }
                }
                _ => loose.push((field_type, label, stored)),
            }
        }
        if loose.is_empty() {
            continue;
        }
        if section_title.trim().is_empty() {
            top_fields.extend(
                loose
                    .into_iter()
                    .map(|(field_type, label, value)| CustomField { label, value, field_type: field_type.to_string() }),
            );
        } else {
            other_sections.push(section_field(
                &section_title,
                loose.into_iter().map(|(field_type, label, value)| child(field_type, None, &label, value)).collect(),
            ));
        }
    }

    if item_type == "ssh_key" && !ssh_public_key.trim().is_empty() {
        if let Some((_, children)) = template_sections.iter_mut().find(|(key, _)| *key == "key") {
            children.push(child("multiline", Some("publicKey"), "", ssh_public_key));
        }
    }

    input.custom_fields.extend(sign_in_field);
    input.custom_fields.extend(otp_fields);
    input.custom_fields.extend(template_sections.into_iter().map(|(_, children)| section_field("", children)));
    input.custom_fields.extend(top_fields);
    input.custom_fields.extend(other_sections);

    Some(ParsedItem {
        uuid: text(item, "uuid"),
        sign_in_ref,
        related_refs,
        input,
        archived: state == "archived",
        created_at: item.get("createdAt").and_then(Value::as_i64),
        updated_at: item.get("updatedAt").and_then(Value::as_i64),
        attachments,
    })
}

/// Vault names in the export, keyed for tests.
#[cfg(test)]
fn by_vault(vaults: &[ParsedVault]) -> BTreeMap<String, Vec<String>> {
    vaults
        .iter()
        .map(|vault| (vault.name.clone(), vault.items.iter().map(|item| item.input.title.clone()).collect()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn export() -> Value {
        json!({ "accounts": [{ "attrs": { "name": "Rei" }, "vaults": [
            { "attrs": { "name": "Personal" }, "items": [
                { "uuid": "a", "favIndex": 1, "createdAt": 1700000000, "updatedAt": 1700000100, "state": "active",
                  "categoryUuid": "001",
                  "details": {
                    "loginFields": [
                      { "value": "rei", "designation": "username", "fieldType": "T" },
                      { "value": "hunter2", "designation": "password", "fieldType": "P" }
                    ],
                    "notesPlain": "hello",
                    "sections": [
                      { "title": "", "fields": [
                        { "title": "one-time password", "id": "TOTP_1", "value": { "totp": "otpauth://totp/x?secret=jbsw y3dp&issuer=x" } },
                        { "title": "recovery", "id": "r", "value": { "concealed": "abc" } }
                      ]},
                      { "title": "Security", "fields": [
                        { "title": "PIN", "id": "p", "value": { "concealed": "1234" } },
                        { "title": "Doc", "id": "f", "value": { "file": { "fileName": "a.txt", "documentId": "doc1" } } }
                      ]}
                    ]
                  },
                  "overview": { "title": "GitHub", "url": "https://github.com", "tags": ["Work"],
                    "urls": [{ "label": "", "url": "https://github.com" }, { "label": "gist", "url": "https://gist.github.com", "mode": "exact" }] } },
                { "uuid": "b", "state": "archived", "categoryUuid": "002",
                  "details": { "sections": [{ "title": "", "fields": [
                    { "title": "cardholder name", "id": "cardholder", "value": { "string": "Rei Leo" } },
                    { "title": "type", "id": "type", "value": { "creditCardType": "mc" } },
                    { "title": "number", "id": "ccnum", "value": { "creditCardNumber": "5555555555554444" } },
                    { "title": "expiry", "id": "expiry", "value": { "monthYear": 202907 } }
                  ]}]},
                  "overview": { "title": "Card" } },
                { "uuid": "c", "state": "deleted", "categoryUuid": "003", "details": {}, "overview": { "title": "Gone" } }
            ]},
        ]}, { "attrs": {}, "vaults": [
            { "attrs": { "name": "personal" }, "items": [
                { "uuid": "d", "categoryUuid": "105", "details": { "notesPlain": "m" }, "overview": { "title": "Gym" } }
            ]}
        ]}]})
    }

    #[test]
    fn vaults_merge_by_name_and_trash_is_skipped() {
        let vaults = parse_export(&export(), &["files/doc1__a.txt".to_string()]);
        let names = by_vault(&vaults);
        assert_eq!(names.len(), 1);
        assert_eq!(names["Personal"], vec!["GitHub", "Card", "Gym"]);
    }

    #[test]
    fn a_login_keeps_credentials_urls_otp_sections_and_files() {
        let vaults = parse_export(&export(), &["files/doc1__a.txt".to_string()]);
        let login = &vaults[0].items[0];
        assert_eq!(login.input.username, "rei");
        assert_eq!(login.input.password, "hunter2");
        assert!(login.input.favorite);
        assert_eq!(login.input.website, "https://github.com");
        assert_eq!(login.input.urls.len(), 2);
        assert_eq!(login.input.urls[1].match_type, "exact");
        let otp = login.input.custom_fields.iter().find(|field| field.field_type == "otp").unwrap();
        assert_eq!(otp.value, "JBSWY3DP");
        assert!(login.input.custom_fields.iter().any(|field| field.field_type == "concealed" && field.value == "abc"));
        let security = login.input.custom_fields.iter().find(|field| field.field_type == "section").unwrap();
        assert_eq!(security.label, "Security");
        assert!(security.value.contains("1234"));
        assert_eq!(login.attachments, vec![("files/doc1__a.txt".to_string(), "a.txt".to_string())]);
    }

    #[test]
    fn a_card_lands_in_the_template_with_keys() {
        let vaults = parse_export(&export(), &[]);
        let card = &vaults[0].items[1];
        assert!(card.archived);
        assert_eq!(card.input.item_type, "credit_card");
        let section = card.input.custom_fields.iter().find(|field| field.field_type == "section").unwrap();
        let children: Vec<Value> = serde_json::from_str(&section.value).unwrap();
        let by_key = |key: &str| children.iter().find(|child| child["key"] == key).unwrap()["value"].clone();
        assert_eq!(by_key("brand"), "mastercard");
        assert_eq!(by_key("number"), "5555555555554444");
        assert_eq!(by_key("expiry"), "2029-07");
        assert_eq!(by_key("cardholder"), "Rei Leo");
    }

    #[test]
    fn unknown_categories_become_secure_notes() {
        let vaults = parse_export(&export(), &[]);
        assert_eq!(vaults[0].items[2].input.item_type, "secure_note");
    }

    #[test]
    fn related_items_keep_their_references_and_add_no_field() {
        let item = json!({
            "uuid": "n", "categoryUuid": "003", "state": "active",
            "overview": { "title": "Mail note" },
            "details": { "sections": [{ "title": "Related Items", "name": "linked items", "fields": [
                { "title": "", "id": "r1", "value": { "reference": "mail" } },
                { "title": "", "id": "r2", "value": { "reference": { "itemUuid": "bank" } } },
                { "title": "", "id": "r3", "value": { "reference": "mail" } }
            ]}]}
        });
        let parsed = parse_item(&item, &[]).expect("a live item");
        assert_eq!(parsed.related_refs, vec!["mail".to_string(), "bank".to_string()]);
        assert!(parsed.input.custom_fields.is_empty());
    }

    #[test]
    fn sign_in_with_keeps_the_provider_and_the_account_reference() {
        let item = json!({
            "uuid": "q", "categoryUuid": "001", "state": "active",
            "overview": { "title": "Qoder", "url": "https://qoder.com/" },
            "details": { "loginFields": [], "sections": [{ "title": "", "name": "add more", "fields": [
                { "title": "sign in with", "id": "w3", "value": { "ssoLogin": {
                    "provider": "GitHub", "item": { "vaultUuid": "v", "itemUuid": "acct" } } } }
            ]}]}
        });
        let parsed = parse_item(&item, &[]).expect("a live item");
        assert_eq!(parsed.uuid, "q");
        assert_eq!(parsed.sign_in_ref.as_deref(), Some("acct"));
        let field = &parsed.input.custom_fields[0];
        assert_eq!((field.field_type.as_str(), field.value.as_str(), field.label.as_str()), ("sign_in_with", "github", ""));
        assert_eq!(parsed.input.custom_fields.len(), 1);
    }

}
