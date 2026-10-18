import { describe, expect, it } from 'vitest'
import { getMenuAnchorStyle, getMenuPlacement, placeAnchoredPanel } from './menuPlacement'

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

describe('anchored panel placement', () => {
  const viewport = { height: 600, width: 800 }

  it('hangs below the trigger, at its leading edge, when the panel fits', () => {
    const placed = placeAnchoredPanel({
      panelHeight: 200,
      panelWidth: 240,
      rect: { bottom: 130, left: 300, right: 700, top: 100 },
      viewport,
    })
    expect(placed).toMatchObject({ left: 300, placement: 'below', top: 136 })
    expect(placed.maxHeight).toBe(600 - 130 - 6 - 8)
  })

  it('flips up near the bottom and caps the height to the room above, 8px inside the window', () => {
    const placed = placeAnchoredPanel({
      panelHeight: 700,
      panelWidth: 240,
      rect: { bottom: 560, left: 300, right: 700, top: 530 },
      viewport,
    })
    expect(placed.placement).toBe('above')
    expect(placed.bottom).toBe(600 - 530 + 6)
    // Its top edge lands exactly on the margin: never off the top of the window.
    expect(600 - (placed.bottom ?? 0) - placed.maxHeight).toBe(8)
  })

  it('clamps horizontally so a menu near the right edge stays inside the window', () => {
    const placed = placeAnchoredPanel({
      panelHeight: 100,
      panelWidth: 280,
      rect: { bottom: 130, left: 700, right: 790, top: 100 },
      viewport,
    })
    expect(placed.left).toBe(800 - 280 - 8)
  })

  it('lines up with the trailing edge for end-aligned popovers', () => {
    const placed = placeAnchoredPanel({
      align: 'end',
      panelHeight: 100,
      panelWidth: 200,
      rect: { bottom: 130, left: 500, right: 600, top: 100 },
      viewport,
    })
    expect(placed.left).toBe(400)
  })
})
