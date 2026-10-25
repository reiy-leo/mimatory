//! Strings the Rust side shows the user itself — the tray menu and tooltip, the macOS menu bar, the native
//! file picker's title, the Touch ID prompt — in the UI's language. The app's name is 密码库存 in zh and
//! Mimatory in every other language (owner, 2026-10-24; see AGENTS.md "Chinese name").
//!
//! The language is the in-app one: every window reports it through `set_native_locale` at startup and on
//! every change, and the shell then rebuilds its menus. Until the first report the OS locale stands in.

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locale {
    En,
    Zh,
    Ja,
    Es,
    Pt,
    Ru,
    De,
    Fr,
    Id,
}

impl Locale {
    /// Every locale, in the column order of `row`.
    pub const ALL: [Locale; 9] = [
        Locale::En,
        Locale::Zh,
        Locale::Ja,
        Locale::Es,
        Locale::Pt,
        Locale::Ru,
        Locale::De,
        Locale::Fr,
        Locale::Id,
    ];

    /// The primary subtag picks the language (`zh*` → zh, `pt-PT` → pt, the legacy `in` → id); anything else
    /// (or nothing) → en. Accepts BCP 47 (`zh-Hans-CN`), POSIX (`ja_JP.UTF-8`) and the frontend's bare codes.
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
            "es" => Locale::Es,
            "pt" => Locale::Pt,
            "ru" => Locale::Ru,
            "de" => Locale::De,
            "fr" => Locale::Fr,
            "id" | "in" => Locale::Id,
            _ => Locale::En,
        }
    }

    fn index(self) -> usize {
        Locale::ALL.iter().position(|locale| *locale == self).unwrap_or(0)
    }

    fn to_u8(self) -> u8 {
        self.index() as u8 + 1
    }

    fn from_u8(value: u8) -> Option<Locale> {
        value.checked_sub(1).and_then(|index| Locale::ALL.get(index as usize).copied())
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

/// The first of the OS's preferred languages the app speaks — the frontend's "System Language" rule
/// (`resolveSystemLanguage` in i18n.ts), so the menus agree with the windows before the first report.
fn system_locale() -> Locale {
    sys_locale::get_locales()
        .map(|tag| (Locale::from_tag(&tag), tag))
        .find(|(locale, tag)| *locale != Locale::En || tag.to_ascii_lowercase().starts_with("en"))
        .map(|(locale, _)| locale)
        .unwrap_or(Locale::En)
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

type Row = [&'static str; 9];

/// `[en, zh, ja, es, pt, ru, de, fr, id]` (the order of `Locale::ALL`). Wording follows the macOS system
/// menus in each language (de "Ablage", fr "Présentation", ru "Правка"…); the Quick Access strings match the
/// frontend bundles (`tray.quickAccess` in src/app/locales/).
fn row(text: Text) -> Row {
    match text {
        Text::AppName => ["Mimatory", "密码库存", "Mimatory", "Mimatory", "Mimatory", "Mimatory", "Mimatory",
            "Mimatory", "Mimatory"],
        Text::TrayOpenQuickAccess => ["Open Quick Access", "打开快速访问", "クイックアクセスを開く",
            "Abrir Acceso rápido", "Abrir Acesso Rápido", "Открыть быстрый доступ", "Schnellzugriff öffnen",
            "Ouvrir l’Accès rapide", "Buka Akses Cepat"],
        Text::TrayShowMain => ["Show Mimatory", "显示密码库存", "Mimatoryを表示", "Mostrar Mimatory",
            "Mostrar Mimatory", "Показать Mimatory", "Mimatory anzeigen", "Afficher Mimatory",
            "Tampilkan Mimatory"],
        Text::About => ["About Mimatory", "关于密码库存", "Mimatoryについて", "Acerca de Mimatory",
            "Sobre o Mimatory", "О программе Mimatory", "Über Mimatory", "À propos de Mimatory",
            "Tentang Mimatory"],
        Text::Services => ["Services", "服务", "サービス", "Servicios", "Serviços", "Службы", "Dienste",
            "Services", "Layanan"],
        Text::Hide => ["Hide Mimatory", "隐藏密码库存", "Mimatoryを非表示", "Ocultar Mimatory",
            "Ocultar Mimatory", "Скрыть Mimatory", "Mimatory ausblenden", "Masquer Mimatory",
            "Sembunyikan Mimatory"],
        Text::HideOthers => ["Hide Others", "隐藏其他", "ほかを非表示", "Ocultar otros", "Ocultar Outros",
            "Скрыть остальные", "Andere ausblenden", "Masquer les autres", "Sembunyikan Lainnya"],
        Text::ShowAll => ["Show All", "全部显示", "すべてを表示", "Mostrar todo", "Mostrar Tudo",
            "Показать все", "Alle einblenden", "Tout afficher", "Tampilkan Semua"],
        Text::Quit => ["Quit Mimatory", "退出密码库存", "Mimatoryを終了", "Salir de Mimatory",
            "Encerrar Mimatory", "Завершить Mimatory", "Mimatory beenden", "Quitter Mimatory",
            "Keluar dari Mimatory"],
        Text::File => ["File", "文件", "ファイル", "Archivo", "Arquivo", "Файл", "Ablage", "Fichier", "File"],
        Text::Import => ["Import", "导入", "読み込む", "Importar", "Importar", "Импорт", "Importieren",
            "Importer", "Impor"],
        Text::Import1Pux => ["1Password (.1pux)…"; 9],
        Text::CloseWindow => ["Close Window", "关闭窗口", "ウインドウを閉じる", "Cerrar ventana",
            "Fechar Janela", "Закрыть окно", "Fenster schließen", "Fermer la fenêtre", "Tutup Jendela"],
        Text::Edit => ["Edit", "编辑", "編集", "Edición", "Editar", "Правка", "Bearbeiten", "Édition",
            "Edit"],
        Text::Undo => ["Undo", "撤销", "取り消す", "Deshacer", "Desfazer", "Отменить", "Widerrufen",
            "Annuler", "Urungkan"],
        Text::Redo => ["Redo", "重做", "やり直す", "Rehacer", "Refazer", "Повторить", "Wiederholen",
            "Rétablir", "Ulangi"],
        Text::Cut => ["Cut", "剪切", "カット", "Cortar", "Recortar", "Вырезать", "Ausschneiden", "Couper",
            "Potong"],
        Text::Copy => ["Copy", "拷贝", "コピー", "Copiar", "Copiar", "Скопировать", "Kopieren", "Copier",
            "Salin"],
        Text::Paste => ["Paste", "粘贴", "ペースト", "Pegar", "Colar", "Вставить", "Einsetzen", "Coller",
            "Tempel"],
        Text::SelectAll => ["Select All", "全选", "すべてを選択", "Seleccionar todo", "Selecionar Tudo",
            "Выбрать все", "Alles auswählen", "Tout sélectionner", "Pilih Semua"],
        Text::View => ["View", "显示", "表示", "Visualización", "Visualizar", "Вид", "Darstellung",
            "Présentation", "Lihat"],
        Text::EnterFullScreen => ["Enter Full Screen", "进入全屏幕", "フルスクリーンにする",
            "Entrar en pantalla completa", "Entrar em Tela Cheia", "Включить полноэкранный режим",
            "Vollbildmodus aktivieren", "Passer en mode plein écran", "Masuk ke Layar Penuh"],
        Text::Window => ["Window", "窗口", "ウインドウ", "Ventana", "Janela", "Окно", "Fenster", "Fenêtre",
            "Jendela"],
        Text::Minimize => ["Minimize", "最小化", "しまう", "Minimizar", "Minimizar", "Свернуть",
            "Im Dock ablegen", "Placer dans le Dock", "Minimalkan"],
        Text::Zoom => ["Zoom", "缩放", "拡大/縮小", "Zoom", "Zoom", "Изменить масштаб", "Zoomen",
            "Réduire/agrandir", "Perbesar/Perkecil"],
        Text::Import1PuxDialogTitle => ["Import from 1Password", "从 1Password 导入", "1Passwordから読み込む",
            "Importar desde 1Password", "Importar do 1Password", "Импорт из 1Password",
            "Aus 1Password importieren", "Importer depuis 1Password", "Impor dari 1Password"],
        Text::Import1PuxFilter => ["1Password export", "1Password 导出文件", "1Passwordの書き出しファイル",
            "Exportación de 1Password", "Exportação do 1Password", "Экспорт 1Password",
            "1Password-Export", "Exportation 1Password", "Ekspor 1Password"],
        // macOS wraps it in its own sentence: “Mimatory” is trying to <reason>. / „Mimatory“ versucht,
        // <reason>. / Программа «Mimatory» пытается <reason>. — so each is the infinitive phrase.
        Text::BiometricReason => ["unlock your Mimatory vault", "解锁你的密码库存",
            "Mimatoryの保管庫のロックを解除", "desbloquear tu bóveda de Mimatory",
            "desbloquear seu cofre do Mimatory", "разблокировать сейф Mimatory",
            "deinen Mimatory-Tresor zu entsperren", "déverrouiller votre coffre Mimatory",
            "membuka kunci brankas Mimatory Anda"],
    }
}

/// `text` in `locale`.
pub fn tr_in(locale: Locale, text: Text) -> &'static str {
    row(text)[locale.index()]
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
        assert_eq!(Locale::from_tag("fr-FR"), Locale::Fr);
        assert_eq!(Locale::from_tag("pt-PT"), Locale::Pt);
        assert_eq!(Locale::from_tag("pt_BR.UTF-8"), Locale::Pt);
        assert_eq!(Locale::from_tag("es-419"), Locale::Es);
        assert_eq!(Locale::from_tag("de-AT"), Locale::De);
        assert_eq!(Locale::from_tag("ru"), Locale::Ru);
        assert_eq!(Locale::from_tag("in_ID"), Locale::Id);
        assert_eq!(Locale::from_tag("nl-NL"), Locale::En);
        assert_eq!(Locale::from_tag("C"), Locale::En);
        assert_eq!(Locale::from_tag(""), Locale::En);
        assert_eq!(Locale::from_tag("zhx"), Locale::En);
    }

    #[test]
    fn app_name_is_mimatory_except_in_chinese() {
        assert_eq!(tr_in(Locale::En, Text::AppName), "Mimatory");
        for locale in Locale::ALL.into_iter().filter(|locale| *locale != Locale::Zh) {
            assert_eq!(tr_in(locale, Text::AppName), "Mimatory");
        }
        assert_eq!(tr_in(Locale::Zh, Text::AppName), "密码库存");
    }

    #[test]
    fn every_string_is_filled_and_chinese_never_says_mimatory() {
        for text in Text::ALL {
            for locale in Locale::ALL {
                assert!(!tr_in(locale, text).trim().is_empty(), "{text:?} empty in {locale:?}");
                // The app's name outside Chinese is always Mimatory, never 密码库存.
                if locale != Locale::Zh {
                    assert!(!tr_in(locale, text).contains("密码库存"), "{text:?} in {locale:?}");
                }
            }
            assert!(!tr_in(Locale::Zh, text).contains("Mimatory"), "{text:?} says Mimatory in zh");
        }
    }

    #[test]
    fn locale_codes_round_trip() {
        for locale in Locale::ALL {
            assert_eq!(Locale::from_u8(locale.to_u8()), Some(locale));
        }
        assert_eq!(Locale::from_u8(0), None);
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
