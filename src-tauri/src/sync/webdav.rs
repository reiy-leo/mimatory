//! Minimal WebDAV client (坚果云, Nextcloud, Synology, Alist, …), mirroring Navill's: Basic auth
//! with an app password, everything inside one folder in the server root (`passless/`, created on
//! connect, plus `passless/blobs/`), ETag + `If-Match` / `If-None-Match: *` for conditional writes.
//!
//! Plain `http://` is refused except for loopback: Basic auth over cleartext would leak the app
//! password even though the payload itself is encrypted.

use super::error::{SyncError, SyncResult};
use super::remote::{Precondition, RemoteObject, RemoteStore, CONNECT_TIMEOUT, REQUEST_TIMEOUT};
use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, ETAG, IF_MATCH, IF_NONE_MATCH};
use reqwest::{Method, StatusCode};

pub const FOLDER: &str = "passless/";
const SUBFOLDERS: [&str; 1] = ["blobs/"];

const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>"#;

/// Normalises what the user typed: adds `https://` when no scheme is given, drops the query and
/// fragment, and ends the path with exactly one `/`.
pub fn normalize_url(input: &str) -> SyncResult<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(SyncError::InvalidUrl);
    }
    let with_scheme = if trimmed.contains("://") { trimmed.to_string() } else { format!("https://{trimmed}") };
    let mut url = url::Url::parse(&with_scheme).map_err(|_| SyncError::InvalidUrl)?;
    if !url.username().is_empty() || url.password().is_some() {
        // Credentials belong in their own fields, not in a URL that could be logged.
        return Err(SyncError::InvalidUrl);
    }
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]" | "::1"));
    match url.scheme() {
        "https" => {}
        "http" if loopback => {}
        _ => return Err(SyncError::InvalidUrl),
    }
    url.set_query(None);
    url.set_fragment(None);
    let path = format!("{}/", url.path().trim_end_matches('/'));
    url.set_path(&path);
    Ok(url.to_string())
}

fn quote_etag(etag: &str) -> String {
    let etag = etag.trim();
    if etag.is_empty() || etag.starts_with('"') || etag.starts_with("W/\"") {
        etag.to_string()
    } else {
        format!("\"{etag}\"")
    }
}

/// The text of the first `<…getetag>` element, whatever the namespace prefix.
pub fn extract_etag(xml: &str) -> Option<String> {
    let lower = xml.to_ascii_lowercase();
    let mut search = 0;
    while let Some(found) = lower[search..].find("getetag") {
        let start = search + found;
        search = start + 7;
        // Opening tag: preceded by '<' or ':' and followed by '>' or whitespace/attributes.
        let before = lower[..start].chars().last();
        if !matches!(before, Some('<') | Some(':')) {
            continue;
        }
        let tag_open = lower[..start].rfind('<')?;
        if lower[tag_open..].starts_with("</") {
            continue;
        }
        let close = start + lower[start..].find('>')?;
        if lower[..close].ends_with('/') {
            return None; // <d:getetag/>
        }
        let end = close + 1 + lower[close + 1..].find('<')?;
        let value = xml[close + 1..end].trim().replace("&quot;", "\"");
        return if value.is_empty() { None } else { Some(quote_etag(&value)) };
    }
    None
}

pub struct WebDavStore {
    base: String,
    username: String,
    password: String,
    client: Client,
}

impl WebDavStore {
    pub fn new(url: &str, username: &str, password: &str) -> SyncResult<Self> {
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            // No redirects: Basic credentials must not follow a server to another host.
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(WebDavStore {
            base: normalize_url(url)?,
            username: username.to_string(),
            password: password.to_string(),
            client,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    fn request(
        &self,
        method: Method,
        path: &str,
        headers: HeaderMap,
        body: Option<Vec<u8>>,
    ) -> SyncResult<Response> {
        let mut builder = self
            .client
            .request(method, self.url(path))
            .basic_auth(&self.username, Some(&self.password))
            .headers(headers);
        if let Some(body) = body {
            builder = builder.body(body);
        }
        Ok(builder.send()?)
    }

    fn propfind(&self, path: &str) -> SyncResult<Response> {
        let mut headers = HeaderMap::new();
        headers.insert("Depth", HeaderValue::from_static("0"));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/xml; charset=utf-8"));
        self.request(
            Method::from_bytes(b"PROPFIND").expect("valid method"),
            path,
            headers,
            Some(PROPFIND_BODY.as_bytes().to_vec()),
        )
    }

    fn etag_of(&self, path: &str) -> SyncResult<String> {
        let response = self.propfind(path)?;
        if !response.status().is_success() {
            return Ok(String::new());
        }
        Ok(extract_etag(&response.text().unwrap_or_default()).unwrap_or_default())
    }

    fn mkcol(&self, path: &str) -> SyncResult<()> {
        let response =
            self.request(Method::from_bytes(b"MKCOL").expect("valid method"), path, HeaderMap::new(), None)?;
        match response.status().as_u16() {
            200..=299 | 405 => Ok(()), // 405: already exists
            status => Err(SyncError::http(status)),
        }
    }

    fn path_of(name: &str) -> String {
        format!("{FOLDER}{name}")
    }
}

fn header_etag(response: &Response) -> String {
    response
        .headers()
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .map(quote_etag)
        .unwrap_or_default()
}

impl RemoteStore for WebDavStore {
    fn prepare(&mut self) -> SyncResult<()> {
        // Verifies the URL and the credentials before anything is created.
        let response = self.propfind("")?;
        let status = response.status();
        if !(status.is_success() || status == StatusCode::MULTI_STATUS) {
            return Err(SyncError::http(status.as_u16()));
        }
        self.mkcol(FOLDER)?;
        for sub in SUBFOLDERS {
            self.mkcol(&format!("{FOLDER}{sub}"))?;
        }
        Ok(())
    }

    fn get(&mut self, name: &str) -> SyncResult<Option<RemoteObject>> {
        let path = Self::path_of(name);
        let response = self.request(Method::GET, &path, HeaderMap::new(), None)?;
        let status = response.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(SyncError::http(status.as_u16()));
        }
        let mut etag = header_etag(&response);
        let bytes = response.bytes()?.to_vec();
        if etag.is_empty() {
            etag = self.etag_of(&path)?;
        }
        Ok(Some(RemoteObject { bytes, etag }))
    }

    fn put(&mut self, name: &str, bytes: Vec<u8>, precondition: Precondition) -> SyncResult<String> {
        let path = Self::path_of(name);
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
        match &precondition {
            Precondition::None => {}
            Precondition::IfMatch(etag) if !etag.is_empty() => {
                headers.insert(
                    IF_MATCH,
                    HeaderValue::from_str(etag).map_err(|_| SyncError::InvalidRemote("etag".to_string()))?,
                );
            }
            Precondition::IfMatch(_) => {}
            Precondition::IfNoneMatch => {
                headers.insert(IF_NONE_MATCH, HeaderValue::from_static("*"));
            }
        }
        let response = self.request(Method::PUT, &path, headers, Some(bytes))?;
        let status = response.status();
        if !status.is_success() {
            return Err(SyncError::http(status.as_u16()));
        }
        let etag = header_etag(&response);
        if !etag.is_empty() {
            return Ok(etag);
        }
        self.etag_of(&path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_normalised_and_cleartext_is_refused_off_loopback() {
        assert_eq!(normalize_url("dav.jianguoyun.com/dav").unwrap(), "https://dav.jianguoyun.com/dav/");
        assert_eq!(normalize_url("https://x.example/dav///?a=1#f").unwrap(), "https://x.example/dav/");
        assert_eq!(normalize_url("http://127.0.0.1:8080").unwrap(), "http://127.0.0.1:8080/");
        assert!(normalize_url("http://nas.local/dav").is_err());
        assert!(normalize_url("https://user:pw@x.example/").is_err());
        assert!(normalize_url("ftp://x.example/").is_err());
        assert!(normalize_url("  ").is_err());
    }

    #[test]
    fn etags_are_read_from_any_namespace_and_quoted() {
        let xml = r#"<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:propstat><D:prop><D:getetag>abc-123</D:getetag></D:prop></D:propstat></D:response></D:multistatus>"#;
        assert_eq!(extract_etag(xml).as_deref(), Some("\"abc-123\""));
        let xml = r#"<multistatus><response><prop><getetag>&quot;q&quot;</getetag></prop></response></multistatus>"#;
        assert_eq!(extract_etag(xml).as_deref(), Some("\"q\""));
        assert_eq!(extract_etag("<d:prop><d:getetag/></d:prop>"), None);
        assert_eq!(quote_etag("W/\"x\""), "W/\"x\"");
    }
}
