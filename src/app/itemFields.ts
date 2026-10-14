import { detectCardBrand, parseSshPublicKey, publicKeyFromOpenSshPrivateKey, sshKeyTypeOption } from './fieldFormats'
import {
  type FieldDerivation,
  findTemplateField,
  getItemTemplate,
  optionSets,
  type TemplateField,
  type TemplateSection,
} from './itemTemplates'

/**
 * Bridges stored custom fields and the templates. The Rust vault treats `custom_fields` as one opaque JSON
 * column and a section's value as an opaque string, so everything here is a frontend-only reading of the
 * same shapes: nothing about the vault format changes, and an item saved by an older build still loads.
 */

export type StoredField = { field_type: string; label: string; value: string }

/** A child of a `section` custom field, as stored inside its JSON value. `key` names its template field. */
export type SectionChild = StoredField & { id: string; key?: string }

/** How labels reach this module without it importing i18n: the current-locale string, and the same key in
 * every supported locale (to recognise a label an older build stored already translated). */
export type LabelResolver = {
  label: (labelKey: string) => string
  variants: (labelKey: string) => string[]
}

let generatedIds = 0

function nextChildId(): string {
  generatedIds += 1
  return globalThis.crypto?.randomUUID?.() ?? `child-${Date.now()}-${generatedIds}`
}

export function templateChildId(key: string): string {
  return `tpl-${key}`
}

export function parseSectionChildren(value: string): SectionChild[] {
  if (!value.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((child): child is Record<string, unknown> => typeof child === 'object' && child !== null)
      .map((child, index) => {
        const key = typeof child.key === 'string' && child.key ? child.key : undefined
        return {
          field_type: typeof child.field_type === 'string' ? child.field_type : 'text',
          // Older children were written without an id; a stable fallback keeps React keys from churning.
          id: typeof child.id === 'string' && child.id ? child.id : key ? templateChildId(key) : `legacy-${index}`,
          ...(key ? { key } : {}),
          label: typeof child.label === 'string' ? child.label : '',
          value: typeof child.value === 'string' ? child.value : '',
        }
      })
      .filter((child) => child.label || child.value || child.key)
  } catch {
    return []
  }
}

export function stringifySectionChildren(children: SectionChild[]): string {
  return JSON.stringify(
    children.map((child) => ({
      field_type: child.field_type,
      id: child.id || nextChildId(),
      ...(child.key ? { key: child.key } : {}),
      label: child.label,
      value: child.value,
    })),
  )
}

export function newSectionChild(fieldType: string, label: string): SectionChild {
  return { field_type: fieldType, id: nextChildId(), label, value: '' }
}

function normalizeLabel(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function matchesLabel(label: string, labelKey: string, labels: LabelResolver): boolean {
  const normalized = normalizeLabel(label)
  return labels.variants(labelKey).some((variant) => normalizeLabel(variant) === normalized)
}

function templateChild(field: TemplateField, labels: LabelResolver): SectionChild {
  return {
    field_type: field.field_type,
    id: templateChildId(field.key),
    key: field.key,
    label: labels.label(field.labelKey),
    value: '',
  }
}

/** The label a child should read with: the template's, in the current language, unless the user renamed it. */
export function childDisplayLabel(itemType: string, child: SectionChild, labels: LabelResolver): string {
  const field = findTemplateField(itemType, child.key)
  if (field && (!child.label.trim() || matchesLabel(child.label, field.labelKey, labels))) {
    return labels.label(field.labelKey)
  }
  return child.label
}

/** Same rule for a section's title, matched against the template section that owns the section's children. */
export function sectionDisplayTitle(itemType: string, field: StoredField, labels: LabelResolver): string {
  const owner = owningTemplateSection(itemType, field, labels)
  if (owner && (!field.label.trim() || matchesLabel(field.label, owner.titleKey, labels))) {
    return labels.label(owner.titleKey)
  }
  return field.label
}

function owningTemplateSection(
  itemType: string,
  field: StoredField,
  labels: LabelResolver,
): TemplateSection | undefined {
  const sections = getItemTemplate(itemType).sections
  const keys = new Set(parseSectionChildren(field.value).flatMap((child) => (child.key ? [child.key] : [])))
  return (
    sections.find((section) => section.fields.some((templateField) => keys.has(templateField.key))) ??
    sections.find((section) => matchesLabel(field.label, section.titleKey, labels))
  )
}

/**
 * Brings stored fields up to the item type's current template, on load:
 *
 * 1. A child with a template `key` takes the template's current type (so a card number saved as a plain
 *    password by an older build becomes a card number field).
 * 2. A child without a key whose label is a template label in any locale is recognised as that field and
 *    gets its key — this is how items saved before keys existed are migrated, without a vault change.
 * 3. Template fields the item does not have yet are seeded empty, inside the section that already holds
 *    their siblings, or in a new section placed after the previous template section.
 *
 * Everything else — custom fields, renamed labels, user-added children, field order — is left alone.
 */
export function normalizeTemplateFields<T extends StoredField>(
  itemType: string,
  fields: readonly T[],
  labels: LabelResolver,
): StoredField[] {
  const template = getItemTemplate(itemType)
  if (!template.sections.length) return [...fields]
  const allTemplateFields = template.sections.flatMap((section) => section.fields)
  const claimed = new Set<string>()

  const parsed = fields.map((field) =>
    field.field_type === 'section' ? { children: parseSectionChildren(field.value), field } : { children: null, field },
  )

  for (const entry of parsed) {
    if (!entry.children) continue
    entry.children = entry.children.map((child) => {
      const known = child.key ? allTemplateFields.find((field) => field.key === child.key) : undefined
      if (known) {
        claimed.add(known.key)
        return { ...child, field_type: known.field_type }
      }
      if (child.key) return child
      const match = allTemplateFields.find(
        (field) => !claimed.has(field.key) && matchesLabel(child.label, field.labelKey, labels),
      )
      if (!match) return child
      claimed.add(match.key)
      return { ...child, field_type: match.field_type, key: match.key }
    })
  }

  // Which stored section each template section lives in: the one holding its keyed children, else an
  // unowned section carrying its title.
  const owners = new Map<string, number>()
  for (const section of template.sections) {
    const keys = new Set(section.fields.map((field) => field.key))
    let owner = parsed.findIndex((entry) => entry.children?.some((child) => child.key && keys.has(child.key)))
    if (owner < 0) {
      owner = parsed.findIndex(
        (entry, index) =>
          entry.children !== null &&
          ![...owners.values()].includes(index) &&
          matchesLabel(entry.field.label, section.titleKey, labels),
      )
    }
    if (owner >= 0) owners.set(section.key, owner)
  }

  const created = new Map<number, StoredField[]>()
  let previousOwner = -1
  for (const section of template.sections) {
    const missing = section.fields.filter((field) => !claimed.has(field.key))
    const owner = owners.get(section.key)
    if (owner !== undefined) {
      const entry = parsed[owner]
      const children = entry.children ?? []
      for (const field of missing) {
        // Land after the nearest earlier sibling from the same template section, or first in the section.
        const order = section.fields.findIndex((candidate) => candidate.key === field.key)
        const earlierKeys = new Set(section.fields.slice(0, order).map((candidate) => candidate.key))
        let insertAt = 0
        children.forEach((child, index) => {
          if (child.key && earlierKeys.has(child.key)) insertAt = index + 1
        })
        children.splice(insertAt, 0, templateChild(field, labels))
      }
      entry.children = children
      previousOwner = owner
      continue
    }
    if (!missing.length) continue
    const fresh: StoredField = {
      field_type: 'section',
      label: labels.label(section.titleKey),
      value: stringifySectionChildren(missing.map((field) => templateChild(field, labels))),
    }
    created.set(previousOwner, [...(created.get(previousOwner) ?? []), fresh])
  }

  const result: StoredField[] = [...(created.get(-1) ?? [])]
  parsed.forEach((entry, index) => {
    result.push(
      entry.children ? { ...entry.field, value: stringifySectionChildren(entry.children) } : { ...entry.field },
    )
    result.push(...(created.get(index) ?? []))
  })
  return result
}

/**
 * The save-side mirror of `normalizeTemplateFields`: an empty template child is not stored (it comes back
 * on the next load), and a section left holding nothing but empty template children goes with them.
 */
export function pruneEmptyTemplateFields<T extends StoredField>(itemType: string, fields: readonly T[]): StoredField[] {
  return fields.flatMap((field) => {
    if (field.field_type !== 'section') return [field]
    const children = parseSectionChildren(field.value)
    const kept = children.filter((child) => !(findTemplateField(itemType, child.key) && !child.value.trim()))
    if (children.length && !kept.length && children.every((child) => findTemplateField(itemType, child.key))) {
      return []
    }
    return [{ ...field, value: stringifySectionChildren(kept) }]
  })
}

/** A comparison form that ignores child ids and the empty template children save would drop anyway. */
export function comparableFields(itemType: string, fields: readonly StoredField[]): unknown[] {
  return pruneEmptyTemplateFields(itemType, fields).map((field) =>
    field.field_type === 'section'
      ? [
          field.field_type,
          field.label,
          parseSectionChildren(field.value).map((child) => [
            child.field_type,
            child.key ?? '',
            child.label,
            child.value,
          ]),
        ]
      : [field.field_type, field.label, field.value],
  )
}

function derive(derivation: FieldDerivation, value: string): string | null {
  if (derivation === 'cardBrand') {
    const brand = detectCardBrand(value)
    return brand && (optionSets.cardBrand as readonly string[]).includes(brand) ? brand : null
  }
  if (derivation === 'sshKeyType') {
    const parsed = parseSshPublicKey(value)
    return parsed ? sshKeyTypeOption(parsed.keyType) : null
  }
  return publicKeyFromOpenSshPrivateKey(value)
}

/**
 * After a child changes, fills the siblings its template field derives (`fills`), then lets each filled
 * sibling do the same once more — a pasted private key fills the public key, which fills the type. A
 * sibling is only written while it is empty or still holds what the previous value derived, so a choice
 * the user made by hand is never overwritten, but a corrected card number corrects its network.
 */
export function applyDerivedValues(
  itemType: string,
  previous: SectionChild[],
  children: SectionChild[],
  changedId: string,
): SectionChild[] {
  let next = children
  const queue = [changedId]
  for (let hops = 0; hops < 3 && queue.length; hops += 1) {
    const sourceId = queue.shift() as string
    const source = next.find((child) => child.id === sourceId)
    const before = previous.find((child) => child.id === sourceId)
    const rules = findTemplateField(itemType, source?.key)?.fills
    if (!source || !rules) continue
    for (const rule of rules) {
      const target = next.find((child) => child.key === rule.key)
      if (!target) continue
      const previouslyDerived = before ? derive(rule.derive, before.value) : null
      if (target.value.trim() && target.value !== previouslyDerived) continue
      const value = derive(rule.derive, source.value) ?? ''
      if (value === target.value) continue
      next = next.map((child) => (child.id === target.id ? { ...child, value } : child))
      queue.push(target.id)
    }
  }
  return next
}
