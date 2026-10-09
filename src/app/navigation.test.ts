import { describe, expect, it } from 'vitest'
import { navigationItems } from './navigation'

describe('navigationItems', () => {
  it('lists the three vault views and nothing else', () => {
    expect(navigationItems[0]).toMatchObject({
      id: 'vaults',
      label: 'Personal',
      route: '#vaults',
    })
    /* Tags and categories are collapsible sidebar sections, the generator and Watchtower live in
       settings — none of them is a row in this list. */
    expect(navigationItems.map((item) => item.id)).toEqual(['vaults', 'favorites', 'trash'])
  })

  it('keeps navigation local so the Tauri webview does not reload and lock the vault', () => {
    expect(navigationItems.every((item) => item.route.startsWith('#'))).toBe(true)
  })
})
