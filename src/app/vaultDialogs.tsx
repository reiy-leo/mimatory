import { FileArchive, Loader2 } from 'lucide-react'
import { TextPreviewDialog } from './attachmentControls'
import i18n from './i18n'
import type { VaultWindowModel } from './useVaultWindow'

/** Text preview, permanent delete, 1Password import and the create-vault sheet. */
export function VaultDialogs({ vw }: { vw: VaultWindowModel }) {
  const {
    closeCreateVault,
    closeTextPreview,
    confirm1puxImport,
    copySecretText,
    handleCreateVault,
    isCreatingVault,
    isImporting1pux,
    onePuxPreview,
    purgeTarget,
    purgeTrashedItem,
    setError,
    setOnePuxPreview,
    setPurgeTarget,
    setVaultNameDraft,
    t,
    textPreview,
    vaultNameDraft,
    vaultNameInputRef,
  } = vw

  return (
    <>
      {/* The only way to end a trashed row is here, and window.confirm() answers false without ever
          showing anything, so the question is drawn in the page. Its dismiss is a real button behind
          the card, not a click handler on a div: it stays keyboard reachable, and a click inside the
          card cannot reach it. */}
      {textPreview ? (
        <TextPreviewDialog
          onClose={closeTextPreview}
          onCopy={async (text) => {
            try {
              // An attachment in a password vault may well hold a secret: it honours the 90-second clear.
              await copySecretText(text, true)
              return true
            } catch (nextError) {
              setError(String(nextError))
              return false
            }
          }}
          state={textPreview}
        />
      ) : null}
      {purgeTarget ? (
        <div className="confirm-layer">
          <button
            aria-label={t('vault.cancelEditing')}
            className="confirm-backdrop"
            onClick={() => setPurgeTarget(null)}
            type="button"
          />
          <div aria-labelledby="purge-confirm-title" aria-modal="true" className="confirm-dialog" role="alertdialog">
            <h2 id="purge-confirm-title">{t('vault.purgeHeading')}</h2>
            <p>{t('vault.confirmPurge', { title: purgeTarget.title })}</p>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setPurgeTarget(null)} type="button">
                {t('vault.cancelEditing')}
              </button>
              <button className="danger-button" onClick={purgeTrashedItem} type="button">
                {t('vault.purge')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {onePuxPreview ? (
        <div aria-busy={isImporting1pux} className="confirm-layer import-layer">
          <button
            aria-label={t('vault.cancelEditing')}
            className="confirm-backdrop"
            disabled={isImporting1pux}
            onClick={() => setOnePuxPreview(null)}
            tabIndex={-1}
            type="button"
          />
          <div
            aria-labelledby="import-1pux-title"
            aria-modal="true"
            className={isImporting1pux ? 'confirm-dialog import-dialog is-busy' : 'confirm-dialog import-dialog'}
            role="dialog"
          >
            <h2 id="import-1pux-title">{t('vault.import1pux.heading')}</h2>
            <p className="import-source" title={onePuxPreview.path}>
              <FileArchive aria-hidden="true" size={14} />
              <span>{onePuxPreview.path.split(/[\\/]/).pop()}</span>
            </p>
            <dl className="import-stats">
              <div>
                <dt>{t('vault.import1pux.statItems')}</dt>
                <dd>{onePuxPreview.item_count.toLocaleString(i18n.language)}</dd>
              </div>
              <div>
                <dt>{t('vault.import1pux.statVaults')}</dt>
                <dd>{onePuxPreview.vaults.length.toLocaleString(i18n.language)}</dd>
              </div>
              <div>
                <dt>{t('vault.import1pux.statAttachments')}</dt>
                <dd>{onePuxPreview.attachment_count.toLocaleString(i18n.language)}</dd>
              </div>
            </dl>
            <h3 className="import-section-title">{t('vault.import1pux.vaultsHeading')}</h3>
            <ul className="import-vault-list">
              {onePuxPreview.vaults.map((vault) => (
                <li key={vault.name}>
                  <span className="import-vault-name">{vault.name}</span>
                  <span className="import-vault-count">
                    {t('vault.import1pux.items', { count: vault.item_count.toLocaleString(i18n.language) })}
                  </span>
                  <span className={vault.exists ? 'import-vault-badge' : 'import-vault-badge is-new'}>
                    {t(vault.exists ? 'vault.import1pux.badgeExisting' : 'vault.import1pux.badgeNew')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="import-vault-note">{t('vault.import1pux.note')}</p>
            {isImporting1pux ? (
              <div className="import-progress" role="status">
                <Loader2 aria-hidden="true" className="import-spinner" size={18} />
                <span>{t('vault.import1pux.importingDetail', { count: onePuxPreview.item_count })}</span>
              </div>
            ) : (
              <div className="confirm-actions">
                <button className="secondary-button" onClick={() => setOnePuxPreview(null)} type="button">
                  {t('vault.cancelEditing')}
                </button>
                <button
                  className="primary-button"
                  disabled={!onePuxPreview.item_count}
                  onClick={() => void confirm1puxImport()}
                  type="button"
                >
                  {t('vault.import1pux.confirm')}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
      {/* A new vault needs a name before anything can go in it. prompt() is as dead here as confirm()
          was, so the same small modal recipe collects it with a labelled field. */}
      {isCreatingVault ? (
        <div className="confirm-layer">
          <button
            aria-label={t('common.close')}
            className="confirm-backdrop"
            onClick={closeCreateVault}
            type="button"
          />
          <div aria-labelledby="create-vault-title" aria-modal="true" className="confirm-dialog" role="dialog">
            <h2 id="create-vault-title">{t('vault.createVault')}</h2>
            <form onSubmit={handleCreateVault}>
              <label>
                {t('vault.vaultName')}
                <input
                  onChange={(event) => setVaultNameDraft(event.target.value)}
                  ref={vaultNameInputRef}
                  type="text"
                  value={vaultNameDraft}
                />
              </label>
              <div className="confirm-actions">
                <button className="secondary-button" onClick={closeCreateVault} type="button">
                  {t('vault.cancelEditing')}
                </button>
                <button className="primary-button" disabled={!vaultNameDraft.trim()} type="submit">
                  {t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
