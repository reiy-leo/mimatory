import { describe, expect, it } from 'vitest'
import { featuresFor, isPrimaryModifier, quickAccessKeys, shortcutLabel } from './platformFeatures'

describe('platform features', () => {
  it('keeps the desktop-only features off the phones', () => {
    for (const platform of ['ios', 'android'] as const) {
      const features = featuresFor(platform)
      expect(features.browserExtension).toBe(false)
      expect(features.quickAccess).toBe(false)
      expect(features.autostart).toBe(false)
      expect(features.settingsWindow).toBe(false)
      expect(features.attachments).toBe(false)
      expect(features.biometrics).toBe('biometrics')
    }
  })

  it('offers Touch ID on the Mac only, and no biometrics on Windows or Linux', () => {
    expect(featuresFor('macos').biometrics).toBe('touch-id')
    expect(featuresFor('windows').biometrics).toBeNull()
    expect(featuresFor('linux').biometrics).toBeNull()
  })

  it('marks Linux windows as undecorated (Hyprland draws no title bar)', () => {
    expect(featuresFor('linux').undecoratedWindows).toBe(true)
    expect(featuresFor('windows').undecoratedWindows).toBe(false)
    expect(featuresFor('macos').undecoratedWindows).toBe(false)
  })

  it('writes shortcuts in each platform’s notation and listens to the right modifier', () => {
    expect(shortcutLabel('mod+,', 'macos')).toBe('⌘ ,')
    expect(shortcutLabel('mod+n', 'windows')).toBe('Ctrl+N')
    expect(shortcutLabel('mod+shift+Space', 'macos')).toBe('⌘ ⇧ Space')
    expect(isPrimaryModifier({ ctrlKey: false, metaKey: true }, 'macos')).toBe(true)
    expect(isPrimaryModifier({ ctrlKey: true, metaKey: false }, 'macos')).toBe(false)
    expect(isPrimaryModifier({ ctrlKey: true, metaKey: false }, 'linux')).toBe(true)
  })

  it('names how Quick Access is summoned', () => {
    expect(quickAccessKeys('windows')).toBe('Ctrl+Shift+Space')
    expect(quickAccessKeys('linux')).toBe('passless --quick-access')
    expect(quickAccessKeys('android')).toBeNull()
  })
})
