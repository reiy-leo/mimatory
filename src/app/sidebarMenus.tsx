import { Archive, ArchiveRestore, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { isHighlighted } from './sidebarHighlights'
import { StyleEditorDialog } from './styleEditorDialog'
import type { VaultWindowModel } from './useVaultWindow'

/** Tag, category, section-highlight and vault menus, their editors and confirmations. */
export function SidebarMenus({ vw }: { vw: VaultWindowModel }) {
  const {
    askTagDelete,
    askVaultDissolve,
    canDissolveVault,
    categoryMenu,
    categoryMenuAnchor,
    clearSectionHighlights,
    closeTagEditor,
    closeVaultEditor,
    dissolveDestinationsFor,
    handleTagDelete,
    handleTagSave,
    handleVaultArchive,
    handleVaultDissolve,
    handleVaultSave,
    highlights,
    openTagEditor,
    openVaultEditor,
    sectionHighlightMenu,
    sectionHighlightMenuAnchor,
    setTagDeleteTarget,
    setTagEditor,
    setVaultDissolveInto,
    setVaultDissolveTarget,
    setVaultEditor,
    t,
    tagDeleteTarget,
    tagEditor,
    tagMenu,
    tagMenuAnchor,
    toggleRowHighlight,
    vaultDissolveInto,
    vaultDissolveTarget,
    vaultEditor,
    vaultMenu,
    vaultMenuAnchor,
  } = vw

  return (
    <>
      {/* A tag row is the only place its icon and name can be changed, and a right-click is how you get
          there. The panel is the same anchored menu the field buttons use, so it clears the sidebar's
          clip and flips above the cursor when the row sits near the foot of the window. */}
      {tagMenu ? (
        <div className="add-more-menu" data-field-menu="" style={tagMenuAnchor?.style}>
          <button className="menu-option with-icon" onClick={openTagEditor} type="button">
            <Pencil aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>{t('vault.editTag')}</span>
            </span>
          </button>
          <button
            className="menu-option with-icon"
            onClick={() => toggleRowHighlight('tag', tagMenu.key)}
            type="button"
          >
            <Pin aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>{t(isHighlighted(highlights, 'tag', tagMenu.key) ? 'vault.unhighlight' : 'vault.highlight')}</span>
            </span>
          </button>
          <button className="menu-option with-icon is-danger" onClick={askTagDelete} type="button">
            <Trash2 aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>{t('vault.deleteTag')}</span>
            </span>
          </button>
        </div>
      ) : null}
      {/* A category is a fixed type rather than a stored row, so keeping it on screen is the only thing a
          right-click can do to it — and the row names which way the toggle will go. */}
      {categoryMenu ? (
        <div className="add-more-menu" data-field-menu="" style={categoryMenuAnchor?.style}>
          <button
            className="menu-option with-icon"
            onClick={() => toggleRowHighlight('category', categoryMenu)}
            type="button"
          >
            <Pin aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>
                {t(isHighlighted(highlights, 'category', categoryMenu) ? 'vault.unhighlight' : 'vault.highlight')}
              </span>
            </span>
          </button>
        </div>
      ) : null}
      {/* The title speaks for its own section only, because folding is a per-section act too — and it only
          opens when that section has a row to take back. */}
      {sectionHighlightMenu ? (
        <div className="add-more-menu" data-field-menu="" style={sectionHighlightMenuAnchor?.style}>
          <button className="menu-option with-icon" onClick={clearSectionHighlights} type="button">
            <PinOff aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>{t('vault.clearHighlights')}</span>
            </span>
          </button>
        </div>
      ) : null}
      {/* Renaming a tag is one row, not every item that names it, so this panel changes the row and the
          items read the new spelling on their own. */}
      {tagEditor ? (
        <StyleEditorDialog
          draft={tagEditor}
          nameLabel={t('vault.tagName')}
          onCancel={closeTagEditor}
          onDraftChange={(patch) => setTagEditor((current) => (current ? { ...current, ...patch } : current))}
          onSubmit={handleTagSave}
          title={t('vault.editTag')}
          titleId="tag-editor-title"
        />
      ) : null}
      {/* Deleting a label is not deleting what it labels, and the panel has to say that in the same
          breath it asks — the count is how many items lose their way to this tag. */}
      {tagDeleteTarget ? (
        <div className="confirm-layer">
          <button
            aria-label={t('common.close')}
            className="confirm-backdrop"
            onClick={() => setTagDeleteTarget(null)}
            type="button"
          />
          <div aria-labelledby="tag-delete-title" aria-modal="true" className="confirm-dialog" role="alertdialog">
            <h2 id="tag-delete-title">{t('vault.deleteTag')}</h2>
            <p>{t('vault.confirmDeleteTag', { count: tagDeleteTarget.count, name: tagDeleteTarget.name })}</p>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setTagDeleteTarget(null)} type="button">
                {t('vault.cancelEditing')}
              </button>
              <button className="danger-button" onClick={handleTagDelete} type="button">
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* A vault row governs the whole window, so its right-click is the only place it can be renamed,
          put away, or taken apart. Dissolve is the one option that destroys something, so it is the
          separated danger row — and it does not appear at all on a row that has nowhere to send its items. */}
      {vaultMenu ? (
        <div className="add-more-menu" data-field-menu="" style={vaultMenuAnchor?.style}>
          <button className="menu-option with-icon" onClick={openVaultEditor} type="button">
            <Pencil aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>{t('vault.editVault')}</span>
            </span>
          </button>
          <button className="menu-option with-icon" onClick={handleVaultArchive} type="button">
            {vaultMenu.archived ? (
              <ArchiveRestore aria-hidden="true" size={15} />
            ) : (
              <Archive aria-hidden="true" size={15} />
            )}
            <span className="menu-option-label">
              <span>{t(vaultMenu.archived ? 'vault.restoreVault' : 'vault.archiveVault')}</span>
            </span>
          </button>
          {canDissolveVault(vaultMenu) ? (
            <button className="menu-option with-icon is-danger separated" onClick={askVaultDissolve} type="button">
              <Trash2 aria-hidden="true" size={15} />
              <span className="menu-option-label">
                <span>{t('vault.dissolveVault')}</span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
      {vaultEditor ? (
        <StyleEditorDialog
          draft={vaultEditor}
          nameLabel={t('vault.vaultName')}
          onCancel={closeVaultEditor}
          onDraftChange={(patch) => setVaultEditor((current) => (current ? { ...current, ...patch } : current))}
          onSubmit={handleVaultSave}
          title={t('vault.editVault')}
          titleId="vault-editor-title"
        />
      ) : null}
      {/* Dissolving moves everything out — archived and trashed rows included, since there is no export
          and no undo — and then deletes the row. An empty vault is asked differently, because the count
          that makes a destination necessary is zero there. */}
      {vaultDissolveTarget ? (
        <div className="confirm-layer">
          <button
            aria-label={t('common.close')}
            className="confirm-backdrop"
            onClick={() => setVaultDissolveTarget(null)}
            type="button"
          />
          <div aria-labelledby="vault-dissolve-title" aria-modal="true" className="confirm-dialog" role="alertdialog">
            <h2 id="vault-dissolve-title">{t('vault.dissolveVault')}</h2>
            <p>
              {vaultDissolveTarget.item_count > 0
                ? t('vault.confirmDissolveVault', {
                    count: vaultDissolveTarget.item_count,
                    name: vaultDissolveTarget.name,
                  })
                : t('vault.confirmDissolveEmpty', { name: vaultDissolveTarget.name })}
            </p>
            {vaultDissolveTarget.item_count > 0 ? (
              <label>
                {t('vault.dissolveInto')}
                <select onChange={(event) => setVaultDissolveInto(event.target.value)} value={vaultDissolveInto}>
                  {dissolveDestinationsFor(vaultDissolveTarget).map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setVaultDissolveTarget(null)} type="button">
                {t('vault.cancelEditing')}
              </button>
              <button
                className="danger-button"
                disabled={vaultDissolveTarget.item_count > 0 && !vaultDissolveInto}
                onClick={handleVaultDissolve}
                type="button"
              >
                {t('vault.dissolveVault')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
