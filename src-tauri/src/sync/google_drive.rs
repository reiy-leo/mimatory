//! Google Drive `appDataFolder` store: a hidden, app-private folder in the user's Drive (scope
//! `drive.appdata`) that neither the user's Drive UI nor any other app can see. The folder is flat,
//! so logical names map to file names (`blobs/<id>.bin` → `blobs.<id>.bin`).
//!
//! Drive v3 has no `If-Match` on uploads, so the ETag is the file's `version` and a conditional
//! write re-reads the version right before uploading. That narrows the race to the gap between the
//! check and the upload (much smaller than a sync round, but not zero) — documented in
//! `.agent/sync.md`; the per-record merge means a lost race costs at most the other device's last
//! few seconds of changes until it syncs again, since that device still holds them locally and its
//! base marks them as unsynced.

use super::error::{SyncError, SyncResult};
use super::oauth::{self, GoogleClient};
use super::remote::{Precondition, RemoteObject, RemoteStore, CONNECT_TIMEOUT, REQUEST_TIMEOUT};
use reqwest::blocking::{Client, RequestBuilder, Response};
use serde::Deserialize;
use std::collections::HashMap;

const API: &str = "https://www.googleapis.com/drive/v3";
const UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3";

#[derive(Deserialize)]
struct FileList {
    #[serde(default)]
    files: Vec<DriveFile>,
}

#[derive(Clone, Deserialize)]
struct DriveFile {
    id: String,
    #[serde(default)]
    version: Option<serde_json::Value>,
}

impl DriveFile {
    fn version(&self) -> String {
        match &self.version {
            Some(serde_json::Value::String(v)) => v.clone(),
            Some(other) => other.to_string(),
            None => String::new(),
        }
    }
}

#[derive(Deserialize)]
struct DriveError {
    error: DriveErrorBody,
}

#[derive(Deserialize)]
struct DriveErrorBody {
    #[serde(default)]
    message: String,
}

pub fn drive_name(name: &str) -> String {
    name.replace('/', ".")
}

pub struct DriveStore {
    client: Client,
    google: GoogleClient,
    refresh_token: String,
    access_token: String,
    api: String,
    upload: String,
    ids: HashMap<String, String>,
}

impl DriveStore {
    /// Needs a refresh token; fetches an access token right away (so a revoked grant surfaces as
    /// `GoogleReauth` before any data is touched).
    pub fn new(google: GoogleClient, refresh_token: &str) -> SyncResult<Self> {
        let access_token = oauth::refresh(&google, refresh_token)?;
        Self::with_token(google, refresh_token, access_token)
    }

    pub fn with_token(google: GoogleClient, refresh_token: &str, access_token: String) -> SyncResult<Self> {
        let client = Client::builder().connect_timeout(CONNECT_TIMEOUT).timeout(REQUEST_TIMEOUT).build()?;
        Ok(DriveStore {
            client,
            google,
            refresh_token: refresh_token.to_string(),
            access_token,
            api: API.to_string(),
            upload: UPLOAD.to_string(),
            ids: HashMap::new(),
        })
    }

    /// Sends with the bearer token; one 401 refreshes the token and retries.
    fn send(&mut self, build: impl Fn(&Client) -> RequestBuilder) -> SyncResult<Response> {
        for attempt in 0..2 {
            let response = build(&self.client).bearer_auth(&self.access_token).send()?;
            if response.status().as_u16() == 401 && attempt == 0 {
                self.access_token = oauth::refresh(&self.google, &self.refresh_token)?;
                continue;
            }
            return Ok(response);
        }
        unreachable!()
    }

    fn check(response: Response) -> SyncResult<Response> {
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let detail = response
            .json::<DriveError>()
            .map(|e| e.error.message.chars().take(160).collect())
            .unwrap_or_default();
        Err(SyncError::Http { status: status.as_u16(), detail })
    }

    fn find(&mut self, name: &str) -> SyncResult<Option<DriveFile>> {
        let file_name = drive_name(name);
        let query = format!("name = '{}' and 'appDataFolder' in parents and trashed = false", file_name.replace('\'', "\\'"));
        let api = self.api.clone();
        let response = self.send(|client| {
            client.get(format!("{api}/files")).query(&[
                ("spaces", "appDataFolder"),
                ("q", query.as_str()),
                ("orderBy", "createdTime"),
                ("fields", "files(id,version)"),
                ("pageSize", "10"),
            ])
        })?;
        let list: FileList = Self::check(response)?.json()?;
        // Two devices creating the same file at once leave duplicates; the oldest is canonical.
        let file = list.files.into_iter().next();
        if let Some(file) = &file {
            self.ids.insert(name.to_string(), file.id.clone());
        }
        Ok(file)
    }

    fn create(&mut self, name: &str, bytes: Vec<u8>) -> SyncResult<String> {
        let boundary = format!("mimatory-{}", uuid::Uuid::new_v4().simple());
        let metadata = serde_json::json!({ "name": drive_name(name), "parents": ["appDataFolder"] });
        let mut body = Vec::with_capacity(bytes.len() + 512);
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(&bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let upload = self.upload.clone();
        let response = self.send(|client| {
            client
                .post(format!("{upload}/files"))
                .query(&[("uploadType", "multipart"), ("fields", "id,version")])
                .header("Content-Type", format!("multipart/related; boundary={boundary}"))
                .body(body.clone())
        })?;
        let file: DriveFile = Self::check(response)?.json()?;
        self.ids.insert(name.to_string(), file.id.clone());
        Ok(file.version())
    }

    fn update(&mut self, id: &str, bytes: Vec<u8>) -> SyncResult<String> {
        let upload = self.upload.clone();
        let response = self.send(|client| {
            client
                .patch(format!("{upload}/files/{id}"))
                .query(&[("uploadType", "media"), ("fields", "id,version")])
                .header("Content-Type", "application/octet-stream")
                .body(bytes.clone())
        })?;
        let file: DriveFile = Self::check(response)?.json()?;
        Ok(file.version())
    }
}

impl RemoteStore for DriveStore {
    fn prepare(&mut self) -> SyncResult<()> {
        // appDataFolder always exists; listing it proves the token and the scope.
        self.find(super::remote::MANIFEST).map(|_| ())
    }

    fn get(&mut self, name: &str) -> SyncResult<Option<RemoteObject>> {
        let Some(file) = self.find(name)? else { return Ok(None) };
        let api = self.api.clone();
        let id = file.id.clone();
        let response = self.send(|client| client.get(format!("{api}/files/{id}")).query(&[("alt", "media")]))?;
        let bytes = Self::check(response)?.bytes()?.to_vec();
        Ok(Some(RemoteObject { bytes, etag: file.version() }))
    }

    fn put(&mut self, name: &str, bytes: Vec<u8>, precondition: Precondition) -> SyncResult<String> {
        let existing = self.find(name)?;
        match (&precondition, existing) {
            (Precondition::IfNoneMatch, Some(_)) => Err(SyncError::http(412)),
            (Precondition::IfMatch(expected), Some(file)) if !expected.is_empty() && file.version() != *expected => {
                Err(SyncError::http(412))
            }
            (Precondition::IfMatch(expected), None) if !expected.is_empty() => Err(SyncError::http(412)),
            (_, Some(file)) => self.update(&file.id, bytes),
            (_, None) => self.create(name, bytes),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_names_are_flat() {
        assert_eq!(drive_name("blobs/abc.bin"), "blobs.abc.bin");
        assert_eq!(drive_name("vault.enc"), "vault.enc");
    }
}
