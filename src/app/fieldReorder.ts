import { newSectionChild, parseSectionChildren, type SectionChild, stringifySectionChildren } from './itemFields'
import type { CustomField } from './vaultApi'

/**
 * Reordering the editor's fields, 1Password 8-style: a field moves within its list, and a plain field also
 * moves into and out of sections (a section itself moves among the top-level entries only). The editor shows
 * custom fields in three kinds of list, each a *container*:
 *
 * - `login` — OTP, passkey and sign-in-with fields, drawn in the credentials card (never into a section);
 * - `top` — the other top-level custom fields, sections included, in storage order;
 * - `section:<index>` — the children of the section stored at `custom_fields[index]`.
 *
 * A slot's `index` is the entry's position in its container's list. For a destination it is the position the
 * entry ends up at once it has left its old place, so "move down one" is always `index + 1`.
 */

export type Container = 'login' | 'top' | `section:${number}`
export type Slot = { container: Container; index: number }
/** The `custom_fields` indexes each top-level container shows, in order. */
export type ContainerLists = { login: readonly number[]; top: readonly number[] }

/** The types a section may hold (no nested section, attachment, related item, OTP seed or provider). */
export const sectionChildFieldTypes: readonly string[] = [
  'security_questions',
  'text',
  'multiline',
  'concealed',
  'url',
  'email',
  'address',
  'date',
  'month_year',
  'password',
  'phone',
]

export function sectionIndexOf(container: Container): number | null {
  return container.startsWith('section:') ? Number(container.slice('section:'.length)) : null
}

function childrenOf(fields: readonly CustomField[], container: Container): SectionChild[] | null {
  const index = sectionIndexOf(container)
  if (index === null) return null
  const section = fields[index]
  return section?.field_type === 'section' ? parseSectionChildren(section.value) : null
}

/** The type of whatever sits at a slot, or null when the slot is empty. */
export function slotFieldType(fields: readonly CustomField[], lists: ContainerLists, slot: Slot): string | null {
  const children = childrenOf(fields, slot.container)
  if (children) return children[slot.index]?.field_type ?? null
  const list = slot.container === 'login' ? lists.login : lists.top
  const index = list[slot.index]
  return index === undefined ? null : (fields[index]?.field_type ?? null)
}

/** Whether an entry of this type may live in that container. */
export function canEnter(fieldType: string, from: Container, to: Container): boolean {
  if (from === to) return true
  if (from === 'login' || to === 'login') return false
  if (sectionIndexOf(to) !== null) return sectionChildFieldTypes.includes(fieldType)
  return fieldType !== 'section'
}

/**
 * Moves one entry. Returns the new `custom_fields`, or null when the move is not allowed or changes nothing.
 * Template children keep their `key` across sections, so a moved template field is still recognised.
 */
export function moveFieldEntry(
  fields: readonly CustomField[],
  lists: ContainerLists,
  from: Slot,
  to: Slot,
): CustomField[] | null {
  const fieldType = slotFieldType(fields, lists, from)
  if (fieldType === null || !canEnter(fieldType, from.container, to.container)) return null
  if (from.container === to.container && from.index === to.index) return null

  // Work on fresh objects so identity survives the splices below.
  const next = fields.map((field) => ({ ...field }))
  const listOf = (container: Container) => (container === 'login' ? lists.login : lists.top).map((i) => next[i])
  const fromChildren = childrenOf(fields, from.container)
  const toSectionIndex = sectionIndexOf(to.container)
  const toSection = toSectionIndex === null ? null : next[toSectionIndex]
  if (toSectionIndex !== null && toSection?.field_type !== 'section') return null

  // Take the entry out.
  let moving: CustomField | SectionChild
  if (fromChildren) {
    const sectionIndex = sectionIndexOf(from.container) as number
    const child = fromChildren[from.index]
    if (!child) return null
    moving = child
    next[sectionIndex] = {
      ...next[sectionIndex],
      value: stringifySectionChildren(fromChildren.filter((_, index) => index !== from.index)),
    }
    // Keep the destination reference current when the section is the same object.
    if (toSectionIndex === sectionIndex) {
      const reparsed = parseSectionChildren(next[sectionIndex].value)
      reparsed.splice(Math.min(to.index, reparsed.length), 0, child)
      next[sectionIndex] = { ...next[sectionIndex], value: stringifySectionChildren(reparsed) }
      return next
    }
  } else {
    const entry = listOf(from.container)[from.index]
    if (!entry) return null
    moving = entry
  }

  // Put it in.
  if (toSectionIndex !== null) {
    const section = next[toSectionIndex]
    const children = parseSectionChildren(section.value)
    const child: SectionChild =
      'id' in moving ? moving : { ...newSectionChild(moving.field_type, moving.label), value: moving.value }
    children.splice(Math.min(to.index, children.length), 0, child)
    next[toSectionIndex] = { ...section, value: stringifySectionChildren(children) }
    if (!fromChildren) next.splice(next.indexOf(moving as CustomField), 1)
    return next
  }

  const destination = listOf(to.container).filter((entry) => entry !== moving)
  if (!fromChildren) next.splice(next.indexOf(moving as CustomField), 1)
  const field: CustomField =
    'id' in moving ? { field_type: moving.field_type, label: moving.label, value: moving.value } : moving
  const anchor = destination[to.index]
  if (anchor) next.splice(next.indexOf(anchor), 0, field)
  else {
    const last = destination[destination.length - 1]
    next.splice(last ? next.indexOf(last) + 1 : next.length, 0, field)
  }
  return next
}

/**
 * Where Alt+↑ / Alt+↓ on a handle sends an entry: one step in its list, and across a section's edge when that
 * is where the step leads — out of the top or bottom of a section, or from a loose field into the section
 * next to it. Null when there is nowhere to go.
 */
export function keyboardTarget(
  fields: readonly CustomField[],
  lists: ContainerLists,
  from: Slot,
  delta: -1 | 1,
): Slot | null {
  const fieldType = slotFieldType(fields, lists, from)
  if (fieldType === null) return null
  const sectionIndex = sectionIndexOf(from.container)
  if (sectionIndex !== null) {
    const children = childrenOf(fields, from.container) ?? []
    const target = from.index + delta
    if (target >= 0 && target < children.length) return { container: from.container, index: target }
    const position = lists.top.indexOf(sectionIndex)
    if (position < 0) return null
    return { container: 'top', index: delta < 0 ? position : position + 1 }
  }
  const list = from.container === 'login' ? lists.login : lists.top
  const neighbourIndex = list[from.index + delta]
  if (neighbourIndex === undefined) return null
  const neighbour = fields[neighbourIndex]
  if (
    from.container === 'top' &&
    fieldType !== 'section' &&
    neighbour?.field_type === 'section' &&
    sectionChildFieldTypes.includes(fieldType)
  ) {
    const length = parseSectionChildren(neighbour.value).length
    return { container: `section:${neighbourIndex}`, index: delta < 0 ? length : 0 }
  }
  return { container: from.container, index: from.index + delta }
}

/**
 * The credential card's own order (owner, 2026-10-18: "通行密钥的位置固定在密码、OTP之间"): after the username
 * and password come the sign-in method, then passkeys, then one-time passwords, whatever order they were
 * stored in. Stable within a type. None of these rows has a drag handle.
 */
export const credentialFieldOrder: readonly string[] = ['sign_in_with', 'passkey', 'otp']

export function orderCredentialFields<T extends { field: { field_type: string }; index: number }>(
  entries: readonly T[],
): T[] {
  const rank = (entry: T) => {
    const position = credentialFieldOrder.indexOf(entry.field.field_type)
    return position === -1 ? credentialFieldOrder.length : position
  }
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.index - b.index)
}
