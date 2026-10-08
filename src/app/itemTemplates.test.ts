import { describe, expect, it } from 'vitest'
import { getItemTemplate, itemTemplates } from './itemTemplates'

describe('item templates', () => {
  it('keeps the login layout for categories without a template', () => {
    for (const itemType of ['login', 'passport', 'crypto_wallet', 'unknown_type']) {
      expect(getItemTemplate(itemType)).toEqual({ credentials: true, sections: [], websites: true })
    }
  })

  it('hides credentials and websites for note-like categories', () => {
    expect(getItemTemplate('secure_note').credentials).toBe(false)
    expect(getItemTemplate('secure_note').websites).toBe(false)
    expect(getItemTemplate('credit_card').credentials).toBe(false)
  })

  it('seeds each templated category with its own section', () => {
    expect(getItemTemplate('credit_card').sections[0].fields.map((field) => field.field_type)).toEqual([
      'text',
      'password',
      'month_year',
      'password',
      'password',
    ])
    expect(getItemTemplate('identity').sections).toHaveLength(1)
    expect(getItemTemplate('software_license').sections[0].fields).toHaveLength(4)
  })

  it('only references labels the locale bundles have to carry', () => {
    const labelKeys = Object.values(itemTemplates)
      .flatMap((template) => template.sections)
      .flatMap((section) => [section.titleKey, ...section.fields.map((field) => field.labelKey)])

    expect(labelKeys.every((key) => /^(itemTemplates|vault\.customFieldDefaults)\./.test(key))).toBe(true)
    expect(new Set(labelKeys).size).toBe(labelKeys.length)
  })
})
