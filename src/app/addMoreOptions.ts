import {
  AlignLeft,
  Calendar,
  CalendarRange,
  CornerDownRight,
  CornerLeftUp,
  EyeOff,
  Group,
  KeyRound,
  Link,
  Link2,
  LogIn,
  type LucideIcon,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  ShieldQuestion,
  Timer,
  Type,
} from 'lucide-react'
import { sectionChildFieldTypes } from './fieldReorder'
import type { RelationKind } from './itemRelations'

/**
 * The one "Add More" list (owner 2026-10-18: the section's 添加更多 is the same control as the item's). The
 * item's bar offers every field type plus the links to other items; a section offers the same rows minus
 * what a section cannot hold. Passkeys are in neither: a passkey is never typed in, it is saved from the
 * browser extension's prompt when a website registers one (owner, 2026-10-18).
 */

export type AddMoreContext = 'item' | 'section'

export type AddMoreFieldType =
  | 'address'
  | 'concealed'
  | 'date'
  | 'email'
  | 'file'
  | 'month_year'
  | 'multiline'
  | 'otp'
  | 'password'
  | 'phone'
  | 'section'
  | 'security_questions'
  | 'sign_in_with'
  | 'text'
  | 'url'

type EntryBase = {
  descriptionKey?: string
  icon: LucideIcon
  labelKey: string
  /** Draws a separator above the row (a new group starts there). */
  separated?: boolean
}

export type AddMoreEntry =
  | (EntryBase & { id: AddMoreFieldType; kind: 'field' })
  | (EntryBase & { id: RelationKind; kind: 'relation' })

const fieldEntries: ReadonlyArray<EntryBase & { id: AddMoreFieldType; kind: 'field' }> = [
  {
    descriptionKey: 'vault.addMoreOptions.securityQuestionsDescription',
    icon: ShieldQuestion,
    id: 'security_questions',
    kind: 'field',
    labelKey: 'vault.addMoreOptions.securityQuestions',
  },
  { icon: Type, id: 'text', kind: 'field', labelKey: 'vault.addMoreOptions.text' },
  { icon: AlignLeft, id: 'multiline', kind: 'field', labelKey: 'vault.addMoreOptions.multiline' },
  { icon: EyeOff, id: 'concealed', kind: 'field', labelKey: 'vault.addMoreOptions.concealed' },
  { icon: Link, id: 'url', kind: 'field', labelKey: 'vault.addMoreOptions.url' },
  { icon: Mail, id: 'email', kind: 'field', labelKey: 'vault.addMoreOptions.email' },
  { icon: MapPin, id: 'address', kind: 'field', labelKey: 'vault.addMoreOptions.address' },
  { icon: Calendar, id: 'date', kind: 'field', labelKey: 'vault.addMoreOptions.date' },
  { icon: CalendarRange, id: 'month_year', kind: 'field', labelKey: 'vault.addMoreOptions.monthYear' },
  { icon: Timer, id: 'otp', kind: 'field', labelKey: 'vault.addMoreOptions.oneTimePassword' },
  { icon: KeyRound, id: 'password', kind: 'field', labelKey: 'vault.addMoreOptions.password' },
  { icon: Phone, id: 'phone', kind: 'field', labelKey: 'vault.addMoreOptions.phone' },
  { icon: LogIn, id: 'sign_in_with', kind: 'field', labelKey: 'vault.addMoreOptions.signInWith' },
  { icon: Group, id: 'section', kind: 'field', labelKey: 'vault.addMoreOptions.section', separated: true },
  { icon: Paperclip, id: 'file', kind: 'field', labelKey: 'vault.addMoreOptions.attachFile', separated: true },
]

// Links to other items close the menu in their own group. They are not fields: each opens the item picker.
const relationEntries: ReadonlyArray<EntryBase & { id: RelationKind; kind: 'relation' }> = [
  { icon: CornerLeftUp, id: 'parent', kind: 'relation', labelKey: 'vault.relations.addParent', separated: true },
  { icon: CornerDownRight, id: 'child', kind: 'relation', labelKey: 'vault.relations.addChild' },
  { icon: Link2, id: 'related', kind: 'relation', labelKey: 'vault.relations.addRelated' },
]

/** What a section's menu leaves out by name (owner, 2026-10-18). */
export const sectionExcludedEntries: readonly string[] = [
  'sign_in_with',
  'otp',
  'section',
  'parent',
  'child',
  'related',
]

/** Types no menu offers: a passkey only arrives from the browser extension's save prompt. */
export const neverAddedByHand: readonly string[] = ['passkey']

export function addMoreEntries(context: AddMoreContext, options: { attachments: boolean }): AddMoreEntry[] {
  const fields = fieldEntries.filter((entry) => entry.id !== 'file' || options.attachments)
  if (context === 'item') return [...fields, ...relationEntries]
  // A section is a JSON list of plain fields: beyond the named exclusions it cannot hold an attachment either.
  return fields
    .filter((entry) => !sectionExcludedEntries.includes(entry.id) && sectionChildFieldTypes.includes(entry.id))
    .map((entry) => ({ ...entry, separated: false }))
}
