use std::error::Error;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::WebviewWindowBuilder;
use tauri::{App, AppHandle, Emitter, Manager, WebviewUrl, Wry};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_positioner::{on_tray_event, Position, WindowExt};

pub const QUICK_ACCESS_LABEL: &str = "quick-access";
const TRAY_ID: &str = "passless-tray";
const QUICK_ACCESS_SHORTCUT: &str = "Command+Shift+Space";
const QUICK_ACCESS_WIDTH: f64 = 560.0;
const QUICK_ACCESS_HEIGHT: f64 = 384.0;

pub fn setup(app: &mut App) -> Result<(), Box<dyn Error>> {
    build_tray(app.handle())?;
    register_shortcuts(app.handle())?;
    Ok(())
}

fn build_tray(app: &AppHandle<Wry>) -> Result<(), Box<dyn Error>> {
    let quick_access = MenuItem::with_id(app, "quick-access", "Open Quick Access", true, None::<&str>)?;
    let show_main = MenuItem::with_id(app, "main", "Show Passless", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Passless", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[
        &quick_access,
        &show_main,
        &PredefinedMenuItem::separator(app)?,
        &quit,
    ])?;

    // A template image, not the app icon: the bar tints it for light and dark chrome, and a
    // 18pt colour tile is unreadable there. Drawn to the shipped icon's proportions.
    let icon = tauri::include_image!("icons/tray-icon-template.png");

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Passless")
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
        .title("Passless Quick Access")
        // Borderless + rounded CSS corners only read as one panel if the window
        // itself stops painting an opaque rectangle behind the page.
        .transparent(true)
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
