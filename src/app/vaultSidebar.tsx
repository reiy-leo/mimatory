import { ChevronDown, ChevronRight, Pin, Plus } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import appIcon from '../assets/app-icon.png'
import { tagNavigationId } from './itemTags'
import { type NavigationItem, navigationItems } from './navigation'
import { isHighlighted } from './sidebarHighlights'
import { tagColorClass, tagIconComponent } from './tagIcons'
import type { VaultWindowModel } from './useVaultWindow'
import type { VaultSummary } from './vaultApi'
import { iconById } from './vaultModel'

export function SidebarSectionToggle({
  collapsed,
  label,
  onContextMenu,
  onToggle,
}: {
  collapsed: boolean
  label: string
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onToggle: () => void
}) {
  return (
    <button
      aria-expanded={!collapsed}
      className="sidebar-section-title section-toggle"
      onClick={onToggle}
      onContextMenu={onContextMenu}
      type="button"
    >
      <span>{label}</span>
      {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
    </button>
  )
}

/** The sidebar (Browse on a phone) and its resize gutter. */
export function VaultSidebar({ vw }: { vw: VaultWindowModel }) {
  const {
    activeNavigation,
    activeVaultId,
    archivedVaults,
    archivedVaultsCollapsed,
    beginSidebarResize,
    categoriesCollapsed,
    categoryListRef,
    handleSwitchVault,
    highlights,
    isMobileLayout,
    lockedRegion,
    navigationCounts,
    openCategoryMenu,
    openCreateVault,
    openSectionHighlightMenu,
    openTagMenu,
    openVaultMenu,
    openVaults,
    setActiveNavigation,
    setArchivedVaultsCollapsed,
    setCategoriesCollapsed,
    setMobileDetailOpen,
    setMobileTab,
    setTagsCollapsed,
    setVaultsCollapsed,
    sidebarTags,
    t,
    tagsCollapsed,
    vaultsCollapsed,
    visibleCategories,
    visibleTags,
  } = vw

  // One renderer for both halves of the sidebar, because the rows are the same control and only
  // their place differs: what the vault holds on top, and what was taken out of it at the foot.
  function sidebarViewRows(group: NavigationItem['group']) {
    return navigationItems
      .filter((item) => item.group === group)
      .map((item) => {
        const Icon = iconById[item.id]
        return (
          <button
            className={item.id === activeNavigation ? 'nav-item active' : 'nav-item'}
            key={item.id}
            onClick={() => setActiveNavigation(item.id)}
            type="button"
          >
            <Icon size={16} />
            <span>{t(`nav.${item.id}`)}</span>
            <span className="nav-count">{navigationCounts[item.id]}</span>
          </button>
        )
      })
  }

  // A vault row is the same row a tag or a category is, and clicking it changes which vault the whole
  // window reads. The right-click carries the rest: styling, parking, and the one way to lose a vault.
  function sidebarVaultRows(list: VaultSummary[]) {
    return list.map((vault) => {
      const Icon = tagIconComponent(vault.icon)
      return (
        <button
          className={activeNavigation === 'vault' && vault.id === activeVaultId ? 'nav-item active' : 'nav-item'}
          key={vault.id}
          onClick={() => {
            // Coming from another row switches even to the vault the window already names: the session (and `items`)
            // may be on another vault, which is how this row once showed an empty list under a count of 838.
            if (vault.id !== activeVaultId || activeNavigation !== 'vault') void handleSwitchVault(vault.id)
            setActiveNavigation('vault')
          }}
          onContextMenu={(event) => openVaultMenu(event, vault)}
          type="button"
        >
          <Icon className={tagColorClass(vault.color)} size={16} />
          <span>{vault.name}</span>
          <span className="nav-count">{vault.item_count}</span>
        </button>
      )
    })
  }
  return (
    <>
      {/* On a phone the sidebar is the Browse tab: picking any row there goes back to the list it filters. */}
      <aside
        {...lockedRegion}
        aria-label={t('landmarks.primaryNavigation')}
        className="sidebar"
        data-tauri-drag-region="deep"
        onClick={(event) => {
          if (isMobileLayout && (event.target as Element).closest('.nav-item')) {
            setMobileDetailOpen(false)
            setMobileTab('items')
          }
        }}
      >
        <div className="brand">
          <div className="brand-mark is-artwork">
            <img alt="" src={appIcon} />
          </div>
          {/* Which vault is open is a row in the list below now, not a control in the brand block — the
              brand is left to name the app and offer the way to make another vault. */}
          <div className="brand-vault">
            <strong>{t('lock.appName')}</strong>
          </div>
          <button
            aria-label={t('vault.createVault')}
            className="icon-button vault-add-button"
            data-tauri-drag-region="false"
            onClick={openCreateVault}
            title={t('vault.createVault')}
            type="button"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* The views above scroll so the two state rows below stay where they belong: at the foot of
            the sidebar, reachable without hunting past a long category list. */}
        <div className="sidebar-scroll">
          <nav className="nav-list">{sidebarViewRows('vault')}</nav>

          {/* Every vault is a row here, so switching is a click on the one you want rather than a control
              that hides the list. Archived vaults fold into their own section because they are parked
              with everything inside them and cannot be read until one row is restored. */}
          <nav aria-label={t('common.vaults')} className="section-nav">
            <SidebarSectionToggle
              collapsed={vaultsCollapsed}
              label={t('common.vaults')}
              onToggle={() => setVaultsCollapsed((next) => !next)}
            />
            {vaultsCollapsed ? null : (
              <div className="nav-list">
                {sidebarVaultRows(openVaults)}
                {openVaults.length === 0 ? <p className="nav-sublist-empty">{t('vault.noOpenVaults')}</p> : null}
              </div>
            )}
          </nav>

          {archivedVaults.length ? (
            <nav aria-label={t('common.archivedVaults')} className="section-nav">
              <SidebarSectionToggle
                collapsed={archivedVaultsCollapsed}
                label={t('common.archivedVaults')}
                onToggle={() => setArchivedVaultsCollapsed((next) => !next)}
              />
              {archivedVaultsCollapsed ? null : <div className="nav-list">{sidebarVaultRows(archivedVaults)}</div>}
            </nav>
          ) : null}

          <nav aria-label={t('common.tags')} className="section-nav">
            <SidebarSectionToggle
              collapsed={tagsCollapsed}
              label={t('common.tags')}
              onContextMenu={(event) => openSectionHighlightMenu(event, 'tag')}
              onToggle={() => setTagsCollapsed((next) => !next)}
            />
            {/* A fold hides the list but never a row the user asked to keep, so a highlighted tag is
                still there to click and still wears the marker that says why it stayed. */}
            {tagsCollapsed && visibleTags.length === 0 ? null : (
              <div className="nav-sublist">
                {visibleTags.map((tag) => {
                  const Icon = tagIconComponent(tag.icon)
                  return (
                    <button
                      className={activeNavigation === tagNavigationId(tag.key) ? 'nav-item active' : 'nav-item'}
                      key={tag.key}
                      onClick={() => setActiveNavigation(tagNavigationId(tag.key))}
                      onContextMenu={(event) => openTagMenu(event, tag)}
                      type="button"
                    >
                      <Icon className={tagColorClass(tag.color)} size={16} />
                      <span>{tag.name}</span>
                      {isHighlighted(highlights, 'tag', tag.key) ? (
                        <Pin aria-hidden="true" className="text-text-subtlest" size={16} />
                      ) : null}
                      <span className="nav-count">{tag.count}</span>
                    </button>
                  )
                })}
                {sidebarTags.length === 0 ? <p className="nav-sublist-empty">{t('vault.noTags')}</p> : null}
              </div>
            )}
          </nav>

          <nav aria-label={t('common.categories')} className="section-nav">
            <SidebarSectionToggle
              collapsed={categoriesCollapsed}
              label={t('common.categories')}
              onContextMenu={(event) => openSectionHighlightMenu(event, 'category')}
              onToggle={() => setCategoriesCollapsed((next) => !next)}
            />
            {categoriesCollapsed && visibleCategories.length === 0 ? null : (
              <div className="nav-list" ref={categoryListRef}>
                {visibleCategories.map((category) => {
                  const id = `category:${category.itemType}` as const
                  const Icon = category.icon
                  return (
                    <button
                      className={activeNavigation === id ? 'nav-item category-item active' : 'nav-item category-item'}
                      data-item-type={category.itemType}
                      key={category.itemType}
                      onClick={() => setActiveNavigation(id)}
                      onContextMenu={(event) => openCategoryMenu(event, category.itemType)}
                      type="button"
                    >
                      <Icon className={category.colorClass} size={16} />
                      <span>{t(`itemTypes.${category.itemType}`)}</span>
                      {isHighlighted(highlights, 'category', category.itemType) ? (
                        <Pin aria-hidden="true" className="text-text-subtlest" size={16} />
                      ) : null}
                      <span className="nav-count">{navigationCounts[id] ?? 0}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </nav>
        </div>

        <div className="sidebar-footer">
          <nav className="nav-list">{sidebarViewRows('footer')}</nav>
        </div>
      </aside>

      <button
        aria-label={t('vault.resizeSidebar')}
        className="column-resize-handle is-sidebar"
        onMouseDown={beginSidebarResize}
        type="button"
      />
    </>
  )
}
