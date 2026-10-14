import { describe, expect, it } from 'vitest'
import {
  applyDerivedValues,
  childDisplayLabel,
  comparableFields,
  type LabelResolver,
  normalizeTemplateFields,
  parseSectionChildren,
  pruneEmptyTemplateFields,
  type SectionChild,
  type StoredField,
  sectionDisplayTitle,
  stringifySectionChildren,
} from './itemFields'
import { getItemTemplate } from './itemTemplates'

/* Two fake locales are enough to prove a label saved in either one is recognised. */
const english: Record<string, string> = {
  'itemTemplates.creditCard.cardDetails': 'Card Details',
  'itemTemplates.creditCard.cardholder': 'Cardholder name',
  'itemTemplates.creditCard.cardNumber': 'Card number',
  'itemTemplates.creditCard.expiryDate': 'Expiration date',
  'itemTemplates.creditCard.pin': 'PIN',
  'itemTemplates.creditCard.securityCode': 'Security code',
}
const chinese: Record<string, string> = {
  'itemTemplates.creditCard.cardDetails': '卡片信息',
  'itemTemplates.creditCard.cardNumber': '卡号',
}
const labels: LabelResolver = {
  label: (key) => english[key] ?? key,
  variants: (key) => [english[key] ?? key, chinese[key] ?? key],
}

function section(label: string, children: Array<Partial<SectionChild>>): StoredField {
  return {
    field_type: 'section',
    label,
    value: JSON.stringify(
      children.map((child, index) => ({ field_type: 'text', id: `c${index}`, label: '', value: '', ...child })),
    ),
  }
}

function childrenOf(fields: StoredField[], index = 0) {
  return parseSectionChildren(fields[index].value)
}

describe('template normalisation', () => {
  it('seeds a new item with every template field, keyed, empty', () => {
    const fields = normalizeTemplateFields('credit_card', [], labels)
    const template = getItemTemplate('credit_card')
    expect(fields.map((field) => field.field_type)).toEqual(template.sections.map(() => 'section'))
    expect(childrenOf(fields).map((child) => child.key)).toEqual(template.sections[0].fields.map((field) => field.key))
    expect(childrenOf(fields).every((child) => child.value === '')).toBe(true)
    expect(childrenOf(fields).find((child) => child.key === 'number')?.field_type).toBe('card_number')
  })

  it('migrates a card saved before keys existed, in either language, and upgrades its types', () => {
    const legacy = [
      section('卡片信息', [
        { field_type: 'text', label: 'Cardholder name', value: 'REI LEO' },
        { field_type: 'password', label: '卡号', value: '4242 4242 4242 4242' },
        { field_type: 'password', label: 'security code', value: '123' },
        { field_type: 'text', label: 'Loyalty number', value: 'A-1' },
      ]),
      { field_type: 'text', label: 'Note', value: 'kept' },
    ]
    const fields = normalizeTemplateFields('credit_card', legacy, labels)
    const children = childrenOf(fields)
    expect(children.find((child) => child.value === '4242 4242 4242 4242')).toMatchObject({
      field_type: 'card_number',
      key: 'number',
      label: '卡号',
    })
    expect(children.find((child) => child.value === '123')).toMatchObject({ field_type: 'concealed', key: 'cvv' })
    // A user's own child keeps no key and stays where it was, after the template children around it.
    expect(children.find((child) => child.label === 'Loyalty number')?.key).toBeUndefined()
    expect(children.map((child) => child.key ?? child.label).slice(0, 3)).toEqual(['cardholder', 'brand', 'number'])
    // The issuer section did not exist, so it is created right after the card section; the custom field stays.
    expect(fields).toHaveLength(3)
    expect(fields[1].label).toBe('itemTemplates.sections.issuer')
    expect(fields[2]).toEqual({ field_type: 'text', label: 'Note', value: 'kept' })
  })

  it('leaves types without sections untouched', () => {
    const fields = [{ field_type: 'otp', label: 'One-time password', value: 'JBSWY3DPEHPK3PXP' }]
    expect(normalizeTemplateFields('login', fields, labels)).toEqual(fields)
  })

  it('is stable: normalising twice changes nothing', () => {
    const once = normalizeTemplateFields('credit_card', [], labels)
    expect(normalizeTemplateFields('credit_card', once, labels)).toEqual(once)
  })

  it('reads the template label in the current language unless the user renamed it', () => {
    const [cardNumber] = childrenOf([section('x', [{ key: 'number', label: '卡号' }])])
    expect(childDisplayLabel('credit_card', cardNumber, labels)).toBe('Card number')
    const [renamed] = childrenOf([section('x', [{ key: 'number', label: 'Work card' }])])
    expect(childDisplayLabel('credit_card', renamed, labels)).toBe('Work card')
    expect(sectionDisplayTitle('credit_card', section('卡片信息', [{ key: 'number' }]), labels)).toBe('Card Details')
  })
})

describe('saving and comparing', () => {
  it('drops empty template children and sections left empty, keeps everything typed', () => {
    const seeded = normalizeTemplateFields('credit_card', [], labels)
    expect(pruneEmptyTemplateFields('credit_card', seeded)).toEqual([])
    const children = childrenOf(seeded).map((child) => (child.key === 'number' ? { ...child, value: '4242' } : child))
    const custom = { field_type: 'text', id: 'mine', label: 'Mine', value: '' }
    const pruned = pruneEmptyTemplateFields('credit_card', [
      { ...seeded[0], value: stringifySectionChildren([...children, custom]) },
      seeded[1],
    ])
    expect(pruned).toHaveLength(1)
    expect(childrenOf(pruned).map((child) => child.key ?? child.label)).toEqual(['number', 'Mine'])
  })

  it('compares without child ids or empty template fields', () => {
    const a = normalizeTemplateFields('credit_card', [], labels)
    const reIded = a.map((field) => ({
      ...field,
      value: stringifySectionChildren(
        parseSectionChildren(field.value).map((child, index) => ({ ...child, id: `x${index}` })),
      ),
    }))
    expect(comparableFields('credit_card', reIded)).toEqual(comparableFields('credit_card', a))
    expect(comparableFields('credit_card', a)).toEqual([])
  })
})

describe('derived values', () => {
  const card = (number: string, brand: string): SectionChild[] => [
    { field_type: 'select', id: 'b', key: 'brand', label: 'Card type', value: brand },
    { field_type: 'card_number', id: 'n', key: 'number', label: 'Card number', value: number },
  ]

  it('fills the card network from the number and corrects it with the number', () => {
    expect(applyDerivedValues('credit_card', card('', ''), card('4', ''), 'n')[0].value).toBe('visa')
    expect(applyDerivedValues('credit_card', card('4', 'visa'), card('', 'visa'), 'n')[0].value).toBe('')
    expect(applyDerivedValues('credit_card', card('4', 'visa'), card('37', 'visa'), 'n')[0].value).toBe('amex')
  })

  it('never overwrites a network the user picked', () => {
    expect(applyDerivedValues('credit_card', card('4', 'other'), card('42', 'other'), 'n')[0].value).toBe('other')
  })

  it('fills the SSH key type from a pasted public key', () => {
    const before: SectionChild[] = [
      { field_type: 'multiline', id: 'p', key: 'publicKey', label: 'Public key', value: '' },
      { field_type: 'select', id: 't', key: 'keyType', label: 'Key type', value: '' },
    ]
    const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGUROBHbTQxZVCTUfsYzpzhL2rZTKazqH9Gu7acE/Wen x'
    const after = applyDerivedValues('ssh_key', before, [{ ...before[0], value: key }, before[1]], 'p')
    expect(after[1].value).toBe('ed25519')
  })
})
