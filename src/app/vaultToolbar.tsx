import { ArrowDown, ArrowUp, Plus, Search, Settings } from 'lucide-react'
import { ItemIcon } from './itemIcon'
import { shortcutLabel } from './platformFeatures'
import type { VaultWindowModel } from './useVaultWindow'

/** The toolbar: previous / next, the search over items and settings, New Item. */
export function VaultToolbar({ vw }: { vw: VaultWindowModel }) {
  const {
    itemSubtitle,
    itemTypePickerOpen,
    jumpToSearchResult,
    lockedRegion,
    newItemButtonRef,
    nextItemId,
    openItemTypePicker,
    openSettingsWindow,
    platform,
    previousItemId,
    setTopSearch,
    stepSelectedItem,
    t,
    topSearch,
    topSearchInputRef,
    topSearchResults,
    topSettingsResults,
  } = vw

  return (
    <header {...lockedRegion} className="top-search-bar" data-tauri-drag-region="deep">
      {/* Previous / next item (⌘↑ / ⌘↓), the toolbar's leading control pair; hidden in the phone layout. */}
      <div className="top-item-nav" data-tauri-drag-region="false">
        <button
          aria-label={t('vault.previousItem')}
          className="icon-button"
          disabled={!previousItemId}
          onClick={() => stepSelectedItem(-1)}
          title={`${t('vault.previousItem')} (${shortcutLabel('mod+↑', platform)})`}
          type="button"
        >
          <ArrowUp size={16} />
        </button>
        <button
          aria-label={t('vault.nextItem')}
          className="icon-button"
          disabled={!nextItemId}
          onClick={() => stepSelectedItem(1)}
          title={`${t('vault.nextItem')} (${shortcutLabel('mod+↓', platform)})`}
          type="button"
        >
          <ArrowDown size={16} />
        </button>
      </div>
      <div className="top-search-wrap">
        <label className="top-search-box">
          <Search size={16} />
          <input
            aria-label={t('vault.searchAllItems')}
            onChange={(event) => setTopSearch(event.target.value)}
            placeholder={t('vault.searchAllItems')}
            ref={topSearchInputRef}
            value={topSearch}
          />
        </label>
        {topSearch.trim() ? (
          <div className="top-search-results" data-tauri-drag-region="false">
            {topSearchResults.map((item) => (
              <button key={item.id} onClick={() => jumpToSearchResult(item.id)} type="button">
                <ItemIcon item={item} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{itemSubtitle(item)}</small>
                </span>
              </button>
            ))}
            {topSettingsResults.map((entry) => (
              <button
                key={entry.key}
                onClick={() => {
                  setTopSearch('')
                  void openSettingsWindow(entry.tab)
                }}
                type="button"
              >
                <span aria-hidden="true" className="item-icon top-search-settings-icon">
                  <Settings size={18} />
                </span>
                <span>
                  <strong>{entry.label}</strong>
                  <small>{t('vault.searchSettingsIn', { pane: entry.paneLabel })}</small>
                </span>
              </button>
            ))}
            {topSearchResults.length === 0 && topSettingsResults.length === 0 ? (
              <p>{t('vault.noSearchResults')}</p>
            ) : null}
          </div>
        ) : null}
      </div>
      <button
        aria-expanded={itemTypePickerOpen}
        aria-haspopup="menu"
        className="top-new-item-button"
        data-field-menu=""
        onClick={(event) => openItemTypePicker(event.currentTarget)}
        ref={newItemButtonRef}
        type="button"
      >
        <Plus size={16} />
        {t('vault.newItem')}
      </button>
    </header>
  )
}
