import { digitsOnly, isConcealedType, openableUrl } from './fieldFormats'
import { canShowLargeType } from './largeType'

/**
 * What a read-only field offers, decided by its type alone (1Password 8's item details, see
 * work/field-audit.md): selecting the value runs its *primary* action — copy for almost everything, Open & Fill
 * for an item's website — and the trailing chevron lists the rest. The view draws whatever this returns, so a
 * new behaviour is a rule here, never a branch in a component.
 */

export type FieldActionId =
  | 'call'
  | 'conceal'
  | 'copy'
  | 'copySecret'
  | 'copySetupLink'
  | 'largeType'
  | 'open'
  | 'openAndFill'
  | 'reveal'
  | 'sendEmail'

export type FieldActionInput = {
  /** The item's own login website (Open & Fill applies), as opposed to a URL field inside a section. */
  website?: boolean
  /** Whether Open & Fill can hand the page to the browser extension (desktop only). */
  canFill?: boolean
  fieldType: string
  /** The secret is currently shown, so the menu offers to hide it again. */
  revealed?: boolean
  value: string
}

export type FieldActionSet = { menu: FieldActionId[]; primary: FieldActionId | null }

const secretTypes = (fieldType: string) => isConcealedType(fieldType) || fieldType === 'card_number'

/** The text Copy and Show in Large Type use: card numbers lose their grouping spaces, everything else is as stored. */
export function fieldPlainValue(fieldType: string, value: string): string {
  return fieldType === 'card_number' ? digitsOnly(value) : value
}

export function fieldActions({
  canFill = false,
  fieldType,
  revealed = false,
  value,
  website = false,
}: FieldActionInput) {
  if (!value.trim()) return { menu: [], primary: null } satisfies FieldActionSet
  const largeType = canShowLargeType(fieldPlainValue(fieldType, value)) ? (['largeType'] as const) : []

  if (fieldType === 'url' && openableUrl(value)) {
    // Selecting an item's website opens it and fills the login (1Password: "click on the website address to
    // Open & Fill"); a URL kept in a section is a reference, so it only opens.
    const fill = website && canFill
    return {
      menu: [...(fill ? (['openAndFill'] as const) : []), 'open', 'copy', ...largeType],
      primary: fill ? 'openAndFill' : 'open',
    } satisfies FieldActionSet
  }
  if (secretTypes(fieldType)) {
    return { menu: ['copy', revealed ? 'conceal' : 'reveal', ...largeType], primary: 'copy' } satisfies FieldActionSet
  }
  if (fieldType === 'email' && emailHref(value)) {
    return { menu: ['copy', 'sendEmail', ...largeType], primary: 'copy' } satisfies FieldActionSet
  }
  if (fieldType === 'phone' && phoneHref(value)) {
    return { menu: ['copy', 'call', ...largeType], primary: 'copy' } satisfies FieldActionSet
  }
  return { menu: ['copy', ...largeType], primary: 'copy' } satisfies FieldActionSet
}

/** `mailto:` for a single plausible address, else nothing (a typo should not open a blank draft). */
export function emailHref(value: string): string | null {
  const address = value.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? `mailto:${address}` : null
}

/** `tel:` with the dialable characters only; needs at least three digits to be worth dialling. */
export function phoneHref(value: string): string | null {
  const dialable = value.trim().replace(/[^\d+*#,;]/g, '')
  return digitsOnly(dialable).length >= 3 ? `tel:${dialable}` : null
}

/** The fragment the browser extension looks for on load (content.js `pendingFillItemId`). */
export const openAndFillMarker = 'mimatory-fill'

/**
 * Open & Fill without a channel into the browser: the URL carries the item id in its *fragment* (never sent to
 * the server, unlike 1Password's query parameter that some sites reject), the extension's content script reads
 * it on the page, removes it from the address bar and fills that one item through the bridge's ordinary
 * origin-scoped `/fill`. A URL that already has a fragment (a hash-routed app) opens unchanged — appending would
 * change the route — and the user fills from the extension as usual.
 */
export function openAndFillUrl(value: string, itemId: string): string | null {
  const url = openableUrl(value)
  if (!url) return null
  if (new URL(url).hash || url.endsWith('#') || !itemId) return url
  return `${url}#${openAndFillMarker}=${encodeURIComponent(itemId)}`
}
