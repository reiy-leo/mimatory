import { describe, expect, it } from 'vitest'
import {
  itemSignInProvider,
  parseSignInProvider,
  providerOfAccount,
  signInAccountCandidates,
  signInProviderValue,
  withoutSignInField,
  withSignInField,
} from './signInProviders'
import type { LoginItem } from './vaultApi'

function item(id: string, patch: Partial<LoginItem> = {}): LoginItem {
  return {
    custom_fields: [],
    favorite: false,
    id,
    item_type: 'login',
    notes: '',
    password: '',
    tags: [],
    title: id,
    updated_at: '',
    urls: [],
    username: '',
    website: '',
    ...patch,
  }
}

describe('sign in with providers', () => {
  it('reads a known id, a typed name, nothing, and an unmigrated item id', () => {
    expect(parseSignInProvider('google')).toEqual({ id: 'google', name: 'Google' })
    expect(parseSignInProvider(' GitHub ')).toEqual({ id: 'github', name: 'GitHub' })
    expect(parseSignInProvider('Okta')).toEqual({ id: 'other', name: 'Okta' })
    expect(parseSignInProvider('  ')).toBeNull()
    expect(parseSignInProvider('8d2f3c1e-9a4b-4c5d-8e6f-0a1b2c3d4e5f')).toEqual({ id: 'other', name: '' })
    expect(signInProviderValue({ id: 'apple', name: 'Apple' })).toBe('apple')
    expect(signInProviderValue({ id: 'other', name: ' Okta ' })).toBe('Okta')
  })

  it('keeps one sign-in field per item', () => {
    const text = { field_type: 'text', label: 'PIN', value: '1' }
    const once = withSignInField([text], { id: 'google', name: 'Google' })
    expect(once).toEqual([text, { field_type: 'sign_in_with', label: '', value: 'google' }])
    const twice = withSignInField(once, { id: 'other', name: 'Okta' })
    expect(twice).toEqual([text, { field_type: 'sign_in_with', label: '', value: 'Okta' }])
    expect(itemSignInProvider({ custom_fields: twice })).toEqual({ id: 'other', name: 'Okta' })
    expect(withoutSignInField(twice)).toEqual([text])
  })

  it('recognises a provider account by its address, then its title', () => {
    expect(providerOfAccount(item('Work', { website: 'https://accounts.google.com/' }))).toBe('google')
    expect(providerOfAccount(item('Mail', { urls: [{ label: '', match_type: 'domain', url: 'outlook.com' }] }))).toBe(
      'microsoft',
    )
    expect(providerOfAccount(item('My GitHub'))).toBe('github')
    // "x" is too short to find in a title.
    expect(providerOfAccount(item('Xbox'))).toBeNull()
  })

  it('offers the provider’s own accounts first and never the item itself', () => {
    const items = [
      item('self'),
      item('Bank'),
      item('Google', { username: 'rei@gmail.com', website: 'google.com' }),
      item('Apple ID', { website: 'appleid.apple.com' }),
    ]
    const google = { id: 'google' as const, name: 'Google' }
    expect(signInAccountCandidates(items, 'self', google, '').map((entry) => entry.id)).toEqual([
      'Google',
      'Apple ID',
      'Bank',
    ])
    expect(signInAccountCandidates(items, 'self', google, 'rei@').map((entry) => entry.id)).toEqual(['Google'])
  })
})
