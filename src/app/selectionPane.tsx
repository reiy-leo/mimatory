import { Archive, ArchiveRestore, ChevronDown, Layers, Trash2 } from 'lucide-react'
import { ItemIcon } from './itemIcon'
import type { VaultWindowModel } from './useVaultWindow'

/**
 * The detail pane while several rows are selected, or while one trash / archive row is (2026-10-25). Finder and
 * 1Password show what the selection is and what can be done to all of it, nothing else: "N Items Selected", then the
 * actions as push buttons (`buttons.md` › Push buttons; the destructive one in the red label, `alerts.md`).
 */
export function SelectionPane({ vw }: { vw: VaultWindowModel }) {
  const {
    archiveSelection,
    bulkBusy,
    itemMenu,
    itemMenuTriggerRef,
    itemSubtitle,
    requestPurgeSelection,
    requestTrashSelection,
    restoreSelection,
    selectedRowIds,
    selectedStateRow,
    selectionMoveTargets,
    setPurgeTarget,
    stateView,
    t,
    toggleSelectionMoveMenu,
  } = vw

  if (selectedStateRow) {
    // One item in the trash or the archive: the pane never edits it there, so it says where it is and offers the way
    // back (and, in the trash, the way out).
    return (
      <div className="detail-empty selection-pane">
        <ItemIcon className="item-icon selection-pane-icon" item={selectedStateRow} />
        <h2>{selectedStateRow.title}</h2>
        <p className="selection-pane-caption">
          {itemSubtitle(selectedStateRow)} · {t(stateView === 'trash' ? 'selection.inTrash' : 'selection.inArchive')}
        </p>
        <p>{t('selection.stateHint')}</p>
        <div className="selection-actions">
          <button
            className="secondary-button"
            disabled={bulkBusy}
            onClick={() => restoreSelection([selectedStateRow.id])}
            type="button"
          >
            <ArchiveRestore aria-hidden="true" size={15} />
            {t('selection.restore')}
          </button>
          {stateView === 'trash' ? (
            <button
              className="danger-button"
              disabled={bulkBusy}
              onClick={() => setPurgeTarget(selectedStateRow)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={15} />
              {t('selection.deletePermanently')}
            </button>
          ) : (
            <button
              className="danger-button"
              disabled={bulkBusy}
              onClick={() => requestTrashSelection([selectedStateRow.id])}
              type="button"
            >
              <Trash2 aria-hidden="true" size={15} />
              {t('selection.moveToTrash')}
            </button>
          )}
        </div>
      </div>
    )
  }

  const count = selectedRowIds.length
  return (
    <section aria-label={t('selection.selectionActions')} className="detail-empty selection-pane">
      <Layers aria-hidden="true" className="detail-empty-icon" size={28} />
      <h2 aria-live="polite">{t('selection.itemsSelected', { count })}</h2>
      <p>{t('selection.hint')}</p>
      <div className="selection-actions">
        {stateView ? (
          <>
            <button className="secondary-button" disabled={bulkBusy} onClick={() => restoreSelection()} type="button">
              <ArchiveRestore aria-hidden="true" size={15} />
              {t('selection.restore')}
            </button>
            {stateView === 'trash' ? (
              <button
                className="danger-button"
                disabled={bulkBusy}
                onClick={() => requestPurgeSelection()}
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
                {t('selection.deletePermanently')}
              </button>
            ) : (
              <button
                className="danger-button"
                disabled={bulkBusy}
                onClick={() => requestTrashSelection()}
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
                {t('selection.moveToTrash')}
              </button>
            )}
          </>
        ) : (
          <>
            <button className="secondary-button" disabled={bulkBusy} onClick={() => archiveSelection()} type="button">
              <Archive aria-hidden="true" size={15} />
              {t('selection.archive')}
            </button>
            {selectionMoveTargets.length ? (
              // The vault list opens from this button the way the item header's menu opens from its ellipsis.
              <button
                aria-expanded={itemMenu === 'selectionMove'}
                aria-haspopup="menu"
                className="secondary-button"
                data-field-menu=""
                disabled={bulkBusy}
                onClick={(event) => toggleSelectionMoveMenu(event.currentTarget)}
                ref={itemMenuTriggerRef}
                type="button"
              >
                {t('selection.moveTo')}
                <ChevronDown aria-hidden="true" size={13} />
              </button>
            ) : null}
            <button className="danger-button" disabled={bulkBusy} onClick={() => requestTrashSelection()} type="button">
              <Trash2 aria-hidden="true" size={15} />
              {t('selection.moveToTrash')}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
