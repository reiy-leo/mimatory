import {
  Archive,
  BadgeCheck,
  Braces,
  Car,
  Coins,
  CreditCard,
  Database,
  DollarSign,
  IdCard,
  KeyRound,
  Mail,
  NotebookTabs,
  Plane,
  Router,
  Server,
  Star,
  Terminal,
  Trash2,
  Vault,
  Wifi,
} from 'lucide-react'
import type { FieldMeta } from './fieldControls'
import i18n, { supportedLanguages } from './i18n'
import { type LabelResolver, normalizeTemplateFields, pruneEmptyTemplateFields } from './itemFields'
import { type RelationDraft, relationDraftOf } from './itemRelations'
import type { TagNavigation } from './itemTags'
import type { TemplateField } from './itemTemplates'
import type { navigationItems } from './navigation'
import {
  customFieldsToInput,
  type ItemUrl,
  type LoginItem,
  type LoginItemInput,
  type LoginItemSummary,
  parseCustomFields,
  parseTags,
  tagsToInput,
  type UrlMatchType,
} from './vaultApi'

export type VaultMode = 'loading' | 'setup' | 'locked' | 'unlocked'

export type CategoryItemType = (typeof categoryItems)[number]['itemType']

export type CategoryNavigation = `category:${CategoryItemType}`

// 'vault' is a vault row picked in the sidebar: it and All (`vaults`) are exclusive, so only one of them is ever
// highlighted (owner 2026-10-18).
export type ActiveNavigation = (typeof navigationItems)[number]['id'] | CategoryNavigation | TagNavigation | 'vault'

export type LoginFormState = LoginItemInput & {
  tagsInput: string
  customFieldsInput: string
  urlsInput: UrlFormState[]
  // The item's links as the form is editing them. Not part of the item payload: a save writes the
  // item first, then sends the difference from the stored links through their own commands.
  relationDraft: RelationDraft
}

export type UrlFormState = ItemUrl & {
  id: string
}

export type FieldTotpPreview = {
  code: string
  secondsRemaining: number
}

export const defaultWebsiteLabel = 'website'

export const defaultUrlMatchType: UrlMatchType = 'domain'

// Each drag-resized column keeps its own clamp; `default` is what `--measure-*` in styles.css also
// starts the column at, and the two gutter handles below are the only thing that changes it.
export const itemListWidthLimits = { default: 220, max: 250, min: 180 }

export const sidebarWidthLimits = { default: 220, max: 220, min: 150 }

// Column widths the user dragged survive relaunches (owner 2026-10-18), clamped in case the limits changed.
export const columnWidthStorageKey = 'mimatory-column-widths'

export function readColumnWidth(key: 'itemList' | 'sidebar', limits: { default: number; max: number; min: number }) {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(columnWidthStorageKey) ?? '{}')?.[key]
    if (typeof stored === 'number' && Number.isFinite(stored)) return Math.min(limits.max, Math.max(limits.min, stored))
  } catch {
    // Unreadable store: fall back to the default width.
  }
  return limits.default
}

export function storeColumnWidth(key: 'itemList' | 'sidebar', width: number) {
  try {
    const current = JSON.parse(globalThis.localStorage?.getItem(columnWidthStorageKey) ?? '{}')
    globalThis.localStorage?.setItem(
      columnWidthStorageKey,
      JSON.stringify({ ...(current && typeof current === 'object' ? current : {}), [key]: width }),
    )
  } catch {
    // Private mode or a full store: the width still holds for this session.
  }
}

export const settingsWindowSize = { height: 680, width: 920 }

export function createFormId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

export function toUrlFormState(url: ItemUrl): UrlFormState {
  return {
    id: createFormId(),
    label: url.label || defaultWebsiteLabel,
    match_type: url.match_type,
    url: url.url,
  }
}

export function urlsForForm(item: LoginItem | LoginItemInput): UrlFormState[] {
  const urls = item.urls?.length
    ? item.urls
    : item.website
      ? [{ label: defaultWebsiteLabel, match_type: defaultUrlMatchType, url: item.website }]
      : [{ label: defaultWebsiteLabel, match_type: defaultUrlMatchType, url: '' }]
  return urls.map(toUrlFormState)
}

export function normalizeFormUrls(urls: UrlFormState[], fallbackWebsite: string): ItemUrl[] {
  const normalized = urls.map((itemUrl) => ({
    label: itemUrl.label.trim() || defaultWebsiteLabel,
    match_type: itemUrl.match_type,
    url: itemUrl.url.trim(),
  }))
  const filled = normalized.filter((itemUrl) => itemUrl.url)
  if (filled.length === 0 && fallbackWebsite.trim()) {
    return [{ label: defaultWebsiteLabel, match_type: defaultUrlMatchType, url: fallbackWebsite.trim() }]
  }
  return filled
}

// Only used to decide which side of the trigger has more room, so a rough height is enough.
export const menuRowHeight = 36

// Edit, highlight, delete — the highlight row reads 取消突出显示 once the row already carries one.
export const tagMenuHeight = 3 * menuRowHeight + 24

// A category row has the one action, and so does a section title once it has anything to clear.
export const highlightMenuHeight = menuRowHeight + 24

// Edit, archive or restore, and dissolve — the last only when the row can be emptied somewhere.
export const vaultMenuHeight = 3 * menuRowHeight + 24

// The item panel is wider than the button it hangs from, and its two sections are the same height
// because only the taller one can ever be the one that has to flip above the trigger.
export const itemMenuWidth = 220

// Move and Delete each carry a one-line hint while the item has links, hence the extra allowance.
export const itemMenuHeight = 10 * menuRowHeight + 40

// These belong with the credentials they protect, so they render in the username /
// password group instead of the custom field list.
export const loginSectionFieldTypes = ['otp', 'sign_in_with', 'passkey']

/** Passkeys Mimatory itself created (passkey.rs): JSON with the private key, kept but never shown. */
export const passkeyCredentialFieldType = 'passkey_credential'

export const categoryItems = [
  { colorClass: 'text-accent-icon-teal', icon: KeyRound, itemType: 'login' },
  { colorClass: 'text-accent-icon-yellow', icon: NotebookTabs, itemType: 'secure_note' },
  { colorClass: 'text-accent-icon-blue', icon: CreditCard, itemType: 'credit_card' },
  { colorClass: 'text-accent-icon-green', icon: IdCard, itemType: 'identity' },
  { colorClass: 'text-accent-icon-gray', icon: KeyRound, itemType: 'password' },
  { colorClass: 'text-accent-icon-yellow', icon: Terminal, itemType: 'ssh_key' },
  { colorClass: 'text-accent-icon-orange', icon: DollarSign, itemType: 'bank_account' },
  { colorClass: 'text-accent-icon-purple', icon: Plane, itemType: 'passport' },
  { colorClass: 'text-accent-icon-orange', icon: Car, itemType: 'driver_license' },
  { colorClass: 'text-accent-icon-teal', icon: Wifi, itemType: 'wifi' },
  { colorClass: 'text-accent-icon-magenta', icon: Braces, itemType: 'api_credential' },
  { colorClass: 'text-accent-icon-gray', icon: Server, itemType: 'server' },
  { colorClass: 'text-accent-icon-lime', icon: Database, itemType: 'database' },
  { colorClass: 'text-accent-icon-magenta', icon: Mail, itemType: 'email' },
  { colorClass: 'text-accent-icon-blue', icon: Router, itemType: 'router' },
  { colorClass: 'text-accent-icon-blue', icon: BadgeCheck, itemType: 'software_license' },
  { colorClass: 'text-accent-icon-lime', icon: Coins, itemType: 'crypto_wallet' },
] as const

// Labels reach the template code as a resolver: the current language for display, every language for
// recognising a label an older build stored already translated.
export const fieldLabels: LabelResolver = {
  label: (labelKey) => i18n.t(labelKey),
  variants: (labelKey) => supportedLanguages.map((language) => i18n.getFixedT(language)(labelKey)),
}

export function templateFieldMeta(field: TemplateField | undefined): FieldMeta | undefined {
  if (!field) return undefined
  return {
    expiry: field.expiry,
    inputMode: field.inputMode,
    monospace: field.monospace,
    options: field.options,
    validation: field.validation,
  }
}

// These keep their own controls (a seed with QR import, an attachment, an item picker); every other type
// is drawn by the shared field components.
export const specialFieldTypes = ['otp', 'file', 'related_item', 'sign_in_with', 'passkey', 'section']

export function fieldValuePlaceholderKey(fieldType: string) {
  if (fieldType === 'month_year') return 'vault.monthYearPlaceholder'
  if (fieldType === 'otp') return 'vault.otpSecretPlaceholder'
  if (fieldType === 'card_number') return 'vault.cardNumberPlaceholder'
  if (fieldType === 'email') return 'vault.emailPlaceholder'
  if (fieldType === 'url') return 'vault.urlPlaceholder'
  return 'vault.fieldValue'
}

export function itemTitleById(items: LoginItemSummary[], id: string) {
  return items.find((item) => item.id === id)?.title ?? id
}

export function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export const iconById = {
  archived: Archive,
  favorites: Star,
  trash: Trash2,
  vaults: Vault,
} as const

export function toFormState(item: LoginItem | LoginItemInput): LoginFormState {
  // Old items gain the fields their template has grown since, and labels saved in any language find
  // their template field again; nothing here is written back until the user saves.
  const customFields = normalizeTemplateFields(item.item_type, item.custom_fields, fieldLabels)
  return {
    custom_fields: customFields,
    customFieldsInput: customFieldsToInput(customFields),
    favorite: item.favorite,
    item_type: item.item_type,
    notes: item.notes,
    password: item.password,
    relationDraft: relationDraftOf('relations' in item ? item.relations : undefined),
    tags: item.tags,
    tagsInput: tagsToInput(item.tags),
    title: item.title,
    urls: item.urls ?? [],
    urlsInput: urlsForForm(item),
    username: item.username,
    website: item.website,
  }
}

export function toInput(form: LoginFormState): LoginItemInput {
  const urls = normalizeFormUrls(form.urlsInput, '')
  const parsedCustomFields = parseCustomFields(form.customFieldsInput)
  const customFields = form.custom_fields.length > 0 ? form.custom_fields : parsedCustomFields
  return {
    // An empty template field is re-seeded on load, so it is not worth a row in the vault.
    custom_fields: pruneEmptyTemplateFields(form.item_type, customFields),
    favorite: form.favorite,
    item_type: form.item_type,
    notes: form.notes,
    password: form.password,
    tags: parseTags(form.tagsInput),
    title: form.title.trim(),
    urls,
    username: form.username.trim(),
    website: urls[0]?.url ?? '',
  }
}
