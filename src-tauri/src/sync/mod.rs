//! Cloud sync (owner request 2026-10-23, reversing the 2026-10-09 "no sync" ruling): Google Drive's
//! `appDataFolder` **or** a WebDAV server, one at a time, like Navill. Only ciphertext leaves the
//! device. Design, remote layout and open owner decisions: `.agent/sync.md`.

pub mod cipher;
pub mod config;
pub mod engine;
pub mod error;
pub mod google_drive;
pub mod local;
pub mod merge;
pub mod oauth;
pub mod records;
pub mod remote;
pub mod webdav;

pub mod commands;

#[cfg(test)]
mod e2e;
