import { describe, expect, it } from 'vitest'
import { type DraftSnapshot, isFormDirty } from './itemDrafts'

function draft(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    custom_fields: [{ field_type: 'text', label: 'Recovery codes', value: 'aaaa-bbbb' }],
    favorite: false,
    item_type: 'login',
    notes: '',
    password: 'rQ9!kW$9Z2#LpW7',
    tagsInput: 'work, critical',
    title: 'GitHub',
    urlsInput: [{ label: 'website', match_type: 'domain', url: 'https://github.com' }],
    username: 'alex@example.com',
    ...overrides,
  }
}

describe('item draft dirty checking', () => {
  it('treats an untouched form as clean', () => {
    expect(isFormDirty(draft(), draft())).toBe(false)
  })

  it('reports a credential change as unsaved', () => {
    expect(isFormDirty(draft(), draft({ password: 'rQ9!kW$9Z2#LpW8' }))).toBe(true)
    expect(isFormDirty(draft(), draft({ username: 'alex@work.com' }))).toBe(true)
  })

  it('keeps trailing spaces in a password, which are part of it', () => {
    expect(isFormDirty(draft(), draft({ password: 'rQ9!kW$9Z2#LpW7 ' }))).toBe(true)
  })

  it('ignores whitespace the save path trims away', () => {
    expect(isFormDirty(draft(), draft({ title: 'GitHub  ', username: ' alex@example.com' }))).toBe(false)
  })

  it('ignores tag punctuation that parses to the same tags', () => {
    expect(isFormDirty(draft(), draft({ tagsInput: 'work,critical' }))).toBe(false)
    expect(isFormDirty(draft(), draft({ tagsInput: 'work, critical, finance' }))).toBe(true)
  })

  it('ignores an empty website row', () => {
    expect(
      isFormDirty(
        draft(),
        draft({ urlsInput: [...draft().urlsInput, { label: '', match_type: 'domain', url: '  ' }] }),
      ),
    ).toBe(false)
    expect(
      isFormDirty(
        draft(),
        draft({
          urlsInput: [
            ...draft().urlsInput,
            { label: 'status', match_type: 'domain', url: 'https://www.githubstatus.com' },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('reports an autofill match change as unsaved', () => {
    expect(
      isFormDirty(
        draft(),
        draft({ urlsInput: [{ label: 'website', match_type: 'exact', url: 'https://github.com' }] }),
      ),
    ).toBe(true)
  })

  it('reports a custom field edit as unsaved', () => {
    const renamed = draft({
      custom_fields: [{ field_type: 'text', label: 'Backup codes', value: 'aaaa-bbbb' }],
    })
    expect(isFormDirty(draft(), renamed)).toBe(true)
  })
})
