import { describe, expect, it } from 'vitest'
import { emailHref, fieldActions, fieldPlainValue, openAndFillUrl, phoneHref } from './fieldActions'

describe('field actions', () => {
  it('makes an item website Open & Fill on desktop, with Open, Copy and Large Type behind the chevron', () => {
    expect(fieldActions({ canFill: true, fieldType: 'url', value: 'https://github.com/login', website: true })).toEqual(
      {
        menu: ['openAndFill', 'open', 'copy', 'largeType'],
        primary: 'openAndFill',
      },
    )
  })

  it('only opens a website where nothing can fill it, and a URL kept in a section', () => {
    expect(fieldActions({ fieldType: 'url', value: 'github.com', website: true }).primary).toBe('open')
    expect(fieldActions({ canFill: true, fieldType: 'url', value: 'https://docs.example.com' })).toEqual({
      menu: ['open', 'copy', 'largeType'],
      primary: 'open',
    })
  })

  it('copies a URL that cannot be opened', () => {
    expect(fieldActions({ fieldType: 'url', value: 'not a url', website: true }).primary).toBe('copy')
  })

  it('copies a secret and offers Reveal or Conceal by its current state', () => {
    expect(fieldActions({ fieldType: 'password', value: 'hunter2' })).toEqual({
      menu: ['copy', 'reveal', 'largeType'],
      primary: 'copy',
    })
    expect(fieldActions({ fieldType: 'card_number', revealed: true, value: '4242 4242 4242 4242' }).menu).toEqual([
      'copy',
      'conceal',
      'largeType',
    ])
  })

  it('adds Send Email and Call for valid addresses and numbers only', () => {
    expect(fieldActions({ fieldType: 'email', value: 'rei@example.com' }).menu).toEqual([
      'copy',
      'sendEmail',
      'largeType',
    ])
    expect(fieldActions({ fieldType: 'email', value: 'rei@' }).menu).toEqual(['copy', 'largeType'])
    expect(fieldActions({ fieldType: 'phone', value: '+65 8123 4567' }).menu).toEqual(['copy', 'call', 'largeType'])
  })

  it('leaves Large Type out for multi-line values and offers nothing for an empty one', () => {
    expect(fieldActions({ fieldType: 'concealed_multiline', value: 'a\nb' }).menu).toEqual(['copy', 'reveal'])
    expect(fieldActions({ fieldType: 'text', value: '  ' })).toEqual({ menu: [], primary: null })
  })

  it('copies card numbers without grouping', () => {
    expect(fieldPlainValue('card_number', '4242 4242 4242 4242')).toBe('4242424242424242')
    expect(fieldPlainValue('text', 'a b')).toBe('a b')
  })

  it('builds mailto and tel links', () => {
    expect(emailHref(' rei@example.com ')).toBe('mailto:rei@example.com')
    expect(phoneHref('+65 (8123) 4567')).toBe('tel:+6581234567')
    expect(phoneHref('12')).toBeNull()
  })

  it('carries the item id in the fragment for Open & Fill, never over an existing fragment', () => {
    expect(openAndFillUrl('github.com/login', 'item 1')).toBe('https://github.com/login#passless-fill=item%201')
    expect(openAndFillUrl('https://app.example.com/#/login', 'id')).toBe('https://app.example.com/#/login')
    expect(openAndFillUrl('javascript:alert(1)', 'id')).toBeNull()
  })
})
