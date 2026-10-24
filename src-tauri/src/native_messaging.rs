//! Browser native messaging (2026-10-24): how the extension reaches the app without a pairing code,
//! the way 1Password's does. The browser starts this same binary as its native host
//! (`mimatory chrome-extension://<id>/` from Chrome, `mimatory <manifest> extension@mimatory.app` from
//! Firefox, or `mimatory --native-host …` by hand); the host speaks the browser's stdio framing and
//! relays every message to the running app over `native_ipc` (a 0600 Unix socket / per-user pipe),
//! where the app checks who is on the other end before answering. See AGENTS.md "Extension connection".
//!
//! Everything here except `run_host` and the registration writers is pure, so the framing, the caller
//! check and the manifests are unit-tested without a browser.

use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

/// The host name the extension passes to `connectNative` (Chrome: lowercase, dots and underscores only).
pub const HOST_NAME: &str = "app.mimatory.native";
/// The extension's fixed Chrome ID, derived from the public `key` in browser-extension/manifest.json
/// (SHA-256 of the DER key, first 16 bytes, hex digits 0–f written as a–p). The private key is kept
/// outside the repository (AGENTS.md); a new key means a new ID and every user re-adding the extension.
pub const CHROME_EXTENSION_ID: &str = "pjcffbogeilnkbmnlegjdciggbfbekfb";
/// `browser_specific_settings.gecko.id` in the extension manifest.
pub const GECKO_EXTENSION_ID: &str = "extension@mimatory.app";
/// Starts host mode by hand (tests, debugging); the caller origin must still follow it.
pub const NATIVE_HOST_ARG: &str = "--native-host";
/// Chrome refuses a host → browser message over 1 MB.
pub const MAX_MESSAGE_TO_BROWSER: usize = 1024 * 1024;
/// Browser → host messages may be up to 64 MB in Chrome; nothing the extension sends comes near it.
pub const MAX_MESSAGE_FROM_BROWSER: usize = 8 * 1024 * 1024;

pub fn chrome_origin() -> String {
    format!("chrome-extension://{CHROME_EXTENSION_ID}/")
}

/// Which browser family started the host, as its arguments say.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Caller {
    Chromium,
    Firefox,
}

/// Whether this process was started as the native host rather than as the app. Only our own
/// extension's identifiers count (a browser starts a host only for the origins its manifest allows),
/// plus the explicit flag — anything else starts the app as before.
pub fn is_native_host_invocation(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| {
        arg == NATIVE_HOST_ARG || arg.starts_with("chrome-extension://") || arg == GECKO_EXTENSION_ID
    })
}

/// The caller check the host makes before relaying anything: Chrome passes the calling extension's
/// origin (`chrome-extension://<id>/`, plus `--parent-window=…` on Windows), Firefox the manifest path
/// and the extension id. Any other extension origin is refused. This only filters honest mistakes —
/// arguments can be forged by whoever starts the binary, which is why the app verifies the peer
/// process (and on macOS the browser's code signature) itself.
pub fn validate_caller(args: &[String]) -> Result<Caller, String> {
    let allowed = chrome_origin();
    let mut foreign = None;
    for arg in args.iter().skip(1) {
        if *arg == allowed {
            return Ok(Caller::Chromium);
        }
        if arg == GECKO_EXTENSION_ID {
            return Ok(Caller::Firefox);
        }
        if arg.starts_with("chrome-extension://") {
            foreign = Some(arg.clone());
        }
    }
    Err(match foreign {
        Some(origin) => format!("extension origin not allowed: {origin}"),
        None => "no extension origin in the arguments".to_string(),
    })
}

/// Reads one message: a 4-byte length in native byte order, then that many bytes. `Ok(None)` is a
/// clean end of stream before a new message (the browser closed the port).
pub fn read_frame<R: Read>(reader: &mut R, max: usize) -> io::Result<Option<Vec<u8>>> {
    let mut length = [0_u8; 4];
    let mut filled = 0;
    while filled < 4 {
        match reader.read(&mut length[filled..]) {
            Ok(0) if filled == 0 => return Ok(None),
            Ok(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
            Ok(read) => filled += read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    let length = u32::from_ne_bytes(length) as usize;
    if length > max {
        return Err(io::Error::new(io::ErrorKind::InvalidData, format!("message of {length} bytes")));
    }
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

pub fn write_frame<W: Write>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    let length = u32::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "message too large"))?;
    writer.write_all(&length.to_ne_bytes())?;
    writer.write_all(payload)?;
    writer.flush()
}

/// A reply the host makes up itself (the app is not running, the answer is too large for Chrome),
/// in the same `{ id, status, data }` shape the app answers with.
pub fn host_reply(id: &Value, status: u16, error: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({ "id": id, "status": status, "data": { "error": error } }))
        .unwrap_or_default()
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum BrowserFamily {
    Chromium,
    Firefox,
}

/// The host manifest a browser reads to find and trust this binary.
pub fn host_manifest(family: BrowserFamily, executable: &str) -> Value {
    let mut manifest = json!({
        "name": HOST_NAME,
        "description": "Mimatory",
        "path": executable,
        "type": "stdio",
    });
    match family {
        BrowserFamily::Chromium => manifest["allowed_origins"] = json!([chrome_origin()]),
        BrowserFamily::Firefox => manifest["allowed_extensions"] = json!([GECKO_EXTENSION_ID]),
    }
    manifest
}

/// One browser's per-user host-manifest folder. `profile_root` is the browser's own data folder:
/// the manifest is written only when that already exists (the browser is installed and has run),
/// so registering never creates a browser profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestTarget {
    pub browser: &'static str,
    pub family: BrowserFamily,
    pub profile_root: PathBuf,
}

impl ManifestTarget {
    pub fn manifest_path(&self) -> PathBuf {
        let folder = match self.family {
            // Firefox on Linux reads ~/.mozilla/native-messaging-hosts; everywhere else the folder is
            // NativeMessagingHosts.
            BrowserFamily::Firefox if self.profile_root.ends_with(".mozilla") => "native-messaging-hosts",
            _ => "NativeMessagingHosts",
        };
        self.profile_root.join(folder).join(format!("{HOST_NAME}.json"))
    }
}

/// The per-user manifest folders on macOS ("macos") and Linux ("linux"), from the Chrome and MDN
/// native-messaging docs; Arc and Vivaldi as their users' setup guides give them.
pub fn manifest_targets(os: &str, home: &Path) -> Vec<ManifestTarget> {
    use BrowserFamily::{Chromium, Firefox};
    let entry = |browser, family, root: PathBuf| ManifestTarget { browser, family, profile_root: root };
    match os {
        "macos" => {
            let support = home.join("Library/Application Support");
            vec![
                entry("Google Chrome", Chromium, support.join("Google/Chrome")),
                entry("Google Chrome Beta", Chromium, support.join("Google/Chrome Beta")),
                entry("Google Chrome Canary", Chromium, support.join("Google/Chrome Canary")),
                entry("Chromium", Chromium, support.join("Chromium")),
                entry("Microsoft Edge", Chromium, support.join("Microsoft Edge")),
                entry("Brave", Chromium, support.join("BraveSoftware/Brave-Browser")),
                entry("Arc", Chromium, support.join("Arc/User Data")),
                entry("Vivaldi", Chromium, support.join("Vivaldi")),
                entry("Opera", Chromium, support.join("com.operasoftware.Opera")),
                entry("Firefox", Firefox, support.join("Mozilla")),
            ]
        }
        "linux" => {
            let config = home.join(".config");
            vec![
                entry("Google Chrome", Chromium, config.join("google-chrome")),
                entry("Chromium", Chromium, config.join("chromium")),
                entry("Microsoft Edge", Chromium, config.join("microsoft-edge")),
                entry("Brave", Chromium, config.join("BraveSoftware/Brave-Browser")),
                entry("Vivaldi", Chromium, config.join("vivaldi")),
                entry("Firefox", Firefox, home.join(".mozilla")),
            ]
        }
        _ => Vec::new(),
    }
}

/// Windows: the per-user registry keys (default value = manifest path) and which manifest each
/// points at. Brave, Vivaldi and Opera also read Chrome's key; Brave's own is written too.
#[cfg_attr(not(windows), allow(dead_code))]
pub const WINDOWS_REGISTRY_TARGETS: &[(&str, &str, BrowserFamily)] = &[
    ("Google Chrome", r"Software\Google\Chrome", BrowserFamily::Chromium),
    ("Microsoft Edge", r"Software\Microsoft\Edge", BrowserFamily::Chromium),
    ("Brave", r"Software\BraveSoftware\Brave-Browser", BrowserFamily::Chromium),
    ("Chromium", r"Software\Chromium", BrowserFamily::Chromium),
    ("Firefox", r"Software\Mozilla", BrowserFamily::Firefox),
];

/// The path the manifests name. An AppImage runs from a fresh mount every launch, so it is the
/// `.AppImage` file itself (`$APPIMAGE`) that the browser must start, not the mounted binary.
pub fn host_executable() -> io::Result<PathBuf> {
    if cfg!(target_os = "linux") {
        if let Some(appimage) = std::env::var_os("APPIMAGE").filter(|value| !value.is_empty()) {
            return Ok(PathBuf::from(appimage));
        }
    }
    let exe = std::env::current_exe()?;
    Ok(std::fs::canonicalize(&exe).unwrap_or(exe))
}

/// Writes `contents` unless the file already holds exactly that. Returns whether it wrote.
fn write_if_changed(path: &Path, contents: &str) -> io::Result<bool> {
    if std::fs::read_to_string(path).ok().as_deref() == Some(contents) {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, contents)?;
    Ok(true)
}

fn manifest_text(family: BrowserFamily, executable: &Path) -> String {
    let mut text = serde_json::to_string_pretty(&host_manifest(family, &executable.to_string_lossy()))
        .unwrap_or_default();
    text.push('\n');
    text
}

/// Registers the host with every installed browser (app startup, desktop only). Idempotent: a file
/// or registry value is rewritten only when it differs, e.g. after the app moved. Returns the
/// browsers it is registered with.
pub fn register_hosts() -> Vec<String> {
    let executable = match host_executable() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("Mimatory: native messaging not registered: {error}");
            return Vec::new();
        }
    };
    register_hosts_for(&executable)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn register_hosts_for(executable: &Path) -> Vec<String> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let os = if cfg!(target_os = "macos") { "macos" } else { "linux" };
    let mut registered = Vec::new();
    for target in manifest_targets(os, &home) {
        if !target.profile_root.is_dir() {
            continue;
        }
        match write_if_changed(&target.manifest_path(), &manifest_text(target.family, executable)) {
            Ok(_) => registered.push(target.browser.to_string()),
            Err(error) => eprintln!("Mimatory: native host for {} not written: {error}", target.browser),
        }
    }
    registered
}

#[cfg(windows)]
fn register_hosts_for(executable: &Path) -> Vec<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let Some(folder) = dirs::data_dir().map(|dir| dir.join("Mimatory").join("NativeMessagingHosts")) else {
        return Vec::new();
    };
    let manifests = [
        (BrowserFamily::Chromium, folder.join(format!("{HOST_NAME}.chromium.json"))),
        (BrowserFamily::Firefox, folder.join(format!("{HOST_NAME}.firefox.json"))),
    ];
    for (family, path) in &manifests {
        if let Err(error) = write_if_changed(path, &manifest_text(*family, executable)) {
            eprintln!("Mimatory: native host manifest not written: {error}");
            return Vec::new();
        }
    }
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut registered = Vec::new();
    for (browser, vendor_key, family) in WINDOWS_REGISTRY_TARGETS {
        let manifest = &manifests.iter().find(|(kind, _)| kind == family).expect("manifest").1;
        let manifest = manifest.to_string_lossy().to_string();
        let key_path = format!(r"{vendor_key}\NativeMessagingHosts\{HOST_NAME}");
        let result = hkcu.create_subkey(&key_path).and_then(|(key, _)| {
            let current: io::Result<String> = key.get_value("");
            if current.ok().as_deref() != Some(manifest.as_str()) {
                key.set_value("", &manifest)?;
            }
            Ok(())
        });
        match result {
            Ok(()) => registered.push(browser.to_string()),
            Err(error) => eprintln!("Mimatory: native host for {browser} not registered: {error}"),
        }
    }
    registered
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn register_hosts_for(_executable: &Path) -> Vec<String> {
    Vec::new()
}

/// Host mode: relay framed messages between the browser (stdin/stdout) and the running app. Returns
/// the process exit code. The app is never started from here: when it is not running every request
/// is answered `503 app_not_running` and the popup says so (starting a GUI app from a browser's
/// background request would be a surprise, and on macOS would need LaunchServices).
pub fn run_host(args: &[String]) -> i32 {
    if let Err(error) = validate_caller(args) {
        eprintln!("Mimatory native host: {error}");
        return 1;
    }
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();
    let mut app: Option<crate::native_ipc::Stream> = None;
    loop {
        let message = match read_frame(&mut input, MAX_MESSAGE_FROM_BROWSER) {
            Ok(Some(message)) => message,
            Ok(None) => return 0,
            Err(error) => {
                eprintln!("Mimatory native host: {error}");
                return 1;
            }
        };
        let id = serde_json::from_slice::<Value>(&message)
            .ok()
            .and_then(|value| value.get("id").cloned())
            .unwrap_or(Value::Null);
        let reply = relay(&mut app, &message).unwrap_or_else(|| host_reply(&id, 503, "app_not_running"));
        let reply = if reply.len() > MAX_MESSAGE_TO_BROWSER {
            host_reply(&id, 413, "response_too_large")
        } else {
            reply
        };
        if write_frame(&mut output, &reply).is_err() {
            return 0;
        }
    }
}

/// Sends one message to the app and returns its answer, (re)connecting once when the app restarted.
fn relay(app: &mut Option<crate::native_ipc::Stream>, message: &[u8]) -> Option<Vec<u8>> {
    for _ in 0..2 {
        if app.is_none() {
            *app = crate::native_ipc::connect().ok();
        }
        let stream = app.as_mut()?;
        let answer = write_frame(stream, message)
            .and_then(|()| read_frame(stream, crate::native_ipc::MAX_REPLY))
            .ok()
            .flatten();
        match answer {
            Some(reply) => return Some(reply),
            None => *app = None,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn frames_round_trip_in_native_byte_order() {
        let mut buffer = Vec::new();
        write_frame(&mut buffer, br#"{"id":1}"#).unwrap();
        assert_eq!(&buffer[..4], &8_u32.to_ne_bytes());
        write_frame(&mut buffer, b"").unwrap();
        let mut reader = buffer.as_slice();
        assert_eq!(read_frame(&mut reader, 64).unwrap().unwrap(), br#"{"id":1}"#);
        assert_eq!(read_frame(&mut reader, 64).unwrap().unwrap(), b"");
        assert!(read_frame(&mut reader, 64).unwrap().is_none());
    }

    #[test]
    fn an_oversized_or_cut_frame_is_an_error() {
        let mut buffer = Vec::new();
        write_frame(&mut buffer, &[b'x'; 100]).unwrap();
        assert!(read_frame(&mut buffer.as_slice(), 99).is_err());
        assert!(read_frame(&mut &buffer[..50], 1000).is_err());
        assert!(read_frame(&mut &buffer[..2], 1000).is_err());
    }

    #[test]
    fn only_our_extension_may_call_the_host() {
        let origin = chrome_origin();
        assert_eq!(validate_caller(&args(&["mimatory", &origin])), Ok(Caller::Chromium));
        // Chrome on Windows adds the parent window handle.
        assert_eq!(
            validate_caller(&args(&["mimatory", &origin, "--parent-window=0"])),
            Ok(Caller::Chromium)
        );
        assert_eq!(
            validate_caller(&args(&["mimatory", "/x/app.mimatory.native.json", GECKO_EXTENSION_ID])),
            Ok(Caller::Firefox)
        );
        assert!(validate_caller(&args(&["mimatory", "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"])).is_err());
        assert!(validate_caller(&args(&["mimatory", NATIVE_HOST_ARG])).is_err());
        assert!(validate_caller(&args(&["mimatory"])).is_err());
    }

    #[test]
    fn host_mode_is_detected_only_for_our_callers() {
        assert!(is_native_host_invocation(&args(&["mimatory", &chrome_origin()])));
        assert!(is_native_host_invocation(&args(&["mimatory", "/m.json", GECKO_EXTENSION_ID])));
        assert!(is_native_host_invocation(&args(&["mimatory", NATIVE_HOST_ARG])));
        assert!(!is_native_host_invocation(&args(&["mimatory"])));
        assert!(!is_native_host_invocation(&args(&["mimatory", "--quick-access"])));
    }

    #[test]
    fn the_extension_id_is_32_letters_a_to_p() {
        assert_eq!(CHROME_EXTENSION_ID.len(), 32);
        assert!(CHROME_EXTENSION_ID.bytes().all(|byte| (b'a'..=b'p').contains(&byte)));
        assert!(HOST_NAME.bytes().all(|byte| byte.is_ascii_lowercase() || byte == b'.' || byte == b'_'));
    }

    #[test]
    fn manifests_name_the_binary_and_only_our_extension() {
        let chrome = host_manifest(BrowserFamily::Chromium, "/Applications/Mimatory.app/Contents/MacOS/mimatory");
        assert_eq!(chrome["name"], HOST_NAME);
        assert_eq!(chrome["type"], "stdio");
        assert_eq!(chrome["path"], "/Applications/Mimatory.app/Contents/MacOS/mimatory");
        assert_eq!(chrome["allowed_origins"], json!([format!("chrome-extension://{CHROME_EXTENSION_ID}/")]));
        assert!(chrome.get("allowed_extensions").is_none());
        let firefox = host_manifest(BrowserFamily::Firefox, "/usr/bin/mimatory");
        assert_eq!(firefox["allowed_extensions"], json!([GECKO_EXTENSION_ID]));
        assert!(firefox.get("allowed_origins").is_none());
    }

    #[test]
    fn manifest_folders_follow_each_browser() {
        let home = Path::new("/home/rei");
        let linux = manifest_targets("linux", home);
        let path = |targets: &[ManifestTarget], browser: &str| {
            targets.iter().find(|target| target.browser == browser).unwrap().manifest_path()
        };
        assert_eq!(
            path(&linux, "Chromium"),
            Path::new("/home/rei/.config/chromium/NativeMessagingHosts/app.mimatory.native.json")
        );
        assert_eq!(
            path(&linux, "Firefox"),
            Path::new("/home/rei/.mozilla/native-messaging-hosts/app.mimatory.native.json")
        );
        let mac = manifest_targets("macos", Path::new("/Users/rei"));
        assert_eq!(
            path(&mac, "Arc"),
            Path::new("/Users/rei/Library/Application Support/Arc/User Data/NativeMessagingHosts/app.mimatory.native.json")
        );
        assert_eq!(
            path(&mac, "Firefox"),
            Path::new("/Users/rei/Library/Application Support/Mozilla/NativeMessagingHosts/app.mimatory.native.json")
        );
        assert!(manifest_targets("ios", home).is_empty());
    }

    #[test]
    fn a_manifest_is_rewritten_only_when_it_differs() {
        let dir = std::env::temp_dir().join(format!("mimatory-nm-{}", std::process::id()));
        let path = dir.join("NativeMessagingHosts").join("host.json");
        assert!(write_if_changed(&path, "a").unwrap());
        assert!(!write_if_changed(&path, "a").unwrap());
        assert!(write_if_changed(&path, "b").unwrap());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_host_reply_keeps_the_request_id() {
        let reply: Value = serde_json::from_slice(&host_reply(&json!(7), 503, "app_not_running")).unwrap();
        assert_eq!(reply, json!({ "id": 7, "status": 503, "data": { "error": "app_not_running" } }));
    }
}
