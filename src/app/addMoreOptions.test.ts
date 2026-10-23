import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { addMoreEntries, sectionExcludedEntries } from './addMoreOptions'

const ids = (context: 'item' | 'section', attachments = true) =>
  addMoreEntries(context, { attachments }).map((entry) => entry.id)

describe('Add More entries', () => {
  // Owner, 2026-10-18: a section's menu is the same control minus these six.
  const excluded = ['sign_in_with', 'otp', 'section', 'parent', 'child', 'related']

  it('names the six entries a section leaves out', () => {
    expect([...sectionExcludedEntries].sort()).toEqual([...excluded].sort())
  })

  it('offers all six on the item', () => {
    for (const id of excluded) expect(ids('item')).toContain(id)
  })

  it('offers none of the six inside a section', () => {
    for (const id of excluded) expect(ids('section')).not.toContain(id)
  })

  it('keeps the plain field types in both, in the same order', () => {
    const section = ids('section')
    expect(section).toEqual(ids('item').filter((id) => section.includes(id)))
    for (const id of ['text', 'password', 'email', 'phone', 'url', 'address', 'date']) expect(section).toContain(id)
  })

  it('never offers a passkey: one is only saved from the browser extension prompt', () => {
    expect(ids('item')).not.toContain('passkey')
    expect(ids('section')).not.toContain('passkey')
    expect(ids('item', false)).not.toContain('passkey')
  })

  it('offers Attach File only where attachments exist, and never inside a section', () => {
    expect(ids('item', true)).toContain('file')
    expect(ids('item', false)).not.toContain('file')
    expect(ids('section', true)).not.toContain('file')
  })
  it('leaves no other way to add a passkey by hand in the editor', () => {
    for (const file of [
      'src/app/useVaultWindow.tsx',
      'src/app/itemEditForm.tsx',
      'src/app/addMoreOptions.ts',
      'src/app/addMoreMenu.tsx',
    ]) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toContain('addMoreOptions.passkey')
      expect(source).not.toMatch(/add(CustomField|SectionChild)\([^)]*'passkey'/)
    }
  })
})
