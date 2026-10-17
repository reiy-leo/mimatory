import { ChevronRight, LogIn, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ItemIcon } from './itemIcon'
import { ProviderMark } from './providerMarks'
import { type SignInProvider, signInAccountCandidates, signInProviders } from './signInProviders'
import type { LoginItem, RelatedItemRef } from './vaultApi'

// The provider's mark, or the generic sign-in glyph for a provider the app has no mark for.
export function SignInProviderGlyph({ className, provider }: { className?: string; provider: SignInProvider | null }) {
  if (provider && provider.id !== 'other') return <ProviderMark className={className} provider={provider.id} />
  return <LogIn aria-hidden="true" className={className} size={16} />
}

// "Sign in with Google" — the provider's name for display, falling back to "Other" for an unnamed one.
export function useSignInLabel() {
  const { t } = useTranslation()
  return (provider: SignInProvider | null) =>
    t('vault.signIn.signInWith', { provider: provider?.name || t('vault.signIn.other') })
}

type SignInRowProps = {
  // The linked account item as the vault resolved it; its username comes from the live list.
  account: RelatedItemRef | null
  accountDetail?: string
  onOpen?: (ref: RelatedItemRef) => void
  provider: SignInProvider | null
}

// The read-only row: the provider's mark, "Sign in with Google", and the linked account under it.
// A live linked account makes the row a link to that item; an archived one says so and stays put.
export function SignInRow({ account, accountDetail, onOpen, provider }: SignInRowProps) {
  const { t } = useTranslation()
  const label = useSignInLabel()(provider)
  const caption = account
    ? [accountDetail || account.title, account.archived ? t('vault.relations.archived') : '']
        .filter(Boolean)
        .join(' · ')
    : ''
  const body = (
    <>
      <SignInProviderGlyph className="sign-in-row-mark" provider={provider} />
      <span className="relation-row-text">
        <span className="relation-row-title">{label}</span>
        {caption ? <span className="relation-row-caption">{caption}</span> : null}
      </span>
    </>
  )
  if (account && !account.archived && onOpen) {
    return (
      <button
        aria-label={`${label}, ${t('vault.signIn.open', { title: account.title })}`}
        className="field-row relation-row sign-in-row is-link"
        onClick={() => onOpen(account)}
        type="button"
      >
        {body}
        <ChevronRight aria-hidden="true" className="relation-row-chevron" size={16} />
      </button>
    )
  }
  return <div className="field-row relation-row sign-in-row">{body}</div>
}

type SignInPickerProps = {
  initialAccountId: string | null
  initialProvider: SignInProvider | null
  items: LoginItem[]
  onCancel: () => void
  onDone: (provider: SignInProvider, accountId: string | null) => void
  selfId: string | null
}

// The "Sign in with…" sheet: choose a provider (or name another one), then optionally the vault item
// for the account you sign in with. Done writes both into the form; Save writes them to the vault.
export function SignInPicker({
  initialAccountId,
  initialProvider,
  items,
  onCancel,
  onDone,
  selfId,
}: SignInPickerProps) {
  const { t } = useTranslation()
  const [providerId, setProviderId] = useState<SignInProvider['id'] | null>(initialProvider?.id ?? null)
  const [otherName, setOtherName] = useState(initialProvider?.id === 'other' ? initialProvider.name : '')
  const [accountId, setAccountId] = useState<string | null>(initialAccountId)
  const [query, setQuery] = useState('')
  const firstProviderRef = useRef<HTMLButtonElement>(null)
  const otherNameRef = useRef<HTMLInputElement>(null)

  const provider: SignInProvider | null =
    providerId === null
      ? null
      : providerId === 'other'
        ? { id: 'other', name: otherName.trim() }
        : { id: providerId, name: signInProviders.find((entry) => entry.id === providerId)?.name ?? providerId }
  const candidates = useMemo(
    () => signInAccountCandidates(items, selfId, provider, query),
    [items, selfId, provider, query],
  )
  const ready = provider !== null && (provider.id !== 'other' || provider.name.length > 0)

  // Focus from an effect, never autoFocus (AGENTS.md "no native dialogs").
  useEffect(() => {
    firstProviderRef.current?.focus()
  }, [])
  useEffect(() => {
    if (providerId === 'other') otherNameRef.current?.focus()
  }, [providerId])

  return (
    <div className="confirm-layer">
      <button aria-label={t('common.close')} className="confirm-backdrop" onClick={onCancel} type="button" />
      <div
        aria-labelledby="sign-in-picker-title"
        aria-modal="true"
        className="confirm-dialog relation-picker sign-in-picker"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
          }
        }}
        role="dialog"
      >
        <h2 id="sign-in-picker-title">{t('vault.signIn.pickerTitle')}</h2>
        <p className="relation-picker-hint">{t('vault.signIn.pickerHint')}</p>

        <fieldset className="sign-in-providers">
          <legend>{t('vault.signIn.provider')}</legend>
          {[...signInProviders, { id: 'other' as const, name: t('vault.signIn.other') }].map((entry, index) => (
            <button
              aria-pressed={providerId === entry.id}
              className={providerId === entry.id ? 'sign-in-provider is-selected' : 'sign-in-provider'}
              key={entry.id}
              onClick={() => setProviderId(entry.id)}
              ref={index === 0 ? firstProviderRef : undefined}
              type="button"
            >
              <SignInProviderGlyph provider={entry.id === 'other' ? null : { id: entry.id, name: entry.name }} />
              <span>{entry.name}</span>
            </button>
          ))}
        </fieldset>
        {providerId === 'other' ? (
          <label className="sign-in-other-name">
            {t('vault.signIn.otherName')}
            <input
              onChange={(event) => setOtherName(event.target.value)}
              placeholder={t('vault.signIn.otherNamePlaceholder')}
              ref={otherNameRef}
              value={otherName}
            />
          </label>
        ) : null}

        <div className="sign-in-account">
          <span className="sign-in-account-label" id="sign-in-account-label">
            {t('vault.signIn.account')}
          </span>
          <small className="relation-picker-hint">{t('vault.signIn.accountHint')}</small>
          <div className="relation-picker-search">
            <Search aria-hidden="true" size={15} />
            <input
              aria-controls="sign-in-account-list"
              aria-label={t('vault.signIn.searchAccounts')}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('vault.signIn.searchAccounts')}
              type="search"
              value={query}
            />
          </div>
          <ul aria-labelledby="sign-in-account-label" className="relation-picker-list" id="sign-in-account-list">
            <li>
              <button
                aria-pressed={accountId === null}
                className={accountId === null ? 'relation-picker-option is-selected' : 'relation-picker-option'}
                onClick={() => setAccountId(null)}
                type="button"
              >
                <span aria-hidden="true" className="picker-icon is-empty" />
                <span className="relation-row-text">
                  <span className="relation-row-title">{t('vault.signIn.noAccount')}</span>
                </span>
              </button>
            </li>
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  aria-pressed={accountId === candidate.id}
                  className={
                    accountId === candidate.id ? 'relation-picker-option is-selected' : 'relation-picker-option'
                  }
                  onClick={() => setAccountId(candidate.id)}
                  type="button"
                >
                  <ItemIcon className="picker-icon" item={candidate} />
                  <span className="relation-row-text">
                    <span className="relation-row-title">{candidate.title}</span>
                    {candidate.username ? <span className="relation-row-caption">{candidate.username}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="confirm-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            {t('vault.cancelEditing')}
          </button>
          <button
            className="primary-button"
            disabled={!ready}
            onClick={() => {
              if (provider && ready) onDone(provider, accountId)
            }}
            type="button"
          >
            {t('vault.signIn.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
