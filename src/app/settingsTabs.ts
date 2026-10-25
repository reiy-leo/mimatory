import {
  Keyboard,
  LockKeyhole,
  type LucideIcon,
  Palette,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'

export const settingsTabLabels: Record<SettingsTab, string> = {
  appearance: 'settings.tabs.appearance',
  browser: 'settings.tabs.browser',
  general: 'settings.tabs.general',
  security: 'settings.tabs.security',
  shortcuts: 'settings.tabs.shortcuts',
  sync: 'settings.tabs.sync',
  watchtower: 'settings.tabs.watchtower',
}

/*
 * Each pane's sidebar glyph (owner 2026-10-25: "设置窗口侧边栏的每个item都配一个图标"), drawn like the main window's
 * source list — a 16pt lucide glyph in the accent before the label (design.md › Sidebar), not System Settings'
 * coloured badges, so the two sidebars read as one app.
 */
export const settingsTabIcons: Record<SettingsTab, LucideIcon> = {
  appearance: Palette,
  browser: Puzzle,
  general: SlidersHorizontal,
  security: LockKeyhole,
  shortcuts: Keyboard,
  sync: RefreshCw,
  watchtower: ShieldCheck,
}

/**
 * What the toolbar search can find in Settings (owner 2026-10-18: the search covers settings too, not just item
 * titles): each pane's section headings, plus the pane itself. Picking one opens Settings on that pane.
 */
export const settingsSearchEntries: Array<{
  key: string
  requires?: 'autostart' | 'browserExtension' | 'keyboardShortcuts'
  tab: SettingsTab
}> = [
  { key: 'settings.language', tab: 'general' },
  { key: 'settings.siteIcons', tab: 'general' },
  { key: 'settings.autostart', requires: 'autostart', tab: 'general' },
  { key: 'settings.vaultStatus', tab: 'general' },
  { key: 'sync.title', tab: 'sync' },
  { key: 'settings.toastPosition', tab: 'appearance' },
  { key: 'integrations.browserExtension', requires: 'browserExtension', tab: 'browser' },
  { key: 'integrations.watchtower', tab: 'watchtower' },
  { key: 'security.unlock', tab: 'security' },
  { key: 'security.autoLock', tab: 'security' },
  { key: 'security.clipboard', tab: 'security' },
  { key: 'shortcuts.title', requires: 'keyboardShortcuts', tab: 'shortcuts' },
]

/** Settings opened from the toolbar search land on this pane: the window's URL for a new one, an event otherwise. */
export const settingsTabEvent = 'mimatory://settings-tab'

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && (settingsTabs as string[]).includes(value)
}

export type SettingsTab = 'general' | 'sync' | 'appearance' | 'browser' | 'watchtower' | 'security' | 'shortcuts'

export const settingsTabs: SettingsTab[] = [
  'general',
  'sync',
  'appearance',
  'browser',
  'watchtower',
  'security',
  'shortcuts',
]
