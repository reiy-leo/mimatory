export const settingsTabLabels: Record<SettingsTab, string> = {
  appearance: 'settings.tabs.appearance',
  browser: 'settings.tabs.browser',
  general: 'settings.tabs.general',
  security: 'settings.tabs.security',
  shortcuts: 'settings.tabs.shortcuts',
  watchtower: 'settings.tabs.watchtower',
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
  { key: 'settings.appearance', tab: 'appearance' },
  { key: 'settings.toastPosition', tab: 'appearance' },
  { key: 'integrations.browserExtension', requires: 'browserExtension', tab: 'browser' },
  { key: 'integrations.watchtower', tab: 'watchtower' },
  { key: 'security.unlock', tab: 'security' },
  { key: 'security.autoLock', tab: 'security' },
  { key: 'security.clipboard', tab: 'security' },
  { key: 'shortcuts.title', requires: 'keyboardShortcuts', tab: 'shortcuts' },
]

/** Settings opened from the toolbar search land on this pane: the window's URL for a new one, an event otherwise. */
export const settingsTabEvent = 'passless://settings-tab'

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && (settingsTabs as string[]).includes(value)
}

export type SettingsTab = 'general' | 'appearance' | 'browser' | 'watchtower' | 'security' | 'shortcuts'

export const settingsTabs: SettingsTab[] = ['general', 'appearance', 'browser', 'watchtower', 'security', 'shortcuts']
