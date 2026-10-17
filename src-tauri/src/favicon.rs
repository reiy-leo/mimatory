//! Website icons for items, fetched straight from the site the item names.
//!
//! A password manager asking a third-party favicon service for `https://<every site you have an
//! account on>` would hand that service the user's account list, so there is no such service here:
//! the app talks to the site itself, and only to its public address. Every rule below exists for
//! one of two reasons — keeping that request from being turned against the user's own network
//! (SSRF), or keeping a hostile page from feeding the decoder something it should not chew on.
//!
//! - https only, the default port only; a redirect has to stay on https too.
//! - Every hop's host is resolved here first, and the request is pinned to the addresses that were
//!   checked (`resolve_to_addrs`), so a DNS answer cannot change between the check and the connect.
//!   Loopback, private, link-local, CGNAT, multicast and unspecified addresses are refused.
//! - No cookies (reqwest keeps none unless told to), no referrer, a short timeout, at most
//!   `MAX_REDIRECTS` hops and a byte cap on every body (`HTML_CAP`, `ICON_CAP`).
//! - The icon must announce an image content type (or none / octet-stream) *and* start with the
//!   magic bytes of a format the decoder supports; SVG is never decoded. Decoding runs under
//!   dimension and allocation limits, and the result is always re-encoded as a fixed-size PNG, so
//!   what is stored and shown is pixels this module produced, not the site's file.

use image::{imageops::FilterType, ImageFormat, ImageReader, Limits, RgbaImage};
use reqwest::header::{CONTENT_TYPE, LOCATION};
use reqwest::Url;
use std::io::{Cursor, Read};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::time::Duration;
use thiserror::Error;

/// The edge of the PNG every icon is normalised to: 2× the 32pt list tile.
pub const ICON_SIZE: u32 = 64;
/// Largest icon body read before giving up on that candidate.
pub const ICON_CAP: usize = 256 * 1024;
/// Only the `<head>` matters, and it is near the top; a page larger than this is cut, not read.
pub const HTML_CAP: usize = 512 * 1024;
const MAX_REDIRECTS: usize = 4;
/// Candidates tried from the page, before `/favicon.ico`.
const MAX_PAGE_CANDIDATES: usize = 4;
const DECODE_MAX_EDGE: u32 = 2048;
const DECODE_MAX_ALLOC: u64 = 32 * 1024 * 1024;

#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum FaviconError {
    #[error("not a website address")]
    InvalidDomain,
    #[error("only https addresses are fetched")]
    InsecureScheme,
    #[error("refusing a private, loopback or link-local address")]
    PrivateAddress,
    #[error("the address did not resolve")]
    Unresolved,
    #[error("too many redirects")]
    TooManyRedirects,
    #[error("the response was larger than allowed")]
    TooLarge,
    #[error("the response was not an image")]
    NotAnImage,
    #[error("network error: {0}")]
    Network(String),
    #[error("http status {0}")]
    Status(u16),
}

/// How strict a fetch is. Production always uses [`FetchPolicy::strict`]; the relaxed fields exist
/// so the tests can talk to a plain-HTTP server on 127.0.0.1 through the same code path.
#[derive(Clone, Debug)]
pub struct FetchPolicy {
    pub require_https: bool,
    pub allow_private: bool,
    /// Pin every host to this address instead of resolving it (tests only).
    pub resolve_override: Option<SocketAddr>,
    pub timeout: Duration,
}

impl FetchPolicy {
    pub fn strict() -> Self {
        Self {
            require_https: true,
            allow_private: false,
            resolve_override: None,
            timeout: Duration::from_secs(8),
        }
    }
}

/// Reduces what the frontend sends to a bare lowercase host name: letters, digits, dots and
/// hyphens, at least one dot, no IP literal, no port. Anything else is not a site to fetch from.
pub fn normalize_domain(input: &str) -> Result<String, FaviconError> {
    let host = input.trim().trim_end_matches('.').to_ascii_lowercase();
    let valid_chars = host
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '.' || character == '-');
    if host.is_empty()
        || host.len() > 253
        || !valid_chars
        || !host.contains('.')
        || host.starts_with('.')
        || host.contains("..")
        || host.split('.').any(|label| label.is_empty() || label.len() > 63 || label.starts_with('-'))
        || host.parse::<IpAddr>().is_ok()
        // An all-numeric last label is an IPv4 shorthand (`127.1`), never a public suffix.
        || host.rsplit('.').next().is_some_and(|tld| tld.chars().all(|c| c.is_ascii_digit()))
    {
        return Err(FaviconError::InvalidDomain);
    }
    Ok(host)
}

/// Whether an address is somewhere a website icon may live. Everything on the user's own machine
/// or network is refused, as are the ranges nobody should answer from.
pub fn is_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_public_v4(mapped);
            }
            let first = v6.segments()[0];
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (first & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (first & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (first & 0xffc0) == 0xfec0 // deprecated site-local fec0::/10
                || v6 == Ipv6Addr::new(0, 0, 0, 0, 0, 0xffff, 0, 0))
        }
    }
}

fn is_public_v4(address: Ipv4Addr) -> bool {
    let [a, b, ..] = address.octets();
    !(address.is_loopback()
        || address.is_private()
        || address.is_link_local()
        || address.is_unspecified()
        || address.is_broadcast()
        || address.is_multicast()
        || a == 0
        || (a == 100 && (64..128).contains(&b)) // CGNAT 100.64.0.0/10
        || (a == 192 && b == 0 && address.octets()[2] == 0) // IETF protocol assignments
        || a >= 240)
}

/// The checked addresses a host may be reached at. One bad answer refuses the host outright: a
/// name that resolves to both a public and a private address is exactly the rebinding shape.
fn resolve_checked(host: &str, port: u16, policy: &FetchPolicy) -> Result<Vec<SocketAddr>, FaviconError> {
    let addresses: Vec<SocketAddr> = match policy.resolve_override {
        Some(address) => vec![address],
        None => (host, port)
            .to_socket_addrs()
            .map_err(|_| FaviconError::Unresolved)?
            .collect(),
    };
    if addresses.is_empty() {
        return Err(FaviconError::Unresolved);
    }
    if !policy.allow_private && addresses.iter().any(|address| !is_public_address(address.ip())) {
        return Err(FaviconError::PrivateAddress);
    }
    Ok(addresses)
}

/// A URL this module is willing to request: https (unless the policy relaxes it), the scheme's
/// default port, a host that is a name rather than a literal address, no credentials.
pub fn check_url(url: &Url, policy: &FetchPolicy) -> Result<(), FaviconError> {
    match url.scheme() {
        "https" => {}
        "http" if !policy.require_https => {}
        _ => return Err(FaviconError::InsecureScheme),
    }
    if policy.require_https && url.port().is_some() {
        return Err(FaviconError::InsecureScheme);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(FaviconError::InvalidDomain);
    }
    let host = url.host_str().ok_or(FaviconError::InvalidDomain)?;
    // The URL parser has already turned `127.1` and `0x7f.1` into a dotted quad, so a literal
    // address is anything that now parses as one (IPv6 keeps its brackets).
    let literal = host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>().is_ok();
    if literal && !policy.allow_private {
        return Err(FaviconError::PrivateAddress);
    }
    Ok(())
}

/// Where a redirect may go: resolved against the URL that answered, then held to the same rules.
pub fn redirect_target(from: &Url, location: &str, policy: &FetchPolicy) -> Result<Url, FaviconError> {
    let next = from.join(location).map_err(|_| FaviconError::InvalidDomain)?;
    check_url(&next, policy)?;
    Ok(next)
}

struct Fetched {
    url: Url,
    content_type: String,
    body: Vec<u8>,
}

fn get(start: &Url, cap: usize, accept: &str, policy: &FetchPolicy) -> Result<Fetched, FaviconError> {
    let mut url = start.clone();
    check_url(&url, policy)?;
    for _ in 0..=MAX_REDIRECTS {
        let host = url.host_str().ok_or(FaviconError::InvalidDomain)?.to_string();
        let port = url.port_or_known_default().ok_or(FaviconError::InvalidDomain)?;
        let addresses = resolve_checked(&host, port, policy)?;
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(policy.timeout)
            .connect_timeout(Duration::from_secs(5))
            .resolve_to_addrs(&host, &addresses)
            .user_agent("Mozilla/5.0 (compatible; Passless website icon)")
            .build()
            .map_err(|error| FaviconError::Network(error.to_string()))?;
        let response = client
            .get(url.clone())
            .header(reqwest::header::ACCEPT, accept)
            .send()
            .map_err(|error| FaviconError::Network(error.without_url().to_string()))?;
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or(FaviconError::Status(status.as_u16()))?
                .to_string();
            url = redirect_target(&url, &location, policy)?;
            continue;
        }
        if !status.is_success() {
            return Err(FaviconError::Status(status.as_u16()));
        }
        if response.content_length().is_some_and(|length| length > cap as u64) {
            return Err(FaviconError::TooLarge);
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let body = read_capped(response, cap)?;
        return Ok(Fetched { url, content_type, body });
    }
    Err(FaviconError::TooManyRedirects)
}

/// Reads at most `cap` bytes; one byte more means the body was too large and is dropped whole.
pub fn read_capped(reader: impl Read, cap: usize) -> Result<Vec<u8>, FaviconError> {
    let mut body = Vec::new();
    reader
        .take(cap as u64 + 1)
        .read_to_end(&mut body)
        .map_err(|error| FaviconError::Network(error.to_string()))?;
    if body.len() > cap {
        return Err(FaviconError::TooLarge);
    }
    Ok(body)
}

/// One `<link rel=… href=…>` the page offered, with the size it claimed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IconCandidate {
    pub href: String,
    pub size: u32,
    pub touch: bool,
}

/// The icon links in a page's markup, best first. A deliberately small scanner rather than an HTML
/// parser: it only reads `<link>` tags, and anything it misreads costs one wasted request.
pub fn parse_icon_links(html: &str) -> Vec<IconCandidate> {
    let lower = html.to_ascii_lowercase();
    let mut candidates = Vec::new();
    let mut cursor = 0;
    while let Some(offset) = lower[cursor..].find("<link") {
        let start = cursor + offset;
        let Some(end) = lower[start..].find('>').map(|end| start + end) else {
            break;
        };
        cursor = end + 1;
        let attributes = parse_attributes(&html[start + 5..end]);
        let value = |name: &str| {
            attributes
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.as_str())
        };
        let rel = value("rel").unwrap_or_default().to_ascii_lowercase();
        let rels: Vec<&str> = rel.split_ascii_whitespace().collect();
        let touch = rels
            .iter()
            .any(|token| *token == "apple-touch-icon" || *token == "apple-touch-icon-precomposed");
        if !touch && !rels.contains(&"icon") {
            continue;
        }
        let Some(href) = value("href").map(decode_entities).filter(|href| !href.trim().is_empty()) else {
            continue;
        };
        let kind = value("type").unwrap_or_default().to_ascii_lowercase();
        if kind.contains("svg") || href.to_ascii_lowercase().split(['?', '#']).next().unwrap_or("").ends_with(".svg") {
            continue;
        }
        let declared = value("sizes")
            .unwrap_or_default()
            .split_ascii_whitespace()
            .filter_map(|size| size.to_ascii_lowercase().split_once('x').and_then(|(w, _)| w.parse::<u32>().ok()))
            .max();
        let size = declared.unwrap_or(if touch { 180 } else { 16 });
        candidates.push(IconCandidate { href: href.trim().to_string(), size, touch });
    }
    // At least the target size, then the smallest such (fewer bytes, less downscaling); smaller ones
    // after, largest first.
    candidates.sort_by_key(|candidate| {
        if candidate.size >= ICON_SIZE {
            (0, candidate.size)
        } else {
            (1, u32::MAX - candidate.size)
        }
    });
    candidates.dedup_by(|left, right| left.href == right.href);
    candidates
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&#38;", "&")
        .replace("&quot;", "\"")
        .replace("&#x2F;", "/")
        .replace("&#47;", "/")
}

fn parse_attributes(source: &str) -> Vec<(String, String)> {
    let bytes = source.as_bytes();
    let mut attributes = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        while index < bytes.len() && (bytes[index].is_ascii_whitespace() || bytes[index] == b'/') {
            index += 1;
        }
        let name_start = index;
        while index < bytes.len() && !bytes[index].is_ascii_whitespace() && bytes[index] != b'=' && bytes[index] != b'/' {
            index += 1;
        }
        if name_start == index {
            index += 1;
            continue;
        }
        let name = source[name_start..index].to_ascii_lowercase();
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() || bytes[index] != b'=' {
            attributes.push((name, String::new()));
            continue;
        }
        index += 1;
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        let value = if index < bytes.len() && (bytes[index] == b'"' || bytes[index] == b'\'') {
            let quote = bytes[index];
            index += 1;
            let value_start = index;
            while index < bytes.len() && bytes[index] != quote {
                index += 1;
            }
            let value = source[value_start..index.min(bytes.len())].to_string();
            index += 1;
            value
        } else {
            let value_start = index;
            while index < bytes.len() && !bytes[index].is_ascii_whitespace() {
                index += 1;
            }
            source[value_start..index].to_string()
        };
        attributes.push((name, value));
    }
    attributes
}

/// The format the bytes really are, from their first bytes alone. `None` for anything else —
/// including SVG and HTML error pages served under an image URL.
pub fn sniff_image_format(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(ImageFormat::Png)
    } else if bytes.starts_with(&[0, 0, 1, 0]) || bytes.starts_with(&[0, 0, 2, 0]) {
        Some(ImageFormat::Ico)
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(ImageFormat::Jpeg)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(ImageFormat::Gif)
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(ImageFormat::WebP)
    } else if bytes.starts_with(b"BM") {
        Some(ImageFormat::Bmp)
    } else {
        None
    }
}

fn acceptable_content_type(content_type: &str) -> bool {
    let essence = content_type.split(';').next().unwrap_or_default().trim();
    essence.is_empty()
        || essence == "application/octet-stream"
        || essence == "binary/octet-stream"
        || (essence.starts_with("image/") && !essence.contains("svg"))
}

/// Decodes a supported image under limits and re-encodes it as a transparent `ICON_SIZE` square PNG,
/// the artwork scaled to fit and centred.
pub fn normalize_icon(bytes: &[u8]) -> Result<Vec<u8>, FaviconError> {
    let format = sniff_image_format(bytes).ok_or(FaviconError::NotAnImage)?;
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(DECODE_MAX_EDGE);
    limits.max_image_height = Some(DECODE_MAX_EDGE);
    limits.max_alloc = Some(DECODE_MAX_ALLOC);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|_| FaviconError::NotAnImage)?.to_rgba8();
    let (width, height) = decoded.dimensions();
    if width == 0 || height == 0 {
        return Err(FaviconError::NotAnImage);
    }
    let scale = ICON_SIZE as f32 / width.max(height) as f32;
    let target_width = ((width as f32 * scale).round() as u32).clamp(1, ICON_SIZE);
    let target_height = ((height as f32 * scale).round() as u32).clamp(1, ICON_SIZE);
    let filter = if scale > 1.0 { FilterType::Nearest } else { FilterType::Lanczos3 };
    let resized = image::imageops::resize(&decoded, target_width, target_height, filter);
    let mut canvas = RgbaImage::new(ICON_SIZE, ICON_SIZE);
    image::imageops::overlay(
        &mut canvas,
        &resized,
        ((ICON_SIZE - target_width) / 2) as i64,
        ((ICON_SIZE - target_height) / 2) as i64,
    );
    let mut png = Vec::new();
    canvas
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|_| FaviconError::NotAnImage)?;
    Ok(png)
}

fn fetch_icon_at(url: &Url, policy: &FetchPolicy) -> Result<Vec<u8>, FaviconError> {
    let fetched = get(url, ICON_CAP, "image/png,image/x-icon,image/*;q=0.8", policy)?;
    if !acceptable_content_type(&fetched.content_type) {
        return Err(FaviconError::NotAnImage);
    }
    normalize_icon(&fetched.body)
}

fn decode_data_url(href: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    let rest = href.strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    if !meta.ends_with(";base64") || meta.contains("svg") {
        return None;
    }
    // Base64 is 4/3 of the bytes it carries; refuse before decoding anything over the cap.
    if data.len() > ICON_CAP * 4 / 3 + 4 {
        return None;
    }
    base64::engine::general_purpose::STANDARD.decode(data.trim()).ok()
}

/// The site's icon as a normalised PNG, or `Ok(None)` when it has none this module will take.
/// `Err` is kept for a site that could not be reached at all, so the caller can tell "no icon"
/// from "try again later" if it wants to; both are cached as a miss today.
pub fn fetch_site_icon(domain: &str, policy: &FetchPolicy) -> Result<Option<Vec<u8>>, FaviconError> {
    let domain = normalize_domain(domain)?;
    let scheme = if policy.require_https { "https" } else { "http" };
    let mut home = Url::parse(&format!("{scheme}://{domain}/")).map_err(|_| FaviconError::InvalidDomain)?;
    if let (Some(address), false) = (policy.resolve_override, policy.require_https) {
        // The test server listens on an ephemeral port; production always uses the default one.
        let _ = home.set_port(Some(address.port()));
    }

    let mut base = home.clone();
    let mut tried = Vec::new();
    let page = match get(&home, HTML_CAP, "text/html,application/xhtml+xml", policy) {
        Ok(page) => Some(page),
        // Nothing else on this host is worth asking for when the host itself is refused or absent.
        Err(
            error @ (FaviconError::PrivateAddress
            | FaviconError::Unresolved
            | FaviconError::InvalidDomain
            | FaviconError::InsecureScheme),
        ) => return Err(error),
        Err(_) => None,
    };
    let mut reached = page.is_some();
    if let Some(page) = page {
        base = page.url.clone();
        let html = String::from_utf8_lossy(&page.body);
        for candidate in parse_icon_links(&html).into_iter().take(MAX_PAGE_CANDIDATES) {
            if let Some(bytes) = decode_data_url(&candidate.href) {
                if let Ok(png) = normalize_icon(&bytes) {
                    return Ok(Some(png));
                }
                continue;
            }
            let Ok(url) = base.join(&candidate.href) else {
                continue;
            };
            if check_url(&url, policy).is_err() || tried.contains(&url) {
                continue;
            }
            tried.push(url.clone());
            if let Ok(png) = fetch_icon_at(&url, policy) {
                return Ok(Some(png));
            }
        }
    }

    // The conventional location, on the origin the page ended up at and on the one asked for.
    for origin in [&base, &home] {
        let Ok(url) = origin.join("/favicon.ico") else {
            continue;
        };
        if tried.contains(&url) {
            continue;
        }
        tried.push(url.clone());
        match fetch_icon_at(&url, policy) {
            Ok(png) => return Ok(Some(png)),
            Err(FaviconError::Network(_)) | Err(FaviconError::Unresolved) => {}
            Err(_) => reached = true,
        }
    }
    if reached {
        Ok(None)
    } else {
        Err(FaviconError::Unresolved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::thread;
    use tiny_http::{Header, Response, Server};

    /// A route the test server answers: status, content type, body, and an optional Location.
    #[derive(Clone)]
    struct Route {
        status: u16,
        content_type: &'static str,
        body: Vec<u8>,
        location: Option<String>,
    }

    fn route(content_type: &'static str, body: Vec<u8>) -> Route {
        Route { status: 200, content_type, body, location: None }
    }

    /// Serves `routes` on 127.0.0.1 and records every path asked for. The server thread lives for
    /// the rest of the test binary; each test gets its own port.
    fn serve(routes: HashMap<&'static str, Route>) -> (SocketAddr, Arc<Mutex<Vec<String>>>) {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = server.server_addr().to_ip().expect("test server has an ip address");
        let hits = Arc::new(Mutex::new(Vec::new()));
        let seen = hits.clone();
        thread::spawn(move || {
            for request in server.incoming_requests() {
                let path = request.url().to_string();
                seen.lock().unwrap().push(path.clone());
                let response = match routes.get(path.as_str()) {
                    Some(found) => {
                        let mut response = Response::from_data(found.body.clone())
                            .with_status_code(found.status)
                            .with_header(Header::from_bytes("Content-Type", found.content_type).unwrap());
                        if let Some(location) = &found.location {
                            response = response.with_header(Header::from_bytes("Location", location.as_bytes()).unwrap());
                        }
                        response
                    }
                    None => Response::from_data(b"missing".to_vec()).with_status_code(404),
                };
                let _ = request.respond(response);
            }
        });
        (address, hits)
    }

    fn local_policy(address: SocketAddr) -> FetchPolicy {
        FetchPolicy {
            require_https: false,
            allow_private: true,
            resolve_override: Some(address),
            timeout: Duration::from_secs(5),
        }
    }

    fn png_of(width: u32, height: u32) -> Vec<u8> {
        let mut image = RgbaImage::new(width, height);
        for pixel in image.pixels_mut() {
            *pixel = image::Rgba([200, 30, 30, 255]);
        }
        let mut bytes = Vec::new();
        image.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).unwrap();
        bytes
    }

    fn decoded_size(png: &[u8]) -> (u32, u32) {
        let image = image::load_from_memory_with_format(png, ImageFormat::Png).unwrap();
        (image.width(), image.height())
    }

    #[test]
    fn domains_are_reduced_to_bare_public_host_names() {
        assert_eq!(normalize_domain(" GitHub.com. "), Ok("github.com".to_string()));
        assert_eq!(normalize_domain("accounts.google.com"), Ok("accounts.google.com".to_string()));
        for bad in [
            "", "localhost", "127.0.0.1", "10.0.0.1", "::1", "[::1]", "example.com:8080", "a..b.com",
            "-bad.com", "exa mple.com", "user@example.com", "https://example.com", "127.1", "0x7f.1",
        ] {
            assert_eq!(normalize_domain(bad), Err(FaviconError::InvalidDomain), "{bad}");
        }
    }

    #[test]
    fn the_ssrf_guard_refuses_every_non_public_range() {
        let refused = [
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
            "100.64.0.1", "0.0.0.0", "255.255.255.255", "224.0.0.1", "240.0.0.1", "192.0.0.8", "::1",
            "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
        ];
        for address in refused {
            assert!(!is_public_address(address.parse().unwrap()), "{address} must be refused");
        }
        for address in ["93.184.216.34", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "198.18.0.1"] {
            assert!(is_public_address(address.parse().unwrap()), "{address} is public");
        }
    }

    #[test]
    fn the_strict_policy_refuses_a_host_that_resolves_to_loopback() {
        let mut policy = FetchPolicy::strict();
        policy.resolve_override = Some("127.0.0.1:443".parse().unwrap());
        assert_eq!(fetch_site_icon("example.com", &policy), Err(FaviconError::PrivateAddress));
        policy.resolve_override = Some("[fe80::1]:443".parse().unwrap());
        assert_eq!(fetch_site_icon("example.com", &policy), Err(FaviconError::PrivateAddress));
    }

    #[test]
    fn redirects_must_stay_on_https_and_on_a_named_host() {
        let policy = FetchPolicy::strict();
        let from = Url::parse("https://example.com/login").unwrap();
        assert_eq!(redirect_target(&from, "/home", &policy).unwrap().as_str(), "https://example.com/home");
        assert_eq!(
            redirect_target(&from, "https://www.example.com/", &policy).unwrap().as_str(),
            "https://www.example.com/"
        );
        assert_eq!(redirect_target(&from, "http://example.com/", &policy), Err(FaviconError::InsecureScheme));
        assert_eq!(redirect_target(&from, "file:///etc/passwd", &policy), Err(FaviconError::InsecureScheme));
        assert_eq!(redirect_target(&from, "https://example.com:8443/", &policy), Err(FaviconError::InsecureScheme));
        assert_eq!(redirect_target(&from, "https://127.0.0.1/", &policy), Err(FaviconError::PrivateAddress));
        assert_eq!(redirect_target(&from, "https://[::1]/", &policy), Err(FaviconError::PrivateAddress));
        assert_eq!(redirect_target(&from, "https://user:pw@example.com/", &policy), Err(FaviconError::InvalidDomain));
    }

    #[test]
    fn icon_links_are_read_from_the_markup_best_size_first() {
        let html = r#"<html><head>
            <LINK rel="shortcut icon" href="/favicon-16.png" sizes="16x16">
            <link rel=icon href='/icon-32.png' sizes="32x32" type="image/png">
            <link href="/apple.png" rel="apple-touch-icon">
            <link rel="icon" href="/icon.svg" type="image/svg+xml">
            <link rel="mask-icon" href="/mask.svg">
            <link rel="stylesheet" href="/site.css">
            <link rel="icon" sizes="96x96 192x192" href="/icon.png?v=1&amp;x=2">
        </head></html>"#;
        let candidates = parse_icon_links(html);
        let hrefs: Vec<&str> = candidates.iter().map(|candidate| candidate.href.as_str()).collect();
        assert_eq!(hrefs, vec!["/apple.png", "/icon.png?v=1&x=2", "/icon-32.png", "/favicon-16.png"]);
        assert_eq!(candidates[1].size, 192);
        assert!(candidates[0].touch);
    }

    #[test]
    fn only_real_image_bytes_are_accepted() {
        assert_eq!(sniff_image_format(&png_of(4, 4)), Some(ImageFormat::Png));
        assert_eq!(sniff_image_format(&[0, 0, 1, 0, 1, 0]), Some(ImageFormat::Ico));
        assert_eq!(sniff_image_format(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), None);
        assert_eq!(sniff_image_format(b"<!doctype html>"), None);
        assert!(acceptable_content_type("image/png"));
        assert!(acceptable_content_type("image/x-icon; charset=binary"));
        assert!(acceptable_content_type(""));
        assert!(!acceptable_content_type("text/html; charset=utf-8"));
        assert!(!acceptable_content_type("image/svg+xml"));
        assert_eq!(normalize_icon(b"<!doctype html><title>404</title>"), Err(FaviconError::NotAnImage));
    }

    #[test]
    fn icons_are_normalised_to_a_square_png_of_the_fixed_size() {
        assert_eq!(decoded_size(&normalize_icon(&png_of(16, 16)).unwrap()), (ICON_SIZE, ICON_SIZE));
        assert_eq!(decoded_size(&normalize_icon(&png_of(300, 120)).unwrap()), (ICON_SIZE, ICON_SIZE));
        // An image larger than the decoder is allowed to open is refused, not decoded.
        let huge = png_of(DECODE_MAX_EDGE + 1, 1);
        assert_eq!(normalize_icon(&huge), Err(FaviconError::NotAnImage));
    }

    #[test]
    fn a_body_over_the_cap_is_dropped_whole() {
        assert_eq!(read_capped(&[1_u8; 10][..], 10).unwrap().len(), 10);
        assert_eq!(read_capped(&[1_u8; 11][..], 10), Err(FaviconError::TooLarge));
    }

    #[test]
    fn the_page_icon_is_fetched_from_a_local_server() {
        let page = br#"<head><link rel="icon" sizes="32x32" href="/static/icon.png"></head>"#.to_vec();
        let (address, hits) = serve(HashMap::from([
            ("/", route("text/html; charset=utf-8", page)),
            ("/static/icon.png", route("image/png", png_of(32, 32))),
        ]));
        let icon = fetch_site_icon("icons.test", &local_policy(address)).unwrap().expect("an icon");
        assert_eq!(decoded_size(&icon), (ICON_SIZE, ICON_SIZE));
        assert_eq!(*hits.lock().unwrap(), vec!["/", "/static/icon.png"]);
    }

    #[test]
    fn redirects_are_followed_and_favicon_ico_is_the_fallback() {
        let (address, hits) = serve(HashMap::from([
            ("/", Route { status: 302, content_type: "text/plain", body: vec![], location: Some("/home".into()) }),
            ("/home", route("text/html", b"<head><title>no icons</title></head>".to_vec())),
            ("/favicon.ico", route("image/x-icon", png_of(48, 48))),
        ]));
        let icon = fetch_site_icon("icons.test", &local_policy(address)).unwrap();
        assert!(icon.is_some());
        assert_eq!(*hits.lock().unwrap(), vec!["/", "/home", "/favicon.ico"]);
    }

    #[test]
    fn an_oversized_or_mislabelled_icon_falls_through_to_the_next_candidate() {
        let page = br#"<link rel="apple-touch-icon" href="/big.png"><link rel="icon" href="/fake.png">"#.to_vec();
        let mut oversized = png_of(8, 8);
        oversized.resize(ICON_CAP + 1, 0);
        let (address, hits) = serve(HashMap::from([
            ("/", route("text/html", page)),
            ("/big.png", route("image/png", oversized)),
            ("/fake.png", route("text/html", png_of(16, 16))),
            ("/favicon.ico", route("image/vnd.microsoft.icon", png_of(16, 16))),
        ]));
        assert!(fetch_site_icon("icons.test", &local_policy(address)).unwrap().is_some());
        assert_eq!(*hits.lock().unwrap(), vec!["/", "/big.png", "/fake.png", "/favicon.ico"]);
    }

    #[test]
    fn a_site_without_any_icon_is_a_miss_not_an_error() {
        let (address, _) = serve(HashMap::from([("/", route("text/html", b"<p>hi</p>".to_vec()))]));
        assert_eq!(fetch_site_icon("icons.test", &local_policy(address)), Ok(None));
    }

    #[test]
    fn an_inline_data_url_icon_is_decoded_without_a_request() {
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(png_of(16, 16));
        let page = format!(r#"<link rel="icon" href="data:image/png;base64,{encoded}">"#).into_bytes();
        let (address, hits) = serve(HashMap::from([("/", route("text/html", page))]));
        assert!(fetch_site_icon("icons.test", &local_policy(address)).unwrap().is_some());
        assert_eq!(*hits.lock().unwrap(), vec!["/"]);
    }
}
