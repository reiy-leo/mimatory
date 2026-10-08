import { describe, expect, it } from 'vitest'
import { navigationItems } from './navigation'

describe('navigationItems', () => {
  it('starts with the personal vault and keeps security center available', () => {
    expect(navigationItems[0]).toMatchObject({
      id: 'vaults',
      label: 'Personal',
      route: '#vaults',
    })
    expect(navigationItems.map((item) => item.id)).toContain('watchtower')
  })

  it('keeps navigation local so the Tauri webview does not reload and lock the vault', () => {
    expect(navigationItems.every((item) => item.route.startsWith('#'))).toBe(true)
  })
})
