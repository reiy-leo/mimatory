//! Strings the Rust side shows the user itself — the tray menu and tooltip, the macOS menu bar, the native
//! file picker's title, the Touch ID prompt — in the UI's language. The app's name is 密码库存 in zh and
//! Mimatory in en/ja (owner, 2026-10-24; see AGENTS.md "Chinese name").
//!
//! The language is the in-app one: every window reports it through `set_native_locale` at startup and on
//! every change, and the shell then rebuilds its menus. Until the first report the OS locale stands in.

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locale {
    En,
    Zh,
    Ja,
}

impl Locale {
    /// `zh*` → zh, `ja*` → ja, anything else (or nothing) → en. Accepts BCP 47 (`zh-Hans-CN`), POSIX
    /// (`ja_JP.UTF-8`) and the frontend's bare codes alike.
    pub fn from_tag(tag: &str) -> Locale {
        let primary = tag
            .trim()
            .split(|c: char| c == '-' || c == '_' || c == '.' || c == '@')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        match primary.as_str() {
            "zh" => Locale::Zh,
            "ja" => Locale::Ja,
            _ => Locale::En,
        }
    }

    fn to_u8(self) -> u8 {
        match self {
            Locale::En => 1,
            Locale::Zh => 2,
            Locale::Ja => 3,
        }
    }

    fn from_u8(value: u8) -> Option<Locale> {
        match value {
            1 => Some(Locale::En),
            2 => Some(Locale::Zh),
            3 => Some(Locale::Ja),
            _ => None,
        }
    }
}

/// 0 = nothing reported yet (fall back to the OS locale).
static CURRENT: AtomicU8 = AtomicU8::new(0);

/// The language the native UI speaks now.
pub fn current() -> Locale {
    Locale::from_u8(CURRENT.load(Ordering::Relaxed)).unwrap_or_else(system_locale)
}

/// Records the in-app language. True when it differs from what the native UI showed until now, i.e. the
/// menus need rebuilding.
pub fn set_current(locale: Locale) -> bool {
    let before = current();
    CURRENT.store(locale.to_u8(), Ordering::Relaxed);
    before != locale
}

fn system_locale() -> Locale {
    sys_locale::get_locale().map(|tag| Locale::from_tag(&tag)).unwrap_or(Locale::En)
}

/// Every string the Rust side shows. One row per string, the three locales side by side.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Text {
    AppName,
    // Tray
    TrayOpenQuickAccess,
    TrayShowMain,
    // macOS app menu (Quit is the tray's Quit too)
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
    // File
    File,
    Import,
    Import1Pux,
    CloseWindow,
    // Edit
    Edit,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    // View / Window
    View,
    EnterFullScreen,
    Window,
    Minimize,
    Zoom,
    // Native dialogs and prompts
    Import1PuxDialogTitle,
    Import1PuxFilter,
    BiometricReason,
}

impl Text {
    #[cfg(test)]
    const ALL: [Text; 28] = [
        Text::AppName,
        Text::TrayOpenQuickAccess,
        Text::TrayShowMain,
        Text::About,
        Text::Services,
        Text::Hide,
        Text::HideOthers,
        Text::ShowAll,
        Text::Quit,
        Text::File,
        Text::Import,
        Text::Import1Pux,
        Text::CloseWindow,
        Text::Edit,
        Text::Undo,
        Text::Redo,
        Text::Cut,
        Text::Copy,
        Text::Paste,
        Text::SelectAll,
        Text::View,
        Text::EnterFullScreen,
        Text::Window,
        Text::Minimize,
        Text::Zoom,
        Text::Import1PuxDialogTitle,
        Text::Import1PuxFilter,
        Text::BiometricReason,
    ];
}

/// `(en, zh, ja)`. Wording follows the macOS system menus in each language; the Quick Access strings match
/// the frontend bundles (`tray.quickAccess` in i18n.ts).
fn row(text: Text) -> (&'static str, &'static str, &'static str) {
    match text {
        Text::AppName => ("Mimatory", "密码库存", "Mimatory"),
        Text::TrayOpenQuickAccess => ("Open Quick Access", "打开快速访问", "クイックアクセスを開く"),
        Text::TrayShowMain => ("Show Mimatory", "显示密码库存", "Mimatoryを表示"),
        Text::About => ("About Mimatory", "关于密码库存", "Mimatoryについて"),
        Text::Services => ("Services", "服务", "サービス"),
        Text::Hide => ("Hide Mimatory", "隐藏密码库存", "Mimatoryを非表示"),
        Text::HideOthers => ("Hide Others", "隐藏其他", "ほかを非表示"),
        Text::ShowAll => ("Show All", "全部显示", "すべてを表示"),
        Text::Quit => ("Quit Mimatory", "退出密码库存", "Mimatoryを終了"),
        Text::File => ("File", "文件", "ファイル"),
        Text::Import => ("Import", "导入", "読み込む"),
        Text::Import1Pux => ("1Password (.1pux)…", "1Password (.1pux)…", "1Password (.1pux)…"),
        Text::CloseWindow => ("Close Window", "关闭窗口", "ウインドウを閉じる"),
        Text::Edit => ("Edit", "编辑", "編集"),
        Text::Undo => ("Undo", "撤销", "取り消す"),
        Text::Redo => ("Redo", "重做", "やり直す"),
        Text::Cut => ("Cut", "剪切", "カット"),
        Text::Copy => ("Copy", "拷贝", "コピー"),
        Text::Paste => ("Paste", "粘贴", "ペースト"),
        Text::SelectAll => ("Select All", "全选", "すべてを選択"),
        Text::View => ("View", "显示", "表示"),
        Text::EnterFullScreen => ("Enter Full Screen", "进入全屏幕", "フルスクリーンにする"),
        Text::Window => ("Window", "窗口", "ウインドウ"),
        Text::Minimize => ("Minimize", "最小化", "しまう"),
        Text::Zoom => ("Zoom", "缩放", "拡大/縮小"),
        Text::Import1PuxDialogTitle => ("Import from 1Password", "从 1Password 导入", "1Passwordから読み込む"),
        Text::Import1PuxFilter => ("1Password export", "1Password 导出文件", "1Passwordの書き出しファイル"),
        // macOS prefixes it: “Mimatory” is trying to <reason>.
        Text::BiometricReason => (
            "unlock your Mimatory vault",
            "解锁你的密码库存",
            "Mimatoryの保管庫のロックを解除",
        ),
    }
}

/// `text` in `locale`.
pub fn tr_in(locale: Locale, text: Text) -> &'static str {
    let (en, zh, ja) = row(text);
    match locale {
        Locale::En => en,
        Locale::Zh => zh,
        Locale::Ja => ja,
    }
}

/// `text` in the current native language.
pub fn tr(text: Text) -> &'static str {
    tr_in(current(), text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_language_tags() {
        assert_eq!(Locale::from_tag("zh"), Locale::Zh);
        assert_eq!(Locale::from_tag("zh-Hans-CN"), Locale::Zh);
        assert_eq!(Locale::from_tag("zh_TW.UTF-8"), Locale::Zh);
        assert_eq!(Locale::from_tag("ZH-hant"), Locale::Zh);
        assert_eq!(Locale::from_tag("ja"), Locale::Ja);
        assert_eq!(Locale::from_tag("ja_JP.UTF-8"), Locale::Ja);
        assert_eq!(Locale::from_tag("en-US"), Locale::En);
        assert_eq!(Locale::from_tag("fr-FR"), Locale::En);
        assert_eq!(Locale::from_tag("C"), Locale::En);
        assert_eq!(Locale::from_tag(""), Locale::En);
        assert_eq!(Locale::from_tag("zhx"), Locale::En);
    }

    #[test]
    fn app_name_is_mimatory_except_in_chinese() {
        assert_eq!(tr_in(Locale::En, Text::AppName), "Mimatory");
        assert_eq!(tr_in(Locale::Ja, Text::AppName), "Mimatory");
        assert_eq!(tr_in(Locale::Zh, Text::AppName), "密码库存");
    }

    #[test]
    fn every_string_is_filled_and_chinese_never_says_mimatory() {
        for text in Text::ALL {
            for locale in [Locale::En, Locale::Zh, Locale::Ja] {
                assert!(!tr_in(locale, text).trim().is_empty(), "{text:?} empty in {locale:?}");
            }
            assert!(!tr_in(Locale::Zh, text).contains("Mimatory"), "{text:?} says Mimatory in zh");
            // The app's name in en/ja is always Mimatory, never 密码库存.
            assert!(!tr_in(Locale::En, text).contains("密码库存"));
            assert!(!tr_in(Locale::Ja, text).contains("密码库存"));
        }
    }

    #[test]
    fn reported_language_wins_over_the_system() {
        set_current(Locale::Ja);
        assert_eq!(current(), Locale::Ja);
        assert!(!set_current(Locale::Ja));
        assert!(set_current(Locale::Zh));
        assert_eq!(tr(Text::Quit), "退出密码库存");
        set_current(Locale::En);
        assert_eq!(tr(Text::TrayShowMain), "Show Mimatory");
    }
}
