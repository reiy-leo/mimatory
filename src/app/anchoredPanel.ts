import { type CSSProperties, type RefObject, useLayoutEffect, useState } from 'react'
import { type PanelPlacement, placeAnchoredPanel } from './menuPlacement'

/**
 * Measures a floating panel once it is in the DOM and places it against its trigger: below or above, whichever
 * has room, clamped 8px inside the window, with its height capped to the room there. Until the measure lands
 * the panel is drawn invisible at the trigger, so it never flashes in the wrong place.
 */
export function useAnchoredPanel(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  options: { align?: 'end' | 'start'; width?: number } = {},
): { placement: PanelPlacement | null; style: CSSProperties } {
  const [placement, setPlacement] = useState<PanelPlacement | null>(null)
  const { align, width } = options
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    const measure = () => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (!trigger || !panel) return
      // The natural size, before any cap from a previous placement.
      const previous = panel.style.maxHeight
      panel.style.maxHeight = 'none'
      const panelHeight = panel.scrollHeight
      const panelWidth = width ?? panel.getBoundingClientRect().width
      panel.style.maxHeight = previous
      setPlacement(
        placeAnchoredPanel({
          align,
          panelHeight,
          panelWidth,
          rect: trigger.getBoundingClientRect(),
          viewport: { height: window.innerHeight, width: window.innerWidth },
        }),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, align, width, triggerRef, panelRef])

  const style: CSSProperties = placement
    ? {
        bottom: placement.bottom,
        left: placement.left,
        maxHeight: placement.maxHeight,
        position: 'fixed',
        top: placement.top,
        width,
      }
    : { left: 0, position: 'fixed', top: 0, visibility: 'hidden', width }
  return { placement, style }
}
