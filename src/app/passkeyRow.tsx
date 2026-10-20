import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { CustomField } from './vaultApi'

/** The hidden key material the app keeps next to a passkey row (see `src-tauri/src/passkey.rs`). */
export const passkeyCredentialFieldType = 'passkey_credential'

type StoredPasskeyMeta = { created_at?: string; rp_id?: string; user_name?: string }

/**
 * When the passkey a row stands for was made: the key material's own stamp when the app holds the
 * key (same relying party, and the same account when both name one), otherwise the item's creation.
 */
export function passkeyCreatedAt(row: CustomField, fields: CustomField[], fallback?: string): string | undefined {
  const rpId = row.label.trim().toLowerCase()
  const matches = fields.flatMap((field) => {
    if (field.field_type !== passkeyCredentialFieldType) return []
    try {
      const meta = JSON.parse(field.value) as StoredPasskeyMeta
      return (meta.rp_id ?? field.label).toLowerCase() === rpId ? [meta] : []
    } catch {
      return []
    }
  })
  const own = matches.find((meta) => !row.value || !meta.user_name || meta.user_name === row.value) ?? matches[0]
  return own?.created_at || fallback
}

function formatCreated(stamp: string | undefined, locale: string) {
  if (!stamp) return ''
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

/** SF Symbols' person.badge.key.fill, drawn for the passkey row. */
export function PasskeyGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="passkey-row-glyph"
      fill="currentColor"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <circle cx="9" cy="7" r="4.25" />
      <path d="M1.5 20.2c0-3.9 3.3-6.7 7.5-6.7 1.6 0 3 .4 4.2 1.1a5 5 0 0 0 .8 5.6v.9H2.4a.9.9 0 0 1-.9-.9Z" />
      <path
        clipRule="evenodd"
        d="M18.25 9a3.75 3.75 0 0 1 1.25 7.29v1.04l1 1-1 1 1 1-1.75 1.67h-.25l-1.5-1.5v-3.21A3.75 3.75 0 0 1 18.25 9Zm0 1.6a1.05 1.05 0 1 0 0 2.1 1.05 1.05 0 0 0 0-2.1Z"
        fillRule="evenodd"
      />
    </svg>
  )
}

/**
 * 1Password's passkey row: the label, when it was created, and the passkey mark on a tint that fades in
 * from the right. Read-only everywhere — the key is the app's, made by the browser extension, never typed.
 */
export function PasskeyRow({
  actions,
  createdAt,
  editing = false,
  field,
}: {
  actions?: ReactNode
  createdAt?: string
  editing?: boolean
  field: CustomField
}) {
  const { i18n, t } = useTranslation()
  const created = formatCreated(createdAt, i18n.language)
  const label = t('vault.customFieldDefaults.passkey')
  const account = [field.value, field.label].filter((part) => part.trim()).join(' · ')
  return (
    <div className={['field-row', 'passkey-row', editing ? 'is-edit' : ''].filter(Boolean).join(' ')} title={account}>
      <div className="field-row-main">
        <span className="field-row-label passkey-row-label">{label}</span>
        <span className="passkey-row-caption">{created ? t('vault.passkeyCreated', { date: created }) : account}</span>
      </div>
      <PasskeyGlyph />
      {actions ? <div className="field-row-actions">{actions}</div> : null}
    </div>
  )
}
