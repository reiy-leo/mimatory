import { describe, expect, it } from 'vitest'
import { navigationItems } from './navigation'

describe('navigationItems', () => {
  it('lists the vault views and the two states an item can be held in', () => {
    expect(navigationItems[0]).toMatchObject({
      id: 'vaults',
      route: '#vaults',
    })
    /* Tags and categories are collapsible sidebar sections, the generator and Watchtower live in
       settings, and settings itself is ⌘, — none of them is a row in this list. */
    expect(navigationItems.map((item) => item.id)).toEqual(['vaults', 'favorites', 'archived', 'trash'])
    expect(navigationItems.filter((item) => item.group === 'footer').map((item) => item.id)).toEqual([
      'archived',
      'trash',
    ])
  })

  it('keeps navigation local so the Tauri webview does not reload and lock the vault', () => {
    expect(navigationItems.every((item) => item.route.startsWith('#'))).toBe(true)
  })
})
