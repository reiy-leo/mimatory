import { describe, expect, it } from 'vitest'
import { editBannerTileFor, editBannerTypes } from './editBanner'
import { itemTypeArt } from './itemTypeArt'

describe('edit banner patterns', () => {
  it('gives every item category its own tile', () => {
    const types = Object.keys(itemTypeArt)
    expect(types.length).toBeGreaterThan(0)
    for (const type of types) expect(editBannerTypes).toContain(type)
    const drawings = new Set(editBannerTypes.map((type) => editBannerTileFor(type).draw))
    expect(drawings.size).toBe(editBannerTypes.length)
  })

  it('falls back to the login stripes for an unknown type', () => {
    expect(editBannerTileFor('nope')).toBe(editBannerTileFor('login'))
  })
})
