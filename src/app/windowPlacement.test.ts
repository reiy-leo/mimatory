import { describe, expect, it } from 'vitest'
import { getTopLeftCenteredOver } from './windowPlacement'

describe('settings window placement', () => {
  const panel = { height: 680, width: 920 }

  it('centres the panel over the main window on a non-retina display', () => {
    expect(
      getTopLeftCenteredOver({
        frame: { position: { x: 100, y: 60 }, scaleFactor: 1, size: { height: 760, width: 1180 } },
        ...panel,
      }),
    ).toEqual({ x: 230, y: 100 })
  })

  it('divides the physical frame by the scale factor', () => {
    // The same window on a 2x display is reported in physical pixels, and the origin doubles with it.
    expect(
      getTopLeftCenteredOver({
        frame: { position: { x: 200, y: 120 }, scaleFactor: 2, size: { height: 1520, width: 2360 } },
        ...panel,
      }),
    ).toEqual({ x: 230, y: 100 })
  })

  it('keeps a secondary display to the right in its own coordinates', () => {
    expect(
      getTopLeftCenteredOver({
        frame: { position: { x: 3840, y: 0 }, scaleFactor: 2, size: { height: 1440, width: 2560 } },
        ...panel,
      }),
    ).toEqual({ x: 2100, y: 20 })
  })

  it('keeps a display placed above the primary one negative', () => {
    // macOS reports the global space with the primary display's top-left at the origin, so a screen
    // mounted above it has a negative y — and centring there has to stay negative to land on it.
    expect(
      getTopLeftCenteredOver({
        frame: { position: { x: 0, y: -1440 }, scaleFactor: 2, size: { height: 1520, width: 2560 } },
        ...panel,
      }),
    ).toEqual({ x: 180, y: -680 })
  })

  it('shares the centre even when the panel is larger than the window', () => {
    const result = getTopLeftCenteredOver({
      frame: { position: { x: 0, y: 0 }, scaleFactor: 1, size: { height: 600, width: 960 } },
      ...panel,
    })
    expect(result).toEqual({ x: 20, y: -40 })
  })
})
