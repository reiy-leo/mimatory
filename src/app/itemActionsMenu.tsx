import {
  Archive,
  ArchiveRestore,
  CaseUpper,
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderInput,
  Globe,
  Pencil,
  RefreshCw,
  Share,
  Star,
  Trash2,
  Vault,
} from 'lucide-react'
import { siteIconDomain } from './siteIcons'
import type { VaultWindowModel } from './useVaultWindow'

/** The item actions panel (header ellipsis or row right-click). */
export function ItemActionsMenu({ vw }: { vw: VaultWindowModel }) {
  const {
    archiveSelection,
    beginEdit,
    closeFieldMenus,
    handleArchive,
    handleDuplicate,
    handleFavorite,
    handleIconMode,
    handleMoveToVault,
    handleRefreshIcon,
    handleShare,
    handleTrash,
    itemMenu,
    itemMenuAnchor,
    itemMenuPanelRef,
    itemMenuPlaced,
    itemMenuSource,
    moveSelection,
    otherVaults,
    requestPurgeSelection,
    requestTrashSelection,
    restoreSelection,
    selectedRowIds,
    selectionMoveTargets,
    stateView,
    selectedHasRelations,
    selectedItem,
    setItemMenu,
    siteIconsEnabled,
    t,
  } = vw

  return (
    <>
      {/* The header's ellipsis. Two sections share one anchor: the vault list swaps in place rather
          than flying out beside a panel that already sits at the right edge of the window. */}
      {itemMenu ? (
        <div
          className="add-more-menu item-actions-menu"
          data-field-menu=""
          ref={itemMenuPanelRef}
          role="menu"
          style={itemMenuSource === 'header' ? { ...itemMenuPlaced, overflowY: 'auto' } : itemMenuAnchor?.style}
        >
          {itemMenu === 'selection' ? (
            // A multi-selection's right-click, or any trash / archive row's: what applies to every selected item.
            stateView ? (
              <>
                <button className="menu-option with-icon" onClick={() => restoreSelection()} type="button">
                  <ArchiveRestore aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{t('selection.restore')}</span>
                  </span>
                </button>
                <button
                  className="menu-option with-icon is-danger separated"
                  onClick={() => (stateView === 'trash' ? requestPurgeSelection() : requestTrashSelection())}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{t(stateView === 'trash' ? 'selection.deletePermanently' : 'selection.moveToTrash')}</span>
                  </span>
                </button>
              </>
            ) : (
              <>
                <p className="list-sort-heading">{t('selection.itemsSelected', { count: selectedRowIds.length })}</p>
                <button className="menu-option with-icon" onClick={() => archiveSelection()} type="button">
                  <Archive aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{t('selection.archive')}</span>
                  </span>
                </button>
                {selectionMoveTargets.length ? (
                  <button className="menu-option with-icon" onClick={() => setItemMenu('selectionMove')} type="button">
                    <FolderInput aria-hidden="true" size={15} />
                    <span className="menu-option-label trailing">
                      <span>{t('selection.moveTo')}</span>
                      <ChevronRight aria-hidden="true" size={15} />
                    </span>
                  </button>
                ) : null}
                <button
                  className="menu-option with-icon is-danger separated"
                  onClick={() => requestTrashSelection()}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{t('selection.moveToTrash')}</span>
                  </span>
                </button>
              </>
            )
          ) : itemMenu === 'selectionMove' ? (
            <>
              {itemMenuSource === 'row' ? (
                <button className="menu-option with-icon" onClick={() => setItemMenu('selection')} type="button">
                  <ChevronLeft aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{t('selection.moveTo')}</span>
                  </span>
                </button>
              ) : null}
              {selectionMoveTargets.map((vault) => (
                <button
                  className="menu-option with-icon"
                  key={vault.id}
                  onClick={() => moveSelection(vault)}
                  type="button"
                >
                  <Vault aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{vault.name}</span>
                  </span>
                </button>
              ))}
            </>
          ) : itemMenu === 'move' ? (
            <>
              <button className="menu-option with-icon" onClick={() => setItemMenu('actions')} type="button">
                <ChevronLeft aria-hidden="true" size={15} />
                <span className="menu-option-label">
                  <span>{t('vault.moveTo')}</span>
                </span>
              </button>
              {otherVaults.map((vault) => (
                <button
                  className="menu-option with-icon"
                  key={vault.id}
                  onClick={() => void handleMoveToVault(vault.id, vault.name)}
                  type="button"
                >
                  <Vault aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{vault.name}</span>
                  </span>
                </button>
              ))}
            </>
          ) : (
            <>
              {/* Where the panel opened decides what it offers: a row has no 编辑 button next to it, and
                  the header has no need of one; 分享 copies the password, which is the header's business
                  on the item already on screen. */}
              {itemMenuSource === 'row' ? (
                <button className="menu-option with-icon" onClick={beginEdit} type="button">
                  <Pencil aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{t('vault.edit')}</span>
                  </span>
                </button>
              ) : null}
              <button
                className="menu-option with-icon"
                onClick={() => {
                  closeFieldMenus()
                  void handleFavorite()
                }}
                type="button"
              >
                <Star aria-hidden="true" size={15} />
                <span className="menu-option-label">
                  <span>{selectedItem?.favorite ? t('vault.unfavorite') : t('vault.favorite')}</span>
                </span>
              </button>
              {otherVaults.length ? (
                // Links never cross a vault, so a linked item stays put until its links are removed.
                <button
                  className="menu-option with-icon"
                  disabled={selectedHasRelations}
                  onClick={() => setItemMenu('move')}
                  type="button"
                >
                  <FolderInput aria-hidden="true" size={15} />
                  <span className={selectedHasRelations ? 'menu-option-label' : 'menu-option-label trailing'}>
                    <span>{t('vault.moveTo')}</span>
                    {selectedHasRelations ? (
                      <small>{t('vault.relations.moveBlocked')}</small>
                    ) : (
                      <ChevronRight aria-hidden="true" size={15} />
                    )}
                  </span>
                </button>
              ) : null}
              <button className="menu-option with-icon" onClick={() => void handleDuplicate()} type="button">
                <Copy aria-hidden="true" size={15} />
                <span className="menu-option-label">
                  <span>{t('vault.duplicateItem')}</span>
                </span>
              </button>
              {selectedItem && siteIconDomain(selectedItem) ? (
                <>
                  {siteIconsEnabled ? (
                    <button className="menu-option with-icon" onClick={() => void handleRefreshIcon()} type="button">
                      <RefreshCw aria-hidden="true" size={15} />
                      <span className="menu-option-label">
                        <span>{t('vault.siteIcon.refresh')}</span>
                      </span>
                    </button>
                  ) : null}
                  {selectedItem.icon_mode === 'letter' ? (
                    <button className="menu-option with-icon" onClick={() => void handleIconMode('auto')} type="button">
                      <Globe aria-hidden="true" size={15} />
                      <span className="menu-option-label">
                        <span>{t('vault.siteIcon.useWebsite')}</span>
                      </span>
                    </button>
                  ) : (
                    <button
                      className="menu-option with-icon"
                      onClick={() => void handleIconMode('letter')}
                      type="button"
                    >
                      <CaseUpper aria-hidden="true" size={15} />
                      <span className="menu-option-label">
                        <span>{t('vault.siteIcon.useLetter')}</span>
                      </span>
                    </button>
                  )}
                </>
              ) : null}
              {itemMenuSource === 'header' ? (
                <button className="menu-option with-icon" onClick={() => void handleShare()} type="button">
                  <Share aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{t('vault.shareAction')}</span>
                    <small>{t('vault.shareHint')}</small>
                  </span>
                </button>
              ) : null}
              <button
                className="menu-option with-icon separated"
                onClick={() => {
                  closeFieldMenus()
                  void handleArchive()
                }}
                type="button"
              >
                <Archive aria-hidden="true" size={15} />
                <span className="menu-option-label">
                  <span>{t('vault.archiveAction')}</span>
                </span>
              </button>
              {/* An item with a parent, children or peers cannot be deleted (Rust refuses it too); the row
                  stays visible but unavailable and says why, with Archive right above it. */}
              <button
                aria-describedby={selectedHasRelations ? 'delete-blocked-hint' : undefined}
                className="menu-option with-icon is-danger"
                disabled={selectedHasRelations}
                onClick={() => {
                  closeFieldMenus()
                  void handleTrash()
                }}
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
                <span className="menu-option-label">
                  <span>{t('common.delete')}</span>
                  {selectedHasRelations ? (
                    <small id="delete-blocked-hint">{t('vault.relations.deleteBlocked')}</small>
                  ) : null}
                </span>
              </button>
            </>
          )}
        </div>
      ) : null}
    </>
  )
}
