import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { valueFieldTypes } from './fieldFormats'
import i18n, { supportedLanguages } from './i18n'
import {
  findTemplateField,
  getItemTemplate,
  itemTemplates,
  optionLabelKey,
  optionSets,
  sshFingerprintLabelKey,
} from './itemTemplates'

function hasKey(language: string, key: string) {
  return i18n.exists(key, { fallbackLng: [], lng: language })
}

/* The sidebar's category table lives in vaultModel.ts; every category in it is expected to have a template. */
const categoryTypes = [
  ...readFileSync('src/app/vaultModel.ts', 'utf8').matchAll(/icon: \w+, itemType: '([a-z_]+)' \}/g),
].map((match) => match[1])

describe('item templates', () => {
  it('gives every sidebar category its own template', () => {
    expect(categoryTypes.length).toBeGreaterThan(10)
    expect(categoryTypes.filter((type) => !itemTemplates[type])).toEqual([])
  })

  it('keeps the login layout for unknown types', () => {
    expect(getItemTemplate('unknown_type')).toBe(itemTemplates.login)
    expect(itemTemplates.login.credentials?.username).toBe(true)
    expect(itemTemplates.login.otp).toBe(true)
    expect(itemTemplates.login.websites).toBe(true)
  })

  it('shapes the credential columns per category', () => {
    expect(getItemTemplate('secure_note').credentials).toBeNull()
    expect(getItemTemplate('credit_card').credentials).toBeNull()
    expect(getItemTemplate('password').credentials?.username).toBe(false)
    expect(getItemTemplate('wifi').credentials?.usernameLabelKey).toBe('itemTemplates.fields.networkName')
  })

  it('types the fields that need more than text', () => {
    const type = (itemType: string, key: string) => findTemplateField(itemType, key)?.field_type
    expect(type('credit_card', 'number')).toBe('card_number')
    expect(type('credit_card', 'expiry')).toBe('month_year')
    expect(type('credit_card', 'cvv')).toBe('concealed')
    expect(type('credit_card', 'brand')).toBe('select')
    expect(type('identity', 'birthDate')).toBe('date')
    expect(type('ssh_key', 'privateKey')).toBe('concealed_multiline')
    expect(type('bank_account', 'accountNumber')).toBe('concealed')
    expect(type('passport', 'expiryDate')).toBe('date')
    expect(findTemplateField('passport', 'expiryDate')?.expiry).toBe(true)
    expect(findTemplateField('credit_card', 'expiry')?.expiry).toBe(true)
  })

  it('uses only known types, unique keys and real option sets', () => {
    for (const [itemType, template] of Object.entries(itemTemplates)) {
      const keys = template.sections.flatMap((section) => section.fields.map((field) => field.key))
      expect(new Set(keys).size, itemType).toBe(keys.length)
      const sectionKeys = template.sections.map((section) => section.key)
      expect(new Set(sectionKeys).size, itemType).toBe(sectionKeys.length)
      for (const field of template.sections.flatMap((section) => section.fields)) {
        expect(valueFieldTypes).toContain(field.field_type)
        expect(field.field_type === 'select', `${itemType}.${field.key}`).toBe(Boolean(field.options))
        for (const fill of field.fills ?? []) expect(keys).toContain(fill.key)
      }
    }
  })

  it('translates every label, title and option in all three languages', () => {
    const keys = new Set<string>([sshFingerprintLabelKey])
    for (const template of Object.values(itemTemplates)) {
      if (template.credentials) {
        keys.add(template.credentials.usernameLabelKey)
        keys.add(template.credentials.passwordLabelKey)
      }
      for (const section of template.sections) {
        keys.add(section.titleKey)
        for (const field of section.fields) keys.add(field.labelKey)
      }
    }
    for (const [set, options] of Object.entries(optionSets)) {
      for (const option of options) keys.add(optionLabelKey(set as keyof typeof optionSets, option))
    }
    for (const fieldType of valueFieldTypes) keys.add(`vault.customFieldDefaults.${fieldType}`)
    const missing = [...keys].filter((key) => !supportedLanguages.every((language) => hasKey(language, key)))
    expect(missing).toEqual([])
  })

  it('translates every validation hint', () => {
    const hints = ['cardChecksum', 'cardLength', 'cvv', 'date', 'digits', 'email', 'iban', 'monthYear', 'phone']
    hints.push('sshPublicKey', 'swift', 'url')
    const missing = hints.filter(
      (hint) => !supportedLanguages.every((language) => hasKey(language, `fieldHints.${hint}`)),
    )
    expect(missing).toEqual([])
  })
})
