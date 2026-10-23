//! Website icons for items.
//!
//! Where they come from (owner decision, 2026-10-18: the site-only icons were too often blurry):
//! first Google's favicon service (`t1.gstatic.com/faviconV2`, asked for 128px, which answers 404
//! instead of its generic globe when it has nothing), then — when that is missing or smaller than
//! 128px — the site itself: its `<link rel=icon|apple-touch-icon>`s, its web manifest's icons and
//! finally `/favicon.ico`. The largest image any of them gives wins. The privacy cost is accepted
//! by the owner and recorded in `.agent/todo.md`: Google learns each host the user has an item for.
//!
//! Every rule below exists for one of two reasons — keeping a request from being turned against
//! the user's own network (SSRF), or keeping a hostile page from feeding the decoder something it
//! should not chew on. The Google request goes through the same guard.
//!
//! - https only, the default port only; a redirect has to stay on https too.
//! - Every hop's host is resolved here first, and the request is pinned to the addresses that were
//!   checked (`resolve_to_addrs`), so a DNS answer cannot change between the check and the connect.
//!   Loopback, private, link-local, CGNAT, multicast and unspecified addresses are refused. A
//!   system proxy, when one is configured, makes the connection instead; the check still runs here.
//! - No cookies (reqwest keeps none unless told to), no referrer, a short timeout, at most
//!   `MAX_REDIRECTS` hops and a byte cap on every body (`HTML_CAP`, `ICON_CAP`, `MANIFEST_CAP`).
//! - The icon must announce an image content type (or none / octet-stream) *and* start with the
//!   magic bytes of a format the decoder supports; SVG is never decoded. Decoding runs under
//!   dimension and allocation limits, and the result is always re-encoded as a square PNG at the
//!   source's own resolution (never upscaled, at most `ICON_MAX_EDGE`), so what is stored and shown
//!   is pixels this module produced, and the page — not this module — does the downscaling.

use image::{imageops::FilterType, ImageFormat, ImageReader, Limits, RgbaImage};
use reqwest::header::{CONTENT_TYPE, LOCATION};
use reqwest::Url;
use std::io::{Cursor, Read};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::time::Duration;
use thiserror::Error;

/// The largest edge an icon is stored at: the 64pt detail tile at 3× (phones). Smaller sources keep
/// their own size — upscaling here only bakes the blur in that the old fixed 64px PNG had.
pub const ICON_MAX_EDGE: u32 = 192;
/// An icon at least this large is sharp on the 64pt detail tile at 2×; finding one ends the search.
pub const GOOD_EDGE: u32 = 128;
/// Below this an icon is soft even on the 32pt list tile at 2×, so `/favicon.ico` is still worth a try.
pub const MIN_SHARP_EDGE: u32 = 64;
/// Google's favicon service. `fallback_opts` makes it answer 404 rather than a generic globe.
pub const GOOGLE_FAVICON_ENDPOINT: &str = "https://t1.gstatic.com/faviconV2";
/// The size asked of Google, matching `GOOD_EDGE`.
pub const GOOGLE_ICON_SIZE: u32 = 128;
/// A web manifest is a few hundred bytes of JSON; anything near this is not one.
pub const MANIFEST_CAP: usize = 64 * 1024;
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
    /// Go through the proxy the system (or the environment) configures. On in production, because
    /// a user behind one reaches no site otherwise; the address check above still runs on this
    /// side first. Off in the tests, whose server a proxy could not reach.
    pub system_proxy: bool,
    /// The favicon service asked before the site (`GOOGLE_FAVICON_ENDPOINT` in production), or
    /// `None` to ask the site only.
    pub icon_service: Option<String>,
}

impl FetchPolicy {
    pub fn strict() -> Self {
        Self {
            require_https: true,
            allow_private: false,
            resolve_override: None,
            timeout: Duration::from_secs(8),
            system_proxy: true,
            icon_service: Some(GOOGLE_FAVICON_ENDPOINT.to_string()),
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

/// How a body over its cap is treated: an image or manifest is dropped whole, a page is cut (its
/// `<head>` is at the top; a big homepage such as github.com's is over the cap).
#[derive(Clone, Copy, PartialEq, Eq)]
enum OverCap {
    Refuse,
    Cut,
}

fn get(start: &Url, cap: usize, accept: &str, policy: &FetchPolicy, over_cap: OverCap) -> Result<Fetched, FaviconError> {
    let mut url = start.clone();
    check_url(&url, policy)?;
    for _ in 0..=MAX_REDIRECTS {
        let host = url.host_str().ok_or(FaviconError::InvalidDomain)?.to_string();
        let port = url.port_or_known_default().ok_or(FaviconError::InvalidDomain)?;
        let addresses = resolve_checked(&host, port, policy)?;
        let mut builder = reqwest::blocking::Client::builder();
        if !policy.system_proxy {
            builder = builder.no_proxy();
        }
        let client = builder
            .redirect(reqwest::redirect::Policy::none())
            .timeout(policy.timeout)
            .connect_timeout(Duration::from_secs(5))
            .resolve_to_addrs(&host, &addresses)
            .user_agent("Mozilla/5.0 (compatible; Mimatory website icon)")
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
        if over_cap == OverCap::Refuse && response.content_length().is_some_and(|length| length > cap as u64) {
            return Err(FaviconError::TooLarge);
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let body = match over_cap {
            OverCap::Refuse => read_capped(response, cap)?,
            OverCap::Cut => read_prefix(response, cap)?,
        };
        return Ok(Fetched { url, content_type, body });
    }
    Err(FaviconError::TooManyRedirects)
}

/// Reads the first `cap` bytes and stops there, whatever the length (pages).
pub fn read_prefix(reader: impl Read, cap: usize) -> Result<Vec<u8>, FaviconError> {
    let mut body = Vec::new();
    reader
        .take(cap as u64)
        .read_to_end(&mut body)
        .map_err(|error| FaviconError::Network(error.to_string()))?;
    Ok(body)
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

/// One icon a page or manifest offered, with the size it claimed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IconCandidate {
    pub href: String,
    pub size: u32,
    pub touch: bool,
}

/// The largest edge a `sizes` value claims (`"16x16 32x32"` → 32, `"any"` → scalable, so the
/// largest edge stored). `None` when it claims nothing readable.
pub fn parse_sizes(value: &str) -> Option<u32> {
    value
        .split_ascii_whitespace()
        .filter_map(|size| {
            let size = size.to_ascii_lowercase();
            if size == "any" {
                return Some(ICON_MAX_EDGE);
            }
            let (width, height) = size.split_once('x')?;
            Some(width.parse::<u32>().ok()?.max(height.parse::<u32>().ok()?))
        })
        .max()
}

/// Best first: the smallest icon that is already sharp (`GOOD_EDGE`, fewer bytes), then smaller
/// ones largest first. A duplicate href keeps its first, better-ranked, entry.
pub fn rank_candidates(candidates: &mut Vec<IconCandidate>) {
    candidates.sort_by_key(|candidate| {
        if candidate.size >= GOOD_EDGE {
            (0, candidate.size)
        } else {
            (1, u32::MAX - candidate.size)
        }
    });
    let mut seen = Vec::new();
    candidates.retain(|candidate| {
        if seen.contains(&candidate.href) {
            return false;
        }
        seen.push(candidate.href.clone());
        true
    });
}

fn is_svg(href: &str, kind: &str) -> bool {
    kind.contains("svg") || href.to_ascii_lowercase().split(['?', '#']).next().unwrap_or("").ends_with(".svg")
}

/// The attributes of every `<link>` tag in a page. A deliberately small scanner rather than an
/// HTML parser: it only reads `<link>` tags, and anything it misreads costs one wasted request.
fn link_tags(html: &str) -> Vec<Vec<(String, String)>> {
    let lower = html.to_ascii_lowercase();
    let mut tags = Vec::new();
    let mut cursor = 0;
    while let Some(offset) = lower[cursor..].find("<link") {
        let start = cursor + offset;
        let Some(end) = lower[start..].find('>').map(|end| start + end) else {
            break;
        };
        cursor = end + 1;
        tags.push(parse_attributes(&html[start + 5..end]));
    }
    tags
}

fn attribute<'a>(attributes: &'a [(String, String)], name: &str) -> Option<&'a str> {
    attributes.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
}

/// The icon links in a page's markup, best first (see [`rank_candidates`]). An icon without
/// `sizes` is assumed to be 16px, an apple-touch-icon 180px (Apple's own default).
pub fn parse_icon_links(html: &str) -> Vec<IconCandidate> {
    let mut candidates = Vec::new();
    for attributes in link_tags(html) {
        let rel = attribute(&attributes, "rel").unwrap_or_default().to_ascii_lowercase();
        let rels: Vec<&str> = rel.split_ascii_whitespace().collect();
        let touch = rels
            .iter()
            .any(|token| *token == "apple-touch-icon" || *token == "apple-touch-icon-precomposed");
        if !touch && !rels.contains(&"icon") {
            continue;
        }
        let Some(href) = attribute(&attributes, "href").map(decode_entities).filter(|href| !href.trim().is_empty())
        else {
            continue;
        };
        let kind = attribute(&attributes, "type").unwrap_or_default().to_ascii_lowercase();
        if is_svg(&href, &kind) {
            continue;
        }
        let declared = parse_sizes(attribute(&attributes, "sizes").unwrap_or_default());
        let size = declared.unwrap_or(if touch { 180 } else { 16 });
        candidates.push(IconCandidate { href: href.trim().to_string(), size, touch });
    }
    rank_candidates(&mut candidates);
    candidates
}

/// The page's `<link rel="manifest">`, if it has one.
pub fn parse_manifest_link(html: &str) -> Option<String> {
    link_tags(html).into_iter().find_map(|attributes| {
        let rel = attribute(&attributes, "rel").unwrap_or_default().to_ascii_lowercase();
        if !rel.split_ascii_whitespace().any(|token| token == "manifest") {
            return None;
        }
        attribute(&attributes, "href").map(decode_entities).map(|href| href.trim().to_string()).filter(|href| !href.is_empty())
    })
}

/// A web manifest's raster icons, best first. Icons whose `purpose` leaves out `any` (maskable or
/// monochrome only) are skipped: a maskable icon carries a wide safe-zone margin and reads small in
/// a tile, a monochrome one has no colour.
pub fn parse_manifest_icons(json: &str) -> Vec<IconCandidate> {
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let mut candidates: Vec<IconCandidate> = manifest
        .get("icons")
        .and_then(|icons| icons.as_array())
        .into_iter()
        .flatten()
        .filter_map(|icon| {
            let href = icon.get("src")?.as_str()?.trim().to_string();
            let kind = icon.get("type").and_then(|kind| kind.as_str()).unwrap_or_default().to_ascii_lowercase();
            let purpose = icon.get("purpose").and_then(|purpose| purpose.as_str()).unwrap_or("any");
            if href.is_empty() || is_svg(&href, &kind) || !purpose.split_ascii_whitespace().any(|token| token == "any") {
                return None;
            }
            let size = icon.get("sizes").and_then(|sizes| sizes.as_str()).and_then(parse_sizes).unwrap_or(0);
            Some(IconCandidate { href, size, touch: false })
        })
        .collect();
    rank_candidates(&mut candidates);
    candidates
}

/// The Google favicon request for a host: `fallback_opts=TYPE,SIZE,URL` lets it answer with
/// another size or the bare host's icon, and makes it answer 404 — not its globe — when it has none.
pub fn google_icon_url(endpoint: &str, host: &str) -> Result<Url, FaviconError> {
    let mut url = Url::parse(endpoint).map_err(|_| FaviconError::InvalidDomain)?;
    url.query_pairs_mut()
        .append_pair("client", "SOCIAL")
        .append_pair("type", "FAVICON")
        .append_pair("fallback_opts", "TYPE,SIZE,URL")
        .append_pair("url", &format!("https://{host}"))
        .append_pair("size", &GOOGLE_ICON_SIZE.to_string());
    Ok(url)
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

/// A decoded, re-encoded icon and the edge of the artwork it came from (what ranks two sources).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Icon {
    pub png: Vec<u8>,
    pub source_edge: u32,
}

/// Of two icons, the one with more pixels behind it; the first on a tie (sources are tried best first).
pub fn pick_larger(current: Option<Icon>, offered: Icon) -> Option<Icon> {
    match current {
        Some(current) if current.source_edge >= offered.source_edge => Some(current),
        _ => Some(offered),
    }
}

fn is_good(best: &Option<Icon>) -> bool {
    best.as_ref().is_some_and(|icon| icon.source_edge >= GOOD_EDGE)
}

/// Decodes a supported image under limits and re-encodes it as a transparent square PNG: the
/// artwork centred at its own size, or scaled down (Lanczos) to `ICON_MAX_EDGE`. Never scaled up —
/// the tile's CSS downscales a large icon crisply, while an upscale here only stores blur.
pub fn normalize_icon(bytes: &[u8]) -> Result<Icon, FaviconError> {
    let format = sniff_image_format(bytes).ok_or(FaviconError::NotAnImage)?;
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(DECODE_MAX_EDGE);
    limits.max_image_height = Some(DECODE_MAX_EDGE);
    limits.max_alloc = Some(DECODE_MAX_ALLOC);
    reader.limits(limits);
    // An .ico holds several sizes; the decoder opens its largest entry.
    let decoded = reader.decode().map_err(|_| FaviconError::NotAnImage)?.to_rgba8();
    let (width, height) = decoded.dimensions();
    if width == 0 || height == 0 {
        return Err(FaviconError::NotAnImage);
    }
    let source_edge = width.max(height);
    let edge = source_edge.min(ICON_MAX_EDGE);
    let resized = if source_edge > edge {
        let scale = edge as f32 / source_edge as f32;
        let target_width = ((width as f32 * scale).round() as u32).clamp(1, edge);
        let target_height = ((height as f32 * scale).round() as u32).clamp(1, edge);
        image::imageops::resize(&decoded, target_width, target_height, FilterType::Lanczos3)
    } else {
        decoded
    };
    let (target_width, target_height) = resized.dimensions();
    let mut canvas = RgbaImage::new(edge, edge);
    image::imageops::overlay(
        &mut canvas,
        &resized,
        ((edge - target_width) / 2) as i64,
        ((edge - target_height) / 2) as i64,
    );
    let mut png = Vec::new();
    canvas
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|_| FaviconError::NotAnImage)?;
    Ok(Icon { png, source_edge })
}

fn fetch_icon_at(url: &Url, policy: &FetchPolicy) -> Result<Icon, FaviconError> {
    let fetched = get(url, ICON_CAP, "image/png,image/x-icon,image/*;q=0.8", policy, OverCap::Refuse)?;
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

/// The service's icon for a host, or `Ok(None)` for its 404 ("no icon"; never the globe).
fn fetch_service_icon(endpoint: &str, host: &str, policy: &FetchPolicy) -> Result<Option<Icon>, FaviconError> {
    let url = google_icon_url(endpoint, host)?;
    match fetch_icon_at(&url, policy) {
        Ok(icon) => Ok(Some(icon)),
        Err(FaviconError::Status(404)) => Ok(None),
        Err(error) => Err(error),
    }
}

/// The site's icon as a PNG, or `Ok(None)` when no source has one this module will take — the
/// tile then keeps its letter. `Err` is kept for a site that could not be reached at all when no
/// other source answered either; both are cached as a miss today.
pub fn fetch_site_icon(domain: &str, policy: &FetchPolicy) -> Result<Option<Vec<u8>>, FaviconError> {
    let domain = normalize_domain(domain)?;
    let mut best = None;
    if let Some(endpoint) = &policy.icon_service {
        if let Ok(Some(icon)) = fetch_service_icon(endpoint, &domain, policy) {
            best = pick_larger(best, icon);
        }
        if is_good(&best) {
            return Ok(best.map(|icon| icon.png));
        }
    }
    match fetch_from_site(&domain, policy, &mut best) {
        Ok(()) => Ok(best.map(|icon| icon.png)),
        Err(_) if best.is_some() => Ok(best.map(|icon| icon.png)),
        Err(error) => Err(error),
    }
}

/// Asks the site itself, improving on `best` until an icon reaches `GOOD_EDGE`. `Ok(())` once the
/// site answered at all (with or without an icon); `Err` when it could not be reached or is refused.
fn fetch_from_site(domain: &str, policy: &FetchPolicy, best: &mut Option<Icon>) -> Result<(), FaviconError> {
    let scheme = if policy.require_https { "https" } else { "http" };
    let mut home = Url::parse(&format!("{scheme}://{domain}/")).map_err(|_| FaviconError::InvalidDomain)?;
    if let (Some(address), false) = (policy.resolve_override, policy.require_https) {
        // The test server listens on an ephemeral port; production always uses the default one.
        let _ = home.set_port(Some(address.port()));
    }

    let mut base = home.clone();
    let mut tried: Vec<Url> = Vec::new();
    let page = match get(&home, HTML_CAP, "text/html,application/xhtml+xml", policy, OverCap::Cut) {
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
        let mut candidates: Vec<(Url, IconCandidate)> = Vec::new();
        let links = parse_icon_links(&html);
        for candidate in &links {
            if let Some(bytes) = decode_data_url(&candidate.href) {
                if let Ok(icon) = normalize_icon(&bytes) {
                    *best = pick_larger(best.take(), icon);
                }
                continue;
            }
            if let Ok(url) = base.join(&candidate.href) {
                candidates.push((url, candidate.clone()));
            }
        }
        if is_good(best) {
            return Ok(());
        }
        // The manifest is one more request, worth it only when the page claims nothing sharp.
        if !links.iter().any(|candidate| candidate.size >= GOOD_EDGE) {
            if let Some(manifest_url) = parse_manifest_link(&html).and_then(|href| base.join(&href).ok()) {
                if check_url(&manifest_url, policy).is_ok() {
                    if let Ok(manifest) = get(
                        &manifest_url,
                        MANIFEST_CAP,
                        "application/manifest+json,application/json",
                        policy,
                        OverCap::Refuse,
                    ) {
                        let json = String::from_utf8_lossy(&manifest.body);
                        for candidate in parse_manifest_icons(&json) {
                            if let Ok(url) = manifest.url.join(&candidate.href) {
                                candidates.push((url, candidate));
                            }
                        }
                    }
                }
            }
        }
        let mut ranked: Vec<IconCandidate> = candidates
            .iter()
            .map(|(url, candidate)| IconCandidate { href: url.to_string(), ..candidate.clone() })
            .collect();
        rank_candidates(&mut ranked);
        for candidate in ranked.into_iter().take(MAX_PAGE_CANDIDATES) {
            let Ok(url) = Url::parse(&candidate.href) else {
                continue;
            };
            if check_url(&url, policy).is_err() || tried.contains(&url) {
                continue;
            }
            tried.push(url.clone());
            if let Ok(icon) = fetch_icon_at(&url, policy) {
                *best = pick_larger(best.take(), icon);
                if is_good(best) {
                    return Ok(());
                }
            }
        }
    }

    // The conventional location, on the origin the page ended up at and on the one asked for —
    // only while nothing reasonably sharp has turned up (it is usually 16 or 32px).
    if best.as_ref().is_some_and(|icon| icon.source_edge >= MIN_SHARP_EDGE) {
        return Ok(());
    }
    for origin in [&base, &home] {
        let Ok(url) = origin.join("/favicon.ico") else {
            continue;
        };
        if tried.contains(&url) {
            continue;
        }
        tried.push(url.clone());
        match fetch_icon_at(&url, policy) {
            Ok(icon) => {
                *best = pick_larger(best.take(), icon);
                return Ok(());
            }
            Err(FaviconError::Network(_)) | Err(FaviconError::Unresolved) => {}
            Err(_) => reached = true,
        }
    }
    if reached || best.is_some() {
        Ok(())
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
                // A route without a query matches the path with any query (the favicon service's).
                let bare = path.split('?').next().unwrap_or_default().to_string();
                let response = match routes.get(path.as_str()).or_else(|| routes.get(bare.as_str())) {
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
            system_proxy: false,
            icon_service: None,
        }
    }

    /// The local server standing in for the favicon service as well as the site.
    fn service_policy(address: SocketAddr) -> FetchPolicy {
        FetchPolicy {
            icon_service: Some(format!("http://favicons.test:{}/faviconV2", address.port())),
            ..local_policy(address)
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
    fn icons_keep_their_own_resolution_up_to_the_cap_and_are_never_upscaled() {
        let small = normalize_icon(&png_of(16, 16)).unwrap();
        assert_eq!((decoded_size(&small.png), small.source_edge), ((16, 16), 16));
        let sharp = normalize_icon(&png_of(128, 128)).unwrap();
        assert_eq!((decoded_size(&sharp.png), sharp.source_edge), ((128, 128), 128));
        // Wide artwork is centred on a square of its longer edge, scaled down to the cap.
        let wide = normalize_icon(&png_of(300, 120)).unwrap();
        assert_eq!((decoded_size(&wide.png), wide.source_edge), ((ICON_MAX_EDGE, ICON_MAX_EDGE), 300));
        let tall = normalize_icon(&png_of(40, 100)).unwrap();
        assert_eq!(decoded_size(&tall.png), (100, 100));
        // An image larger than the decoder is allowed to open is refused, not decoded.
        let huge = png_of(DECODE_MAX_EDGE + 1, 1);
        assert_eq!(normalize_icon(&huge), Err(FaviconError::NotAnImage));
    }

    #[test]
    fn a_body_over_the_cap_is_dropped_whole() {
        assert_eq!(read_capped(&[1_u8; 10][..], 10).unwrap().len(), 10);
        assert_eq!(read_capped(&[1_u8; 11][..], 10), Err(FaviconError::TooLarge));
        // A page is cut instead: its head is at the top.
        assert_eq!(read_prefix(&[1_u8; 11][..], 10).unwrap().len(), 10);
    }

    #[test]
    fn a_page_over_the_html_cap_is_cut_and_its_head_still_read() {
        let mut page = br#"<head><link rel="apple-touch-icon" href="/apple.png"></head><body>"#.to_vec();
        page.resize(HTML_CAP + 64 * 1024, b'x');
        let (address, hits) = serve(HashMap::from([
            ("/", route("text/html", page)),
            ("/apple.png", route("image/png", png_of(180, 180))),
        ]));
        let icon = fetch_site_icon("icons.test", &local_policy(address)).unwrap().expect("an icon");
        assert_eq!(decoded_size(&icon), (180, 180));
        assert_eq!(*hits.lock().unwrap(), vec!["/", "/apple.png"]);
    }

    #[test]
    fn the_page_icon_is_fetched_from_a_local_server() {
        let page = br#"<head><link rel="icon" sizes="32x32" href="/static/icon.png"></head>"#.to_vec();
        let (address, hits) = serve(HashMap::from([
            ("/", route("text/html; charset=utf-8", page)),
            ("/static/icon.png", route("image/png", png_of(32, 32))),
        ]));
        let icon = fetch_site_icon("icons.test", &local_policy(address)).unwrap().expect("an icon");
        assert_eq!(decoded_size(&icon), (32, 32));
        // 32px is soft, so the conventional /favicon.ico is still asked for (here it has none).
        assert_eq!(*hits.lock().unwrap(), vec!["/", "/static/icon.png", "/favicon.ico"]);
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
        assert_eq!(*hits.lock().unwrap(), vec!["/", "/favicon.ico"]);
    }

    #[test]
    fn declared_sizes_are_read_as_their_largest_edge() {
        assert_eq!(parse_sizes("16x16"), Some(16));
        assert_eq!(parse_sizes("16x16 32x32  192X192"), Some(192));
        assert_eq!(parse_sizes("120x180"), Some(180));
        assert_eq!(parse_sizes("any"), Some(ICON_MAX_EDGE));
        assert_eq!(parse_sizes(""), None);
        assert_eq!(parse_sizes("big"), None);
    }

    #[test]
    fn candidates_rank_the_smallest_sharp_icon_first_then_the_largest_soft_one() {
        let candidate = |href: &str, size| IconCandidate { href: href.into(), size, touch: false };
        let mut ranked = vec![
            candidate("/16.png", 16),
            candidate("/512.png", 512),
            candidate("/96.png", 96),
            candidate("/180.png", 180),
            candidate("/32.png", 32),
            candidate("/180.png", 16),
        ];
        rank_candidates(&mut ranked);
        let hrefs: Vec<&str> = ranked.iter().map(|candidate| candidate.href.as_str()).collect();
        assert_eq!(hrefs, vec!["/180.png", "/512.png", "/96.png", "/32.png", "/16.png"]);
    }

    #[test]
    fn manifest_icons_skip_svg_and_maskable_only_artwork() {
        let html = r#"<link rel="stylesheet" href="/a.css"><link rel="manifest" href="/site.webmanifest?v=2&amp;x">"#;
        assert_eq!(parse_manifest_link(html).as_deref(), Some("/site.webmanifest?v=2&x"));
        assert_eq!(parse_manifest_link("<link rel=icon href=/i.png>"), None);
        let json = r#"{"icons": [
            {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/icon-512.png", "sizes": "512x512", "purpose": "any maskable"},
            {"src": "/mask-512.png", "sizes": "512x512", "purpose": "maskable"},
            {"src": "/logo.svg", "sizes": "any", "type": "image/svg+xml"},
            {"src": "/mono.png", "sizes": "96x96", "purpose": "monochrome"},
            {"src": "/small.png", "sizes": "48x48"}
        ]}"#;
        let hrefs: Vec<String> = parse_manifest_icons(json).into_iter().map(|candidate| candidate.href).collect();
        assert_eq!(hrefs, vec!["/icon-192.png", "/icon-512.png", "/small.png"]);
        assert!(parse_manifest_icons("not json").is_empty());
        assert!(parse_manifest_icons(r#"{"name": "no icons"}"#).is_empty());
    }

    #[test]
    fn the_google_request_names_the_origin_and_asks_for_a_404_instead_of_a_globe() {
        let url = google_icon_url(GOOGLE_FAVICON_ENDPOINT, "github.com").unwrap();
        assert_eq!(
            url.as_str(),
            "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE%2CSIZE%2CURL\
             &url=https%3A%2F%2Fgithub.com&size=128"
        );
        assert!(check_url(&url, &FetchPolicy::strict()).is_ok());
    }

    #[test]
    fn the_larger_of_two_icons_wins_and_a_tie_keeps_the_first() {
        let icon = |edge, tag: u8| Icon { png: vec![tag], source_edge: edge };
        assert_eq!(pick_larger(None, icon(16, 1)), Some(icon(16, 1)));
        assert_eq!(pick_larger(Some(icon(32, 1)), icon(180, 2)), Some(icon(180, 2)));
        assert_eq!(pick_larger(Some(icon(128, 1)), icon(64, 2)), Some(icon(128, 1)));
        assert_eq!(pick_larger(Some(icon(128, 1)), icon(128, 2)), Some(icon(128, 1)));
    }

    #[test]
    fn a_sharp_icon_from_the_service_is_used_without_asking_the_site() {
        let (address, hits) = serve(HashMap::from([("/faviconV2", route("image/png", png_of(128, 128)))]));
        let icon = fetch_site_icon("icons.test", &service_policy(address)).unwrap().expect("an icon");
        assert_eq!(decoded_size(&icon), (128, 128));
        let hits = hits.lock().unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].starts_with("/faviconV2?"), "{}", hits[0]);
        assert!(hits[0].contains("url=https%3A%2F%2Ficons.test&size=128"), "{}", hits[0]);
    }

    #[test]
    fn a_service_404_falls_back_to_the_sites_own_touch_icon() {
        let page = br#"<link rel="icon" href="/favicon-16.png" sizes="16x16"><link rel="apple-touch-icon" href="/apple.png">"#;
        let (address, hits) = serve(HashMap::from([
            ("/", route("text/html", page.to_vec())),
            ("/apple.png", route("image/png", png_of(180, 180))),
        ]));
        let icon = fetch_site_icon("icons.test", &service_policy(address)).unwrap().expect("an icon");
        assert_eq!(decoded_size(&icon), (180, 180));
        let hits = hits.lock().unwrap();
        assert!(hits[0].starts_with("/faviconV2?"));
        assert_eq!(hits[1..], ["/", "/apple.png"]);
    }

    #[test]
    fn a_small_service_icon_loses_to_a_larger_manifest_icon() {
        let page = br#"<link rel="manifest" href="/app.webmanifest">"#;
        let manifest = br#"{"icons": [{"src": "icons/192.png", "sizes": "192x192", "type": "image/png"}]}"#;
        let (address, hits) = serve(HashMap::from([
            ("/faviconV2", route("image/png", png_of(32, 32))),
            ("/", route("text/html", page.to_vec())),
            ("/app.webmanifest", route("application/manifest+json", manifest.to_vec())),
            ("/icons/192.png", route("image/png", png_of(192, 192))),
        ]));
        let icon = fetch_site_icon("icons.test", &service_policy(address)).unwrap().expect("an icon");
        assert_eq!(decoded_size(&icon), (192, 192));
        assert_eq!(hits.lock().unwrap()[1..], ["/", "/app.webmanifest", "/icons/192.png"]);
    }

    #[test]
    fn a_small_service_icon_is_kept_when_the_site_has_nothing_better() {
        let (address, _) = serve(HashMap::from([
            ("/faviconV2", route("image/png", png_of(32, 32))),
            ("/", route("text/html", b"<p>no icons</p>".to_vec())),
        ]));
        let icon = fetch_site_icon("icons.test", &service_policy(address)).unwrap().expect("an icon");
        assert_eq!(decoded_size(&icon), (32, 32));
    }

    #[test]
    fn no_icon_anywhere_is_a_miss_so_the_tile_keeps_its_letter() {
        let (address, _) = serve(HashMap::from([("/", route("text/html", b"<p>hi</p>".to_vec()))]));
        assert_eq!(fetch_site_icon("icons.test", &service_policy(address)), Ok(None));
    }
}
