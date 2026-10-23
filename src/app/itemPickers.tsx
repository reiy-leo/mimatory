import { Search } from 'lucide-react'
import { ItemIcon } from './itemIcon'
import { itemTypeArtFor } from './itemTypeArt'
import { SignInPicker } from './signInControls'
import { itemSignInProvider } from './signInProviders'
import type { VaultWindowModel } from './useVaultWindow'
import { categoryItems } from './vaultModel'

/** New Item type menu, the link picker and the Sign in with… sheet. */
export function ItemPickers({ vw }: { vw: VaultWindowModel }) {
  const {
    applySignIn,
    form,
    handleNewItem,
    itemTypeFirstOptionRef,
    itemTypePanelPlaced,
    itemTypePanelRef,
    itemTypePickerOpen,
    items,
    pickRelation,
    relationIcon,
    relationPicker,
    relationPickerItems,
    relationQuery,
    relationSearchRef,
    relationTypeLabel,
    selectedItem,
    setRelationPicker,
    setRelationQuery,
    setSignInPickerOpen,
    signInPickerOpen,
    t,
  } = vw

  return (
    <>
      {/* Every item type is created from here, because the type decides which fields the draft opens
          with. A dropdown hung from the New Item button (owner 2026-10-18), in the sidebar's own category
          order, with the same icon size and type as every other menu. */}
      {itemTypePickerOpen ? (
        <div
          aria-label={t('vault.chooseItemType')}
          className="add-more-menu item-type-menu"
          data-field-menu=""
          ref={itemTypePanelRef}
          role="menu"
          style={{ ...itemTypePanelPlaced, overflowY: 'auto' }}
        >
          {categoryItems.map((category, index) => {
            const Icon = category.icon
            const art = itemTypeArtFor(category.itemType)
            return (
              <button
                className="menu-option with-icon"
                key={category.itemType}
                onClick={() => handleNewItem(category.itemType)}
                ref={index === 0 ? itemTypeFirstOptionRef : undefined}
                role="menuitem"
                type="button"
              >
                {art ? (
                  <img alt="" className="menu-option-art" draggable={false} height={15} src={art} width={15} />
                ) : (
                  <Icon aria-hidden="true" className={category.colorClass} size={15} />
                )}
                <span>{t(`itemTypes.${category.itemType}`)}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {/* The item picker for a link: a sheet with a search field over the vault's live items, minus
          the item itself, what it is already linked to, and anything that would close a loop. */}
      {relationPicker ? (
        <div className="confirm-layer">
          <button
            aria-label={t('common.close')}
            className="confirm-backdrop"
            onClick={() => setRelationPicker(null)}
            type="button"
          />
          <div
            aria-labelledby="relation-picker-title"
            aria-modal="true"
            className="confirm-dialog relation-picker"
            role="dialog"
          >
            <h2 id="relation-picker-title">{t(`vault.relations.pickerTitle.${relationPicker}`)}</h2>
            <p className="relation-picker-hint">{t(`vault.relations.pickerHint.${relationPicker}`)}</p>
            <div className="relation-picker-search">
              <Search aria-hidden="true" size={15} />
              <input
                aria-controls="relation-picker-list"
                aria-label={t('vault.relations.search')}
                onChange={(event) => setRelationQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    document.querySelector<HTMLButtonElement>('#relation-picker-list button')?.focus()
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (relationPickerItems.length === 1) pickRelation(relationPickerItems[0].id)
                  }
                }}
                placeholder={t('vault.relations.search')}
                ref={relationSearchRef}
                type="search"
                value={relationQuery}
              />
            </div>
            {relationPickerItems.length ? (
              <ul
                aria-label={t(`vault.relations.pickerTitle.${relationPicker}`)}
                className="relation-picker-list"
                id="relation-picker-list"
              >
                {relationPickerItems.map((candidate) => {
                  const { colorClass, icon: Icon } = relationIcon(candidate.item_type)
                  return (
                    <li key={candidate.id}>
                      <button
                        className="relation-picker-option"
                        onClick={() => pickRelation(candidate.id)}
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                          event.preventDefault()
                          const row = event.currentTarget.closest('li')
                          const next = event.key === 'ArrowDown' ? row?.nextElementSibling : row?.previousElementSibling
                          if (next) next.querySelector('button')?.focus()
                          else if (event.key === 'ArrowUp') relationSearchRef.current?.focus()
                        }}
                        type="button"
                      >
                        <ItemIcon
                          className="picker-icon"
                          fallback={<Icon aria-hidden="true" className={colorClass} size={16} />}
                          item={candidate}
                        />
                        <span className="relation-row-text">
                          <span className="relation-row-title">{candidate.title}</span>
                          <span className="relation-row-caption">{relationTypeLabel(candidate.item_type)}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="relation-picker-empty">
                {relationQuery.trim() ? t('vault.relations.noMatches') : t('vault.relations.noCandidates')}
              </p>
            )}
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setRelationPicker(null)} type="button">
                {t('vault.cancelEditing')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {signInPickerOpen ? (
        <SignInPicker
          initialAccountId={form.relationDraft.signInId}
          initialProvider={itemSignInProvider(form)}
          items={items}
          onCancel={() => setSignInPickerOpen(false)}
          onDone={applySignIn}
          selfId={selectedItem?.id ?? null}
        />
      ) : null}
    </>
  )
}
