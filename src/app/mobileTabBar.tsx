import { Cog, KeyRound, LayoutGrid } from 'lucide-react'
import { SettingsWindow } from './settingsWindow'
import type { VaultWindowModel } from './useVaultWindow'

/** Phone layout only: Settings as a tab and the tab bar. */
export function MobileTabBar({ vw }: { vw: VaultWindowModel }) {
  const { isMobileLayout, mobileTab, setMobileDetailOpen, setMobileTab, t } = vw

  return (
    <>
      {/* Phone layout only: Settings as a tab of the one window, and the tab bar that switches panes
          (iOS tab bar / Material navigation bar — the shapes are in src/skin/mobile.css). */}
      {isMobileLayout ? (
        <>
          {mobileTab === 'settings' ? (
            <section aria-label={t('settings.title')} className="mobile-settings">
              <SettingsWindow embedded />
            </section>
          ) : null}
          <nav aria-label={t('mobile.tabs')} className="mobile-tabbar">
            {(
              [
                ['items', KeyRound, 'mobile.items'],
                ['browse', LayoutGrid, 'mobile.browse'],
                ['settings', Cog, 'settings.title'],
              ] as const
            ).map(([tab, Icon, labelKey]) => (
              <button
                aria-current={mobileTab === tab ? 'page' : undefined}
                className={mobileTab === tab ? 'mobile-tab active' : 'mobile-tab'}
                key={tab}
                onClick={() => {
                  // Tapping the tab you are on goes back to its root, as both platforms do.
                  if (tab === 'items' && mobileTab === 'items') setMobileDetailOpen(false)
                  setMobileTab(tab)
                }}
                type="button"
              >
                <span className="mobile-tab-icon">
                  <Icon size={22} />
                </span>
                <span className="mobile-tab-label">{t(labelKey)}</span>
              </button>
            ))}
          </nav>
        </>
      ) : null}
    </>
  )
}
