//! The local channel between the native-messaging host (`mimatory chrome-extension://…`, started by the
//! browser) and the running app (2026-10-24). Same framing as the browser's stdio (4-byte native-endian
//! length + JSON), over:
//! - macOS: a Unix socket in the vault folder `~/Library/Application Support/Mimatory/` (0700), socket 0600;
//! - Linux: a Unix socket in `$XDG_RUNTIME_DIR/mimatory/` (0700; the vault folder when unset), socket 0600;
//! - Windows: the named pipe `\\.\pipe\mimatory-native-messaging-<user>` with the default per-user ACL,
//!   created with FILE_FLAG_FIRST_PIPE_INSTANCE and PIPE_REJECT_REMOTE_CLIENTS (compile-checked only).
//!
//! Each side checks the other: the app accepts a connection only from a process running **our own
//! executable** (same path, or a byte-identical copy — an AppImage remounts on every launch), owned by
//! the same user, and on macOS only when that host's **parent** — the browser that started it — carries
//! a valid code signature from a known browser team (`BROWSER_TEAMS`). The host in turn talks only to a
//! server running our executable. A failed check answers every request `403 caller_not_verified`; in a
//! debug build (`debug_assertions`) an unsigned browser (Playwright's Chromium, a local Chromium build)
//! is logged and let through instead. See AGENTS.md "Extension connection".

use crate::native_messaging::{read_frame, write_frame, MAX_MESSAGE_FROM_BROWSER};
use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

/// App → host. The host caps what it hands Chrome at 1 MB itself, with a clear error.
pub const MAX_REPLY: usize = 4 * 1024 * 1024;

#[cfg(unix)]
pub type Stream = std::os::unix::net::UnixStream;
#[cfg(windows)]
pub type Stream = std::fs::File;

/// Browsers whose signed main executable may start the host on macOS, by Apple Developer Team ID.
/// Checked 2026-10-24: Chrome, Brave, Arc, Vivaldi, Firefox and Opera against Installomator's
/// `expectedTeamID` labels; Edge (Microsoft Corporation) against the Developer ID strings published in
/// osquery-defense-kit and fullmetalmac.com; Vivaldi also against help.vivaldi.com, Brave against its
/// own release note, Arc against AzureAD/microsoft-authentication-library-for-objc#3116. Chromium and
/// Playwright builds are unsigned and are refused in a release build.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const BROWSER_TEAMS: &[(&str, &str)] = &[
    ("Google Chrome", "EQHXZ8M8AV"),
    ("Microsoft Edge", "UBF8T346G9"),
    ("Brave", "KL8N8XSYF4"),
    ("Arc", "S6N382Y83G"),
    ("Vivaldi", "4XF3XNRN6Y"),
    ("Firefox", "43AQ936H96"),
    ("Opera", "A2P9LX4JPN"),
];

/// The code requirement a browser must satisfy: signed through Apple's chain by that team.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn browser_requirement(team: &str) -> String {
    format!("anchor apple generic and certificate leaf[subject.OU] = \"{team}\"")
}

/// Who is on the other end of an accepted connection.
#[derive(Debug, Clone)]
pub struct Peer {
    /// The host process (handlers do not need it today; kept for logging and tests).
    #[allow(dead_code)]
    pub pid: u32,
    /// The browser that started the host, when its signature was checked (macOS).
    pub browser: Option<String>,
}

pub type Handler = Arc<dyn Fn(&[u8], &Peer) -> Vec<u8> + Send + Sync>;

static ACTIVE_CONNECTIONS: AtomicUsize = AtomicUsize::new(0);
static LAST_BROWSER: Mutex<Option<String>> = Mutex::new(None);

/// How many native hosts (browser windows' extensions) are connected right now, and the last
/// verified browser — for Settings ▸ Browser Extension.
pub fn connection_status() -> (usize, Option<String>) {
    let browser = LAST_BROWSER.lock().ok().and_then(|value| value.clone());
    (ACTIVE_CONNECTIONS.load(Ordering::SeqCst), browser)
}

fn reject(message: &[u8], error: &str) -> Vec<u8> {
    let id = serde_json::from_slice::<Value>(message)
        .ok()
        .and_then(|value| value.get("id").cloned())
        .unwrap_or(Value::Null);
    serde_json::to_vec(&json!({
        "id": id,
        "status": 403,
        "data": { "error": "caller_not_verified", "detail": error },
    }))
    .unwrap_or_default()
}

fn serve_connection<S: Read + Write>(mut stream: S, peer: Result<Peer, String>, handler: Handler) {
    if let Ok(peer) = &peer {
        ACTIVE_CONNECTIONS.fetch_add(1, Ordering::SeqCst);
        if let (Some(browser), Ok(mut last)) = (&peer.browser, LAST_BROWSER.lock()) {
            *last = Some(browser.clone());
        }
    }
    if let Err(error) = &peer {
        eprintln!("Mimatory: native messaging caller refused: {error}");
    }
    while let Ok(Some(message)) = read_frame(&mut stream, MAX_MESSAGE_FROM_BROWSER) {
        let reply = match &peer {
            Ok(peer) => handler(&message, peer),
            Err(error) => reject(&message, error),
        };
        if write_frame(&mut stream, &reply).is_err() {
            break;
        }
    }
    if peer.is_ok() {
        ACTIVE_CONNECTIONS.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Whether `peer` runs the same program as this process: the same file, or (an AppImage mounts afresh
/// on every launch, an app moved while running) a byte-identical one.
fn same_executable(peer: &Path) -> bool {
    let Ok(own) = std::env::current_exe() else {
        return false;
    };
    let own = std::fs::canonicalize(&own).unwrap_or(own);
    let peer = std::fs::canonicalize(peer).unwrap_or_else(|_| peer.to_path_buf());
    if own == peer {
        return true;
    }
    files_identical(&own, &peer)
}

fn files_identical(a: &Path, b: &Path) -> bool {
    use sha2::{Digest, Sha256};
    let (Ok(meta_a), Ok(meta_b)) = (std::fs::metadata(a), std::fs::metadata(b)) else {
        return false;
    };
    if meta_a.len() != meta_b.len() {
        return false;
    }
    let digest = |path: &Path| -> Option<Vec<u8>> {
        let mut file = std::fs::File::open(path).ok()?;
        let mut hasher = Sha256::new();
        io::copy(&mut file, &mut hasher).ok()?;
        Some(hasher.finalize().to_vec())
    };
    matches!((digest(a), digest(b)), (Some(x), Some(y)) if x == y)
}

/// A Linux `/proc/<pid>/exe` of a binary replaced since it started reads "<path> (deleted)".
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn strip_deleted(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_suffix(" (deleted)") {
        Some(stripped) => PathBuf::from(stripped),
        None => path,
    }
}

// ---------------------------------------------------------------- Unix (macOS, Linux)

#[cfg(unix)]
pub fn socket_path() -> io::Result<PathBuf> {
    let missing = || io::Error::new(io::ErrorKind::NotFound, "no data directory");
    #[cfg(target_os = "macos")]
    let directory = dirs::data_dir().ok_or_else(missing)?.join("Mimatory");
    #[cfg(not(target_os = "macos"))]
    let directory = match dirs::runtime_dir() {
        Some(runtime) => runtime.join("mimatory"),
        None => dirs::data_dir().ok_or_else(missing)?.join("Mimatory"),
    };
    Ok(directory.join("native-messaging.sock"))
}

#[cfg(unix)]
fn create_private_directory(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

/// Starts the app's listener (desktop startup). Any stale socket from a crashed run is replaced; the
/// single-instance plugin keeps a second app from getting here.
#[cfg(unix)]
pub fn start_server(handler: Handler) -> io::Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::UnixListener;
    let path = socket_path()?;
    if let Some(parent) = path.parent() {
        create_private_directory(parent)?;
    }
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let handler = handler.clone();
            thread::spawn(move || {
                let peer = verify_client(&stream);
                serve_connection(stream, peer, handler);
            });
        }
    });
    Ok(path)
}

/// The host's side: connect, and make sure the listener is our own app.
#[cfg(unix)]
pub fn connect() -> io::Result<Stream> {
    let stream = Stream::connect(socket_path()?)?;
    let (pid, uid) = peer_credentials(&stream)?;
    // SAFETY: geteuid has no preconditions.
    if uid != unsafe { libc::geteuid() } {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "socket owned by another user"));
    }
    if !same_executable(&process_executable(pid)?) {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "socket served by another program"));
    }
    Ok(stream)
}

#[cfg(unix)]
fn verify_client(stream: &Stream) -> Result<Peer, String> {
    let (pid, uid) = peer_credentials(stream).map_err(|error| format!("peer credentials: {error}"))?;
    // SAFETY: geteuid has no preconditions.
    if uid != unsafe { libc::geteuid() } {
        return Err(format!("peer {pid} belongs to uid {uid}"));
    }
    let executable = process_executable(pid).map_err(|error| format!("peer {pid} executable: {error}"))?;
    if !same_executable(&executable) {
        return Err(format!("peer {pid} runs {}", executable.display()));
    }
    let browser = verify_browser(pid)?;
    Ok(Peer { pid, browser })
}

#[cfg(target_os = "linux")]
fn peer_credentials(stream: &Stream) -> io::Result<(u32, u32)> {
    use std::os::unix::io::AsRawFd;
    // SAFETY: `ucred` is plain data; getsockopt writes at most `length` bytes into it.
    unsafe {
        let mut credentials: libc::ucred = std::mem::zeroed();
        let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        let result = libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            &mut credentials as *mut libc::ucred as *mut libc::c_void,
            &mut length,
        );
        if result != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok((credentials.pid as u32, credentials.uid))
    }
}

#[cfg(target_os = "linux")]
fn process_executable(pid: u32) -> io::Result<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/exe")).map(strip_deleted)
}

/// Linux: no browser signature to check (distributions sign packages, not executables); the peer
/// must be our own binary and the same user, which is what a browser-started host is.
#[cfg(all(unix, not(target_os = "macos")))]
fn verify_browser(_host_pid: u32) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(target_os = "macos")]
const SOL_LOCAL: libc::c_int = 0;
#[cfg(target_os = "macos")]
const LOCAL_PEERPID: libc::c_int = 0x002;

#[cfg(target_os = "macos")]
fn peer_credentials(stream: &Stream) -> io::Result<(u32, u32)> {
    use std::os::unix::io::AsRawFd;
    let fd = stream.as_raw_fd();
    // SAFETY: both calls write plain integers of the sizes passed.
    unsafe {
        let mut uid: libc::uid_t = 0;
        let mut gid: libc::gid_t = 0;
        if libc::getpeereid(fd, &mut uid, &mut gid) != 0 {
            return Err(io::Error::last_os_error());
        }
        let mut pid: libc::pid_t = 0;
        let mut length = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
        let result = libc::getsockopt(
            fd,
            SOL_LOCAL,
            LOCAL_PEERPID,
            &mut pid as *mut libc::pid_t as *mut libc::c_void,
            &mut length,
        );
        if result != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok((pid as u32, uid))
    }
}

#[cfg(target_os = "macos")]
fn process_executable(pid: u32) -> io::Result<PathBuf> {
    use std::os::unix::ffi::OsStrExt;
    let mut buffer = vec![0_u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: proc_pidpath writes at most `buffer.len()` bytes and returns how many.
    let length = unsafe {
        libc::proc_pidpath(pid as libc::c_int, buffer.as_mut_ptr() as *mut libc::c_void, buffer.len() as u32)
    };
    if length <= 0 {
        return Err(io::Error::last_os_error());
    }
    buffer.truncate(length as usize);
    Ok(PathBuf::from(std::ffi::OsStr::from_bytes(&buffer)))
}

#[cfg(target_os = "macos")]
fn parent_pid(pid: u32) -> io::Result<u32> {
    // SAFETY: proc_bsdinfo is plain data; proc_pidinfo fills it and returns the bytes written.
    unsafe {
        let mut info: libc::proc_bsdinfo = std::mem::zeroed();
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
        let written = libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut info as *mut libc::proc_bsdinfo as *mut libc::c_void,
            size,
        );
        if written != size {
            return Err(io::Error::last_os_error());
        }
        Ok(info.pbi_ppid)
    }
}

/// macOS: the host's parent is the browser that started it (Chrome, Edge, Firefox… start native
/// hosts straight from their main process). Its running code must validate against one of the
/// browser teams' requirements. A debug build logs a failure instead of refusing it.
#[cfg(target_os = "macos")]
fn verify_browser(host_pid: u32) -> Result<Option<String>, String> {
    let checked = parent_pid(host_pid)
        .map_err(|error| format!("parent of {host_pid}: {error}"))
        .and_then(|browser_pid| code_signing::browser_of(browser_pid as i32));
    match checked {
        Ok(browser) => Ok(Some(browser.to_string())),
        Err(error) if cfg!(debug_assertions) => {
            eprintln!("Mimatory (debug build): accepting an unverified browser: {error}");
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "macos")]
mod code_signing {
    use super::{browser_requirement, BROWSER_TEAMS};
    use core_foundation_sys::base::{kCFAllocatorDefault, CFIndex, CFRelease, CFTypeRef, OSStatus};
    use core_foundation_sys::dictionary::{
        kCFTypeDictionaryKeyCallBacks, kCFTypeDictionaryValueCallBacks, CFDictionaryCreate, CFDictionaryRef,
    };
    use core_foundation_sys::number::{kCFNumberSInt32Type, CFNumberCreate};
    use core_foundation_sys::string::{kCFStringEncodingUTF8, CFStringCreateWithBytes, CFStringRef};
    use std::ffi::c_void;
    use std::ptr::null_mut;

    type SecCodeRef = *mut c_void;
    type SecRequirementRef = *mut c_void;
    const K_SEC_CS_DEFAULT_FLAGS: u32 = 0;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        static kSecGuestAttributePid: CFStringRef;
        fn SecCodeCopyGuestWithAttributes(
            host: SecCodeRef,
            attributes: CFDictionaryRef,
            flags: u32,
            guest: *mut SecCodeRef,
        ) -> OSStatus;
        fn SecRequirementCreateWithString(
            text: CFStringRef,
            flags: u32,
            requirement: *mut SecRequirementRef,
        ) -> OSStatus;
        fn SecCodeCheckValidity(code: SecCodeRef, flags: u32, requirement: SecRequirementRef) -> OSStatus;
    }

    /// The name of the known browser whose signature the running process `pid` carries.
    pub fn browser_of(pid: i32) -> Result<&'static str, String> {
        // SAFETY: every CF/Sec object created here is released exactly once below; the pointers passed
        // in live for the duration of each call.
        unsafe {
            let number = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &pid as *const i32 as *const c_void);
            if number.is_null() {
                return Err("CFNumberCreate failed".into());
            }
            let keys = [kSecGuestAttributePid as *const c_void];
            let values = [number as *const c_void];
            let attributes = CFDictionaryCreate(
                kCFAllocatorDefault,
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            );
            CFRelease(number as CFTypeRef);
            if attributes.is_null() {
                return Err("CFDictionaryCreate failed".into());
            }
            let mut code: SecCodeRef = null_mut();
            let status = SecCodeCopyGuestWithAttributes(null_mut(), attributes, K_SEC_CS_DEFAULT_FLAGS, &mut code);
            CFRelease(attributes as CFTypeRef);
            if status != 0 || code.is_null() {
                return Err(format!("no code object for browser pid {pid} (OSStatus {status})"));
            }
            let mut found = None;
            for (name, team) in BROWSER_TEAMS {
                let text = browser_requirement(team);
                let string = CFStringCreateWithBytes(
                    kCFAllocatorDefault,
                    text.as_ptr(),
                    text.len() as CFIndex,
                    kCFStringEncodingUTF8,
                    0,
                );
                if string.is_null() {
                    continue;
                }
                let mut requirement: SecRequirementRef = null_mut();
                let created = SecRequirementCreateWithString(string, K_SEC_CS_DEFAULT_FLAGS, &mut requirement);
                CFRelease(string as CFTypeRef);
                if created != 0 || requirement.is_null() {
                    continue;
                }
                let valid = SecCodeCheckValidity(code, K_SEC_CS_DEFAULT_FLAGS, requirement);
                CFRelease(requirement as CFTypeRef);
                if valid == 0 {
                    found = Some(*name);
                    break;
                }
            }
            CFRelease(code as CFTypeRef);
            found.ok_or_else(|| format!("browser pid {pid} is not signed by a known browser team"))
        }
    }
}

// ---------------------------------------------------------------- Windows

#[cfg(windows)]
pub fn pipe_name() -> String {
    let user: String = std::env::var("USERNAME")
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    format!(r"\\.\pipe\mimatory-native-messaging-{user}")
}

#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn process_executable(pid: u32) -> io::Result<PathBuf> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    // SAFETY: the handle is closed on every path; the buffer outlives the call that fills it.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return Err(io::Error::last_os_error());
        }
        let mut buffer = vec![0_u16; 32768];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut length);
        CloseHandle(process);
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize])))
    }
}

/// Windows: the client must run our executable (Chrome starts hosts through `cmd.exe`, so the
/// browser's own signature is not checked here — unverified, see AGENTS.md).
#[cfg(windows)]
fn verify_client_pid(pid: u32) -> Result<Peer, String> {
    let executable = process_executable(pid).map_err(|error| format!("peer {pid} executable: {error}"))?;
    if !same_executable(&executable) {
        return Err(format!("peer {pid} runs {}", executable.display()));
    }
    Ok(Peer { pid, browser: None })
}

#[cfg(windows)]
pub fn start_server(handler: Handler) -> io::Result<PathBuf> {
    use std::os::windows::io::{FromRawHandle, RawHandle};
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX};
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, GetNamedPipeClientProcessId, PIPE_READMODE_BYTE,
        PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };
    let name = pipe_name();
    let wide_name = wide(&name);
    let create = move |first: bool| {
        let mode = PIPE_ACCESS_DUPLEX | if first { FILE_FLAG_FIRST_PIPE_INSTANCE } else { 0 };
        // SAFETY: `wide_name` is NUL-terminated; a null security descriptor means the default ACL.
        unsafe {
            CreateNamedPipeW(
                wide_name.as_ptr(),
                mode,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                65536,
                65536,
                0,
                std::ptr::null(),
            )
        }
    };
    // The first instance is created here so a pipe someone else already owns is an error now.
    let first = create(true);
    if first == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let first = first as usize;
    thread::spawn(move || {
        let mut next = Some(first);
        loop {
            let handle = match next.take() {
                Some(handle) => handle as windows_sys::Win32::Foundation::HANDLE,
                None => create(false),
            };
            if handle == INVALID_HANDLE_VALUE {
                thread::sleep(std::time::Duration::from_millis(200));
                continue;
            }
            // SAFETY: `handle` is a pipe instance we own; ownership moves into the File below.
            unsafe {
                let connected = ConnectNamedPipe(handle, std::ptr::null_mut()) != 0
                    || GetLastError() == ERROR_PIPE_CONNECTED;
                if !connected {
                    CloseHandle(handle);
                    continue;
                }
                let mut pid = 0_u32;
                let peer = if GetNamedPipeClientProcessId(handle, &mut pid) != 0 {
                    verify_client_pid(pid)
                } else {
                    Err("no client process id".to_string())
                };
                let stream = std::fs::File::from_raw_handle(handle as RawHandle);
                let handler = handler.clone();
                thread::spawn(move || serve_connection(stream, peer, handler));
            }
        }
    });
    Ok(PathBuf::from(name))
}

#[cfg(windows)]
pub fn connect() -> io::Result<Stream> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;
    const ERROR_PIPE_BUSY: i32 = 231;
    let name = pipe_name();
    let mut attempts = 0;
    let stream = loop {
        match std::fs::OpenOptions::new().read(true).write(true).open(&name) {
            Ok(file) => break file,
            Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY) && attempts < 20 => {
                attempts += 1;
                thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(error) => return Err(error),
        }
    };
    let mut pid = 0_u32;
    // SAFETY: the handle belongs to `stream`, alive for the call.
    let ok = unsafe { GetNamedPipeServerProcessId(stream.as_raw_handle() as _, &mut pid) };
    if ok == 0 || !same_executable(&process_executable(pid)?) {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "pipe served by another program"));
    }
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_teams_are_ten_character_team_ids() {
        for (name, team) in BROWSER_TEAMS {
            assert_eq!(team.len(), 10, "{name}");
            assert!(team.bytes().all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit()), "{name}");
        }
        assert_eq!(
            browser_requirement("EQHXZ8M8AV"),
            "anchor apple generic and certificate leaf[subject.OU] = \"EQHXZ8M8AV\""
        );
    }

    #[test]
    fn a_replaced_binary_still_names_its_path() {
        assert_eq!(strip_deleted(PathBuf::from("/usr/bin/mimatory (deleted)")), PathBuf::from("/usr/bin/mimatory"));
        assert_eq!(strip_deleted(PathBuf::from("/usr/bin/mimatory")), PathBuf::from("/usr/bin/mimatory"));
    }

    #[test]
    fn an_unverified_caller_gets_403_with_its_id() {
        let reply: Value = serde_json::from_slice(&reject(br#"{"id":3,"path":"/fill"}"#, "nope")).unwrap();
        assert_eq!(reply["id"], 3);
        assert_eq!(reply["status"], 403);
        assert_eq!(reply["data"]["error"], "caller_not_verified");
    }

    /// The real socket: the listener is created 0600 in a 0700 folder, the test binary connects to
    /// itself (same executable on both ends, so both peer checks pass) and gets its answer back.
    #[cfg(target_os = "linux")]
    #[test]
    fn the_socket_is_private_and_relays_a_request() {
        use std::os::unix::fs::PermissionsExt;
        let runtime = std::env::temp_dir().join(format!("mimatory-ipc-{}", std::process::id()));
        std::fs::create_dir_all(&runtime).unwrap();
        std::env::set_var("XDG_RUNTIME_DIR", &runtime);
        let handler: Handler = Arc::new(|message, peer| {
            assert_eq!(peer.pid, std::process::id());
            [b"echo:".as_slice(), message].concat()
        });
        let path = start_server(handler).unwrap();
        assert_eq!(path, runtime.join("mimatory/native-messaging.sock"));
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().unwrap()), 0o700);
        let mut stream = connect().unwrap();
        write_frame(&mut stream, b"{}").unwrap();
        assert_eq!(read_frame(&mut stream, 64).unwrap().unwrap(), b"echo:{}");
        drop(stream);
        let _ = std::fs::remove_dir_all(runtime);
    }

    #[test]
    fn a_connection_answers_until_the_peer_hangs_up() {
        // Two requests in, two answers out, through the real framing.
        let mut input = Vec::new();
        write_frame(&mut input, br#"{"id":1}"#).unwrap();
        write_frame(&mut input, br#"{"id":2}"#).unwrap();
        struct Duplex {
            input: io::Cursor<Vec<u8>>,
            output: Vec<u8>,
        }
        impl Read for Duplex {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                self.input.read(buffer)
            }
        }
        impl Write for Duplex {
            fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
                self.output.write(buffer)
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let duplex = Arc::new(Mutex::new(Vec::new()));
        let seen = duplex.clone();
        let handler: Handler = Arc::new(move |message, _| {
            seen.lock().unwrap().push(message.to_vec());
            b"ok".to_vec()
        });
        let mut stream = Duplex { input: io::Cursor::new(input), output: Vec::new() };
        serve_connection(&mut stream, Ok(Peer { pid: 1, browser: None }), handler);
        assert_eq!(duplex.lock().unwrap().len(), 2);
        let mut output = stream.output.as_slice();
        assert_eq!(read_frame(&mut output, 16).unwrap().unwrap(), b"ok");
        assert_eq!(read_frame(&mut output, 16).unwrap().unwrap(), b"ok");
        assert_eq!(ACTIVE_CONNECTIONS.load(Ordering::SeqCst), 0);
    }
}
