import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { itemTypeArtFor } from './itemTypeArt'

// The picker's types come from vaultModel.ts's categoryItems table (the same shape i18n.test.ts reads).
const app = readFileSync('src/app/vaultModel.ts', 'utf8')
const table = app.slice(
  app.indexOf('const categoryItems = ['),
  app.indexOf('] as const', app.indexOf('const categoryItems = [')),
)
const itemTypes = Array.from(table.matchAll(/itemType: '([a-z_]+)'/g), (match) => match[1])

describe('item type art', () => {
  it('has a vendored colour SVG for every type the New Item picker lists', () => {
    expect(itemTypes.length).toBe(17)
    for (const itemType of itemTypes) {
      expect(existsSync(`src/assets/item-icons/${itemType}.svg`), itemType).toBe(true)
      expect(itemTypeArtFor(itemType), itemType).toBeTruthy()
    }
  })

  it('answers null for a type with no art', () => {
    expect(itemTypeArtFor('no_such_type')).toBeNull()
  })

  it('ships the MIT notice beside the art and names every file in it', () => {
    const notice = readFileSync('src/assets/item-icons/LICENSE', 'utf8')
    expect(notice).toContain('MIT License')
    expect(notice).toContain('Copyright (c) Microsoft Corporation.')
    for (const itemType of itemTypes) expect(notice).toContain(`${itemType}.svg`)
  })
})
