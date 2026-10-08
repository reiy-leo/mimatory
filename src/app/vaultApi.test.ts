import { describe, expect, it } from 'vitest'
import { customFieldsToInput, emptyLoginItem, parseCustomFields, parseTags, tagsToInput } from './vaultApi'

describe('vault form helpers', () => {
  it('normalizes comma separated tags', () => {
    expect(parseTags(' personal, code,, github ')).toEqual(['personal', 'code', 'github'])
  })

  it('formats tags for editing', () => {
    expect(tagsToInput(['personal', 'code'])).toBe('personal, code')
  })

  it('creates an empty login item with favorite disabled', () => {
    expect(emptyLoginItem()).toMatchObject({
      favorite: false,
      item_type: 'login',
      notes: '',
      password: '',
      tags: [],
      title: '',
      username: '',
      website: '',
    })
  })

  it('parses custom fields from label-value lines', () => {
    expect(parseCustomFields('number: 4111\nexpiry: 12/30')).toEqual([
      { field_type: 'text', label: 'number', value: '4111' },
      { field_type: 'text', label: 'expiry', value: '12/30' },
    ])
    expect(customFieldsToInput([{ field_type: 'secret', label: 'pin', value: '1234' }])).toBe('pin: 1234')
  })
})
