import { describe, expect, it } from 'vitest'
import { defaultItemSort, readItemSort, sortItems } from './itemSort'
import type { LoginItem } from './vaultApi'

const item = (title: string, extra: Partial<LoginItem>): LoginItem => ({
  custom_fields: [],
  favorite: false,
  id: title,
  item_type: 'login',
  notes: '',
  password: '',
  tags: [],
  title,
  updated_at: '2026-10-01T00:00:00Z',
  urls: [],
  username: '',
  website: '',
  ...extra,
})

const items = [
  item('bravo', {
    created_at: '2026-01-02T00:00:00Z',
    last_used_at: '2026-10-10T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
    use_count: 5,
  }),
  item('Alpha', { created_at: '2026-01-03T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', use_count: 1 }),
  item('charlie', {
    created_at: '2026-01-01T00:00:00Z',
    last_used_at: '2026-10-12T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    use_count: 5,
  }),
]
const titles = (list: LoginItem[]) => list.map((entry) => entry.title)

describe('item sort', () => {
  it('sorts by title either way, ignoring case', () => {
    expect(titles(sortItems(items, { direction: 'asc', key: 'title' }))).toEqual(['Alpha', 'bravo', 'charlie'])
    expect(titles(sortItems(items, { direction: 'desc', key: 'title' }))).toEqual(['charlie', 'bravo', 'Alpha'])
  })

  it('sorts by created and modified dates, newest first by default', () => {
    expect(titles(sortItems(items, { direction: 'desc', key: 'created' }))).toEqual(['Alpha', 'bravo', 'charlie'])
    expect(titles(sortItems(items, defaultItemSort))).toEqual(['bravo', 'charlie', 'Alpha'])
    expect(titles(sortItems(items, { direction: 'asc', key: 'modified' }))).toEqual(['Alpha', 'charlie', 'bravo'])
  })

  it('sorts by use count with the title breaking ties, and never-used items last for Recently Used', () => {
    expect(titles(sortItems(items, { direction: 'desc', key: 'frequent' }))).toEqual(['bravo', 'charlie', 'Alpha'])
    expect(titles(sortItems(items, { direction: 'desc', key: 'recent' }))).toEqual(['charlie', 'bravo', 'Alpha'])
  })

  it('reads a stored choice and falls back on anything else', () => {
    expect(readItemSort({ getItem: () => '{"key":"title","direction":"asc"}' })).toEqual({
      direction: 'asc',
      key: 'title',
    })
    expect(readItemSort({ getItem: () => '{"key":"size"}' })).toEqual(defaultItemSort)
    expect(readItemSort({ getItem: () => 'not json' })).toEqual(defaultItemSort)
  })
})
