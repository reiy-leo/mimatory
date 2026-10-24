//! The desktop shell (macOS, Windows, Linux): tray, Quick Access, autostart, single instance. The module is
//! compiled only for desktop targets (`#[cfg(desktop)] mod shell` in lib.rs); iOS and Android have none of it.

use std::error::Error;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::WebviewWindowBuilder;
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{App, AppHandle, Builder, Emitter, Manager, WebviewUrl, Wry};
use tauri_plugin_autostart::ManagerExt;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_positioner::{on_tray_event, Position, WindowExt};

use crate::native_i18n::{tr, Text};

pub const QUICK_ACCESS_LABEL: &str = "quick-access";
const TRAY_ID: &str = "mimatory-tray";
/// ⌘⇧Space on macOS, Ctrl+Shift+Space on Windows (Win+Shift+Space is the system's input-language switch).
#[cfg(any(target_os = "macos", target_os = "windows"))]
const QUICK_ACCESS_SHORTCUT: &str = "CommandOrControl+Shift+Space";
/// The command-line switch a compositor keybinding launches (Hyprland: `bind = SUPER SHIFT, SPACE, exec,
/// mimatory --quick-access`). The single-instance plugin hands it to the running app, which toggles the panel.
pub const QUICK_ACCESS_ARG: &str = "--quick-access";
const QUICK_ACCESS_WIDTH: f64 = 560.0;
const QUICK_ACCESS_HEIGHT: f64 = 384.0;

/// Desktop-only plugins, registered before anything else so a second launch is caught by the first.
pub fn plugins(builder: Builder<Wry>) -> Builder<Wry> {
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.iter().any(|arg| arg == QUICK_ACCESS_ARG) {
                toggle_quick_access(app, Position::TopCenter);
            } else {
                focus_main_window(app);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_positioner::init());
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    builder
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn Error>> {
    build_tray(app.handle())?;
    #[cfg(target_os = "macos")]
    {
        build_app_menu(app.handle())?;
        // Registered once, not per build: the menu is rebuilt on every language change and each
        // `on_menu_event` call adds a listener.
        app.on_menu_event(|app, event| {
            if event.id().as_ref() == IMPORT_1PUX_MENU_ID {
                focus_main_window(app);
                let _ = app.emit_to("main", IMPORT_1PUX_EVENT, ());
            }
        });
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    register_shortcuts(app.handle())?;
    // First launch straight from the keybinding: open the panel as well as the app.
    if std::env::args().any(|arg| arg == QUICK_ACCESS_ARG) {
        toggle_quick_access(app.handle(), Position::TopCenter);
    }
    Ok(())
}

/// The event the main window listens for to start File ▸ Import ▸ 1Password.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const IMPORT_1PUX_EVENT: &str = "menu:import-1pux";
const IMPORT_1PUX_MENU_ID: &str = "import-1pux";

/// Rebuilds every Rust-built label in the current native language (`native_i18n`): the tray menu and
/// tooltip, and the macOS menu bar. Called by `set_native_locale` when the in-app language changes. Menu
/// item ids stay the same, so the global menu listeners keep working on the new menus.
pub fn refresh_native_labels(app: &AppHandle<Wry>) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        match tray_menu(app) {
            Ok(menu) => {
                let _ = tray.set_menu(Some(menu));
            }
            Err(error) => eprintln!("could not rebuild the tray menu: {error}"),
        }
        let _ = tray.set_tooltip(Some(tr(Text::AppName)));
    }
    #[cfg(target_os = "macos")]
    if let Err(error) = build_app_menu(app) {
        eprintln!("could not rebuild the menu bar: {error}");
    }
}

/// The macOS menu bar: Tauri's default menu (app, File, Edit, View, Window) plus File ▸ Import ▸ 1Password,
/// every item labelled in the native language (the predefined items take custom text; their actions —
/// AppKit selectors — are unchanged). Windows and Linux keep no menu bar — the WinUI/Material skins have
/// none — so it is built for macOS only.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn build_app_menu(app: &AppHandle<Wry>) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

    let import = SubmenuBuilder::new(app, tr(Text::Import))
        .text(IMPORT_1PUX_MENU_ID, tr(Text::Import1Pux))
        .build()?;
    // The About panel takes the localized name; version and icon still come from the bundle.
    let about = AboutMetadata {
        name: Some(tr(Text::AppName).to_string()),
        ..AboutMetadata::default()
    };
    let app_menu = SubmenuBuilder::new(app, tr(Text::AppName))
        .about_with_text(tr(Text::About), Some(about))
        .separator()
        .services_with_text(tr(Text::Services))
        .separator()
        .hide_with_text(tr(Text::Hide))
        .hide_others_with_text(tr(Text::HideOthers))
        .show_all_with_text(tr(Text::ShowAll))
        .separator()
        .quit_with_text(tr(Text::Quit))
        .build()?;
    let file = SubmenuBuilder::new(app, tr(Text::File))
        .item(&import)
        .separator()
        .close_window_with_text(tr(Text::CloseWindow))
        .build()?;
    // Without an Edit menu the webview loses ⌘C / ⌘V / ⌘A on macOS.
    let edit = SubmenuBuilder::new(app, tr(Text::Edit))
        .undo_with_text(tr(Text::Undo))
        .redo_with_text(tr(Text::Redo))
        .separator()
        .cut_with_text(tr(Text::Cut))
        .copy_with_text(tr(Text::Copy))
        .paste_with_text(tr(Text::Paste))
        .select_all_with_text(tr(Text::SelectAll))
        .build()?;
    let view = SubmenuBuilder::new(app, tr(Text::View))
        .fullscreen_with_text(tr(Text::EnterFullScreen))
        .build()?;
    let window = SubmenuBuilder::new(app, tr(Text::Window))
        .minimize_with_text(tr(Text::Minimize))
        .maximize_with_text(tr(Text::Zoom))
        .separator()
        .close_window_with_text(tr(Text::CloseWindow))
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

fn tray_menu(app: &AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
    let quick_access =
        MenuItem::with_id(app, "quick-access", tr(Text::TrayOpenQuickAccess), true, None::<&str>)?;
    let show_main = MenuItem::with_id(app, "main", tr(Text::TrayShowMain), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", tr(Text::Quit), true, None::<&str>)?;
    Menu::with_items(app, &[
        &quick_access,
        &show_main,
        &PredefinedMenuItem::separator(app)?,
        &quit,
    ])
}

fn build_tray(app: &AppHandle<Wry>) -> Result<(), Box<dyn Error>> {
    let menu = tray_menu(app)?;

    // A template image, not the app icon: the bar tints it for light and dark chrome, and a
    // 18pt colour tile is unreadable there. Drawn to the shipped icon's proportions.
    let icon = tauri::include_image!("icons/tray-icon-template.png");

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(tr(Text::AppName))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quick-access" => toggle_quick_access(app, Position::TrayBottomCenter),
            "main" => focus_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // The Tray* positions only resolve once the icon has reported its rect.
            on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_quick_access(tray.app_handle(), Position::TrayBottomCenter);
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn register_shortcuts(app: &AppHandle<Wry>) -> Result<(), Box<dyn Error>> {
    app.global_shortcut().on_shortcut(QUICK_ACCESS_SHORTCUT, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            // Opened from a keystroke, so nothing knows where the tray icon is:
            // anchor the overlay to the top of the screen instead.
            toggle_quick_access(app, Position::TopCenter);
        }
    })?;
    Ok(())
}

/// Hotkey callbacks arrive off the event loop and creating a webview from another
/// thread is not allowed on macOS, so every window change is deferred.
fn toggle_quick_access(app: &AppHandle<Wry>, position: Position) {
    let handle = app.clone();
    let result = app.run_on_main_thread(move || {
        if hide_quick_access_if_visible(&handle) {
            return;
        }
        if let Err(error) = show_quick_access(&handle, position) {
            eprintln!("could not open Quick Access: {error}");
        }
    });

    if let Err(error) = result {
        eprintln!("could not schedule Quick Access on the main thread: {error}");
    }
}

fn hide_quick_access_if_visible(app: &AppHandle<Wry>) -> bool {
    let Some(window) = app.get_webview_window(QUICK_ACCESS_LABEL) else {
        return false;
    };
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    let _ = window.hide();
    true
}

fn show_quick_access(app: &AppHandle<Wry>, position: Position) -> tauri::Result<()> {
    let window = match app.get_webview_window(QUICK_ACCESS_LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(
            app,
            QUICK_ACCESS_LABEL,
            WebviewUrl::App("/?view=quick-access".into()),
        )
        .always_on_top(true)
        .decorations(false)
        .inner_size(QUICK_ACCESS_WIDTH, QUICK_ACCESS_HEIGHT)
        .resizable(false)
        .shadow(true)
        .skip_taskbar(true)
        .title("Mimatory Quick Access")
        // Borderless + rounded CSS corners only read as one panel if the window
        // itself stops painting an opaque rectangle behind the page.
        .transparent(true)
        .effects(quick_access_effects())
        .visible(false)
        .build()?,
    };

    if window.move_window(position).is_err() {
        window.move_window(Position::TopCenter)?;
    }
    window.show()?;
    window.set_focus()?;
    window.emit("quick-access:opened", ())
}

/// macOS: the native popover material (NSVisualEffectView), its radius matching the shell's
/// `rounded-xlarge` so the blur stops at the CSS corners. Windows 11: Acrylic, the WinUI flyout material.
/// Linux: nothing — Hyprland blurs behind a transparent surface itself when the user's rules ask it to.
fn quick_access_effects() -> tauri::utils::config::WindowEffectsConfig {
    let effect = if cfg!(target_os = "windows") {
        Effect::Acrylic
    } else {
        Effect::Popover
    };
    let builder = EffectsBuilder::new().effect(effect).state(EffectState::Active);
    if cfg!(target_os = "macos") {
        builder.radius(12.0).build()
    } else {
        builder.build()
    }
}

pub fn hide_quick_access(app: &AppHandle<Wry>) {
    if let Some(window) = app.get_webview_window(QUICK_ACCESS_LABEL) {
        let _ = window.hide();
    }
}

pub fn focus_main_window(app: &AppHandle<Wry>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn set_autostart(app: &AppHandle<Wry>, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|error| error.to_string())
    } else {
        autolaunch.disable().map_err(|error| error.to_string())
    }
}

pub fn autostart_enabled(app: &AppHandle<Wry>) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|error| error.to_string())
}
