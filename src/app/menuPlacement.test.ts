import { describe, expect, it } from 'vitest'
import { getMenuAnchorStyle, getMenuPlacement } from './menuPlacement'

describe('floating menu placement', () => {
  it('opens below while the space below still fits the menu', () => {
    expect(getMenuPlacement({ menuHeight: 200, spaceAbove: 600, spaceBelow: 240 })).toBe('below')
  })

  it('flips above once the space below runs out', () => {
    expect(getMenuPlacement({ menuHeight: 200, spaceAbove: 600, spaceBelow: 120 })).toBe('above')
  })

  it('picks the roomier side when neither side fits', () => {
    expect(getMenuPlacement({ menuHeight: 500, spaceAbove: 180, spaceBelow: 90 })).toBe('above')
    expect(getMenuPlacement({ menuHeight: 500, spaceAbove: 90, spaceBelow: 180 })).toBe('below')
  })

  it('anchors below the trigger when there is room', () => {
    const { placement, style } = getMenuAnchorStyle({
      menuHeight: 200,
      rect: { bottom: 300, left: 640, top: 264, width: 520 },
      viewportHeight: 900,
    })

    expect(placement).toBe('below')
    expect(style).toMatchObject({ bottom: undefined, left: 640, position: 'fixed', top: 306, width: 520 })
  })

  it('anchors above the trigger when the bottom of the window is close', () => {
    const { placement, style } = getMenuAnchorStyle({
      menuHeight: 200,
      rect: { bottom: 860, left: 40, top: 824, width: 300 },
      viewportHeight: 900,
    })

    expect(placement).toBe('above')
    expect(style).toMatchObject({ bottom: 82, left: 40, position: 'fixed', top: undefined, width: 300 })
  })
})
