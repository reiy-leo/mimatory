import type { ProviderMarkId } from './providerMarks'
import { type IconSource, siteIconDomain } from './siteIcons'
import type { CustomField, LoginItem, LoginItemSummary } from './vaultApi'

// "Sign in with…" (like 1Password): a login that is reached through another account instead of a
// password. The provider lives in a `sign_in_with` custom field whose value is a provider id below
// or, for anything else, the name the user typed; the account it signs in with (the Google login,
// say) is a real link — `relations.sign_in_with`, written by `set_item_sign_in` — so it shows on
// both items and keeps both from being deleted, like every other link.

export const signInFieldType = 'sign_in_with'

export const signInProviders: ReadonlyArray<{ domains: readonly string[]; id: ProviderMarkId; name: string }> = [
  { domains: ['google.com', 'gmail.com'], id: 'google', name: 'Google' },
  { domains: ['apple.com', 'icloud.com'], id: 'apple', name: 'Apple' },
  { domains: ['github.com'], id: 'github', name: 'GitHub' },
  { domains: ['microsoft.com', 'live.com', 'outlook.com', 'office.com'], id: 'microsoft', name: 'Microsoft' },
  { domains: ['facebook.com'], id: 'facebook', name: 'Facebook' },
  { domains: ['x.com', 'twitter.com'], id: 'x', name: 'X' },
]

export type SignInProvider = { id: ProviderMarkId; name: string } | { id: 'other'; name: string }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// What a stored field value means. Empty is no provider; a bare item id is a field an older build
// wrote that unlock could not migrate (its target is gone), shown as an unnamed "Other".
export function parseSignInProvider(value: string): SignInProvider | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const known = signInProviders.find((provider) => provider.id === trimmed.toLowerCase())
  if (known) return { id: known.id, name: known.name }
  if (uuidPattern.test(trimmed)) return { id: 'other', name: '' }
  return { id: 'other', name: trimmed }
}

// The value a picked provider is stored as.
export function signInProviderValue(provider: SignInProvider): string {
  return provider.id === 'other' ? provider.name.trim() : provider.id
}

export function signInFieldIndex(fields: CustomField[]): number {
  return fields.findIndex((field) => field.field_type === signInFieldType)
}

export function itemSignInProvider(item: Pick<LoginItem, 'custom_fields'>): SignInProvider | null {
  const index = signInFieldIndex(item.custom_fields)
  return index < 0 ? null : parseSignInProvider(item.custom_fields[index].value)
}

// The same answer from a list summary, which carries the field's raw value as `sign_in_with`.
export function summarySignInProvider(item: Pick<LoginItemSummary, 'sign_in_with'>): SignInProvider | null {
  return item.sign_in_with === undefined ? null : parseSignInProvider(item.sign_in_with)
}

// Sets the item's one "Sign in with" field, adding it when there is none yet.
export function withSignInField(fields: CustomField[], provider: SignInProvider): CustomField[] {
  const value = signInProviderValue(provider)
  const index = signInFieldIndex(fields)
  if (index < 0) return [...fields, { field_type: signInFieldType, label: '', value }]
  return fields.map((field, position) => (position === index ? { ...field, value } : field))
}

export function withoutSignInField(fields: CustomField[]): CustomField[] {
  return fields.filter((field) => field.field_type !== signInFieldType)
}

function hostMatches(host: string, domains: readonly string[]) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

// Which known provider an account item belongs to — its address first, then its title. Mirrors
// `sign_in_provider_for` in vault.rs, which the migration uses.
export function providerOfAccount(item: IconSource & { title: string }): ProviderMarkId | null {
  const host = siteIconDomain(item)
  if (host) {
    const byHost = signInProviders.find((provider) => hostMatches(host, provider.domains))
    if (byHost) return byHost.id
  }
  const title = item.title.toLowerCase()
  return signInProviders.find((provider) => provider.id !== 'x' && title.includes(provider.id))?.id ?? null
}

// The items the account picker offers: anything but the item itself, the ones that belong to the
// chosen provider first, then by title; narrowed by the search text.
// What the account picker reads of an item: a summary or a full item.
export type SignInAccount = IconSource & { id: string; title: string; username: string }

export function signInAccountCandidates<T extends SignInAccount>(
  items: T[],
  selfId: string | null,
  provider: SignInProvider | null,
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  const matchesProvider = (item: T) =>
    provider !== null && provider.id !== 'other' && providerOfAccount(item) === provider.id
  return items
    .filter((item) => item.id !== selfId)
    .filter(
      (item) => !needle || item.title.toLowerCase().includes(needle) || item.username.toLowerCase().includes(needle),
    )
    .sort((left, right) => {
      const rank = Number(matchesProvider(right)) - Number(matchesProvider(left))
      return rank || left.title.localeCompare(right.title)
    })
}
