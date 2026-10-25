import { ArrowLeft, Check, ChevronLeft, Ellipsis, Inbox, Loader2, Pencil, Plus, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { EditBannerPattern } from './editBanner'
import { ItemDetailView } from './itemDetailView'
import { ItemEditForm } from './itemEditForm'
import { SelectionPane } from './selectionPane'
import { Toast } from './toast'
import type { VaultWindowModel } from './useVaultWindow'

/** The detail pane: the top bar, then the item in view or edit mode, the loading or the empty state. */
export function ItemDetailPane({ vw }: { vw: VaultWindowModel }) {
  const {
    beginEdit,
    composing,
    detailLoading,
    editBannerHue,
    editLocked,
    form,
    handleCancelEdit,
    hasUnsavedChanges,
    isEditing,
    isMobileLayout,
    itemMenu,
    itemMenuSource,
    itemMenuTriggerRef,
    itemTypePickerOpen,
    listTitle,
    multiSelected,
    openItemTypePicker,
    operationMessage,
    platform,
    saving,
    selectedItem,
    selectedStateRow,
    setMobileDetailOpen,
    setOperationMessage,
    t,
    toggleItemMenu,
  } = vw

  return (
    <section aria-label={t('landmarks.itemDetails')} className="detail-pane">
      {/* Everything the pane can do to the item lives in its top-right corner: the type is the only
            thing named on the left, and the row under the fields went with it. */}
      {/* Editing turns the top bar into a banner in the item category's hue and texture (owner 2026-10-18,
            after 1Password 8): every category has its own SVG tile, so the mode and the kind read at once. */}
      <div
        className={isEditing ? 'detail-topbar is-editing' : 'detail-topbar'}
        data-tauri-drag-region="deep"
        style={isEditing ? ({ '--edit-hue': editBannerHue } as CSSProperties) : undefined}
      >
        {isEditing ? (
          <>
            <EditBannerPattern itemType={form.item_type} />
            <span className="edit-banner-label">{t('vault.editingBanner')}</span>
          </>
        ) : null}
        {isMobileLayout ? (
          <button
            aria-label={t('mobile.back')}
            className="mobile-back-button"
            onClick={() => {
              if (isEditing) handleCancelEdit()
              setMobileDetailOpen(false)
            }}
            type="button"
          >
            {platform === 'ios' || platform === 'macos' ? <ChevronLeft size={22} /> : <ArrowLeft size={20} />}
            <span>{listTitle}</span>
          </button>
        ) : null}
        <div className="detail-topbar-actions">
          {editLocked && hasUnsavedChanges ? (
            <span className="unsaved-hint" role="status">
              {t('vault.unsavedChanges')}
            </span>
          ) : null}
          {isEditing ? (
            <>
              <button className="secondary-button" onClick={handleCancelEdit} type="button">
                <X size={15} />
                {t('vault.cancelEditing')}
              </button>
              {/* The submit button sits outside the form it submits, so it has to name it. */}
              <button className="primary-button" disabled={saving} form="item-detail-form" type="submit">
                <Check size={15} />
                {saving ? t('vault.saving') : selectedItem ? t('vault.saveChanges') : t('vault.createItem')}
              </button>
            </>
          ) : selectedItem ? (
            <>
              <button className="top-edit-button" onClick={beginEdit} type="button">
                <Pencil size={15} />
                {t('vault.edit')}
              </button>
              {/* Everything the pane can do to a stored item sits behind one ellipsis, and only in
                    the read-only state: each row acts on what is already saved, not on unsaved typing. */}
              {/* data-field-menu: the window's outside-click closer is registered by the effect this very
                    click's state change runs, React 18 flushes it before the click reaches window, so without the
                    marker the opening click also closed the menu (owner bug report 2026-10-18). */}
              <button
                aria-expanded={itemMenu !== null && itemMenuSource === 'header'}
                aria-haspopup="menu"
                aria-label={t('vault.itemActions')}
                className="icon-button"
                data-field-menu=""
                onClick={(event) => toggleItemMenu(event.currentTarget)}
                ref={itemMenuTriggerRef}
                title={t('vault.itemActions')}
                type="button"
              >
                <Ellipsis size={16} />
              </button>
            </>
          ) : null}
        </div>
      </div>
      {multiSelected || selectedStateRow ? (
        <SelectionPane vw={vw} />
      ) : selectedItem || composing ? (
        isEditing ? (
          <ItemEditForm vw={vw} />
        ) : (
          <ItemDetailView vw={vw} />
        )
      ) : detailLoading ? (
        /* The row is selected and its detail is being decrypted: a quiet spinner that only fades in when
             the read takes long enough to notice (styles.css .detail-loading). */
        <div aria-busy="true" className="detail-loading" role="status">
          <Loader2 aria-hidden="true" className="import-spinner" size={18} />
          <span className="sr-only">{t('vault.loadingItem')}</span>
        </div>
      ) : (
        /* Nothing is open and no draft is being written, so the pane says so instead of showing a
             blank create form — the state the list lands in after the open item is trashed. */
        <div className="detail-empty">
          <Inbox aria-hidden="true" className="detail-empty-icon" size={28} />
          <h2>{t('vault.noItemSelected')}</h2>
          <p>{t('vault.noItemSelectedHint')}</p>
          <button
            aria-expanded={itemTypePickerOpen}
            aria-haspopup="menu"
            className="secondary-button"
            data-field-menu=""
            onClick={(event) => openItemTypePicker(event.currentTarget)}
            type="button"
          >
            <Plus size={15} />
            {t('vault.newItem')}
          </button>
        </div>
      )}

      {/* Outside the two branches, because the action that most needs to say it just moved the item
            out of the pane. A toast that clears itself, placed where Appearance says. */}
      <Toast message={operationMessage} onDismiss={() => setOperationMessage(null)} />
    </section>
  )
}
