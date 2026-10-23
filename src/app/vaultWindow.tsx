import type { CSSProperties } from 'react'
import { ItemActionsMenu } from './itemActionsMenu'
import { ItemDetailPane } from './itemDetailPane'
import { ItemList } from './itemList'
import { ItemPickers } from './itemPickers'
import { MobileTabBar } from './mobileTabBar'
import { SidebarMenus } from './sidebarMenus'
import { useVaultWindow } from './useVaultWindow'
import { VaultDialogs } from './vaultDialogs'
import { VaultLockScreen } from './vaultLockScreen'
import { VaultSidebar } from './vaultSidebar'
import { VaultToolbar } from './vaultToolbar'

/** The main window (moved from App.tsx): one model, a lock screen, and the panes it is made of. */
export function VaultWindow() {
  const vw = useVaultWindow()
  const {
    composing,
    detailLoading,
    editLocked,
    isMobileLayout,
    itemListWidth,
    mobileDetailOpen,
    mobileTab,
    mode,
    selectedItem,
    sidebarWidth,
    t,
  } = vw

  if (mode !== 'unlocked') return <VaultLockScreen vw={vw} />

  // Which single pane the phone layout shows. The item pane only counts as open while there is an item or
  // a draft to show, so deleting or archiving the open item lands back on the list.
  const mobilePane =
    mobileTab === 'items'
      ? mobileDetailOpen && (selectedItem || detailLoading || composing)
        ? 'detail'
        : 'list'
      : mobileTab

  return (
    <main
      className={editLocked ? 'app-shell is-edit-locked' : 'app-shell'}
      data-mobile-pane={isMobileLayout ? mobilePane : undefined}
      style={{ '--item-list-width': `${itemListWidth}px`, '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    >
      <h1 className="sr-only">{t('landmarks.vaultItems')}</h1>
      <VaultSidebar vw={vw} />
      <VaultToolbar vw={vw} />
      <ItemList vw={vw} />
      <ItemDetailPane vw={vw} />
      <MobileTabBar vw={vw} />
      <ItemPickers vw={vw} />
      <ItemActionsMenu vw={vw} />
      <SidebarMenus vw={vw} />
      <VaultDialogs vw={vw} />
    </main>
  )
}
