import { describe, expect, it } from 'vitest'
import { migrateLegacyStorageKeys } from './storageMigration'

function memoryStorage(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
    map,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

describe('migrateLegacyStorageKeys', () => {
  it('moves every passless-* key to mimatory-* and deletes the old one', () => {
    const storage = memoryStorage({
      'other-key': 'x',
      'passless-item-sort': '{"key":"title"}',
      'passless-language': 'en',
    })
    expect(migrateLegacyStorageKeys(storage).sort()).toEqual(['mimatory-item-sort', 'mimatory-language'])
    expect(Object.fromEntries(storage.map)).toEqual({
      'mimatory-item-sort': '{"key":"title"}',
      'mimatory-language': 'en',
      'other-key': 'x',
    })
  })

  it('never overwrites a value already under the new key', () => {
    const storage = memoryStorage({ 'mimatory-language': 'ja', 'passless-language': 'en' })
    expect(migrateLegacyStorageKeys(storage)).toEqual([])
    expect(Object.fromEntries(storage.map)).toEqual({ 'mimatory-language': 'ja' })
  })

  it('leaves passless-theme for theme.ts to delete, and is idempotent', () => {
    const storage = memoryStorage({ 'passless-theme': 'dark' })
    migrateLegacyStorageKeys(storage)
    migrateLegacyStorageKeys(storage)
    expect(Object.fromEntries(storage.map)).toEqual({ 'passless-theme': 'dark' })
  })
})
