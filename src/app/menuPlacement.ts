import type { CSSProperties } from 'react'

export type MenuPlacement = 'above' | 'below'

const MENU_GAP = 6

/** Every floating menu keeps this far inside the window. */
export const VIEWPORT_MARGIN = 8

/**
 * Only the roomier side is worth picking when neither side fits: the menu caps its own
 * height and scrolls, so a tight viewport should still favour the larger gap.
 */
export function getMenuPlacement(input: { menuHeight: number; spaceAbove: number; spaceBelow: number }): MenuPlacement {
  const { menuHeight, spaceAbove, spaceBelow } = input
  if (spaceBelow >= menuHeight) return 'below'
  if (spaceAbove >= menuHeight) return 'above'
  return spaceAbove > spaceBelow ? 'above' : 'below'
}

export type MenuAnchorRect = { bottom: number; left: number; top: number; width: number }

export type MenuAnchor = { placement: MenuPlacement; style: CSSProperties }

/**
 * The menus are anchored to the viewport because the rows they hang from clip absolutely
 * positioned children, and `rect` is whatever the caller wants the panel to line up with.
 */
export function getMenuAnchorStyle(input: {
  menuHeight: number
  rect: MenuAnchorRect
  viewportHeight: number
}): MenuAnchor {
  const { menuHeight, rect, viewportHeight } = input
  const placement = getMenuPlacement({
    menuHeight,
    spaceAbove: rect.top,
    spaceBelow: viewportHeight - rect.bottom,
  })
  const vertical =
    placement === 'above'
      ? { bottom: viewportHeight - rect.top + MENU_GAP, top: undefined }
      : { bottom: undefined, top: rect.bottom + MENU_GAP }

  // Capped to the room on the chosen side (8px inside the window), so a long menu scrolls instead of running
  // off the top or bottom edge.
  const room = placement === 'above' ? rect.top - MENU_GAP : viewportHeight - rect.bottom - MENU_GAP
  const maxHeight = Math.max(0, Math.floor(room - VIEWPORT_MARGIN))
  return {
    placement,
    style: { left: rect.left, maxHeight, position: 'fixed', width: rect.width, ...vertical },
  }
}

export type PanelPlacement = {
  left: number
  maxHeight: number
  placement: MenuPlacement
  /** Set when the panel hangs below the trigger. */
  top?: number
  /** Set when the panel opens upwards: the distance from the viewport's bottom edge. */
  bottom?: number
}

/**
 * Where a measured popover goes (macOS menus.md: a pop-up menu opens beside its control and stays on screen):
 * below the trigger when it fits, above when only that side does, else the roomier side with its height
 * capped to the room there so it scrolls instead of running off the window. Horizontally it lines up with the
 * trigger's leading edge (or trailing edge for `align: 'end'`) and is clamped `VIEWPORT_MARGIN` inside the
 * viewport.
 */
export function placeAnchoredPanel(input: {
  align?: 'end' | 'start'
  panelHeight: number
  panelWidth: number
  rect: { bottom: number; left: number; right: number; top: number }
  viewport: { height: number; width: number }
}): PanelPlacement {
  const { align = 'start', panelHeight, panelWidth, rect, viewport } = input
  const spaceBelow = Math.max(0, viewport.height - rect.bottom - MENU_GAP - VIEWPORT_MARGIN)
  const spaceAbove = Math.max(0, rect.top - MENU_GAP - VIEWPORT_MARGIN)
  const placement = getMenuPlacement({ menuHeight: panelHeight, spaceAbove, spaceBelow })
  const maxHeight = Math.max(0, Math.floor(placement === 'below' ? spaceBelow : spaceAbove))
  const preferred = align === 'end' ? rect.right - panelWidth : rect.left
  const maxLeft = viewport.width - panelWidth - VIEWPORT_MARGIN
  const left = Math.max(VIEWPORT_MARGIN, Math.min(preferred, maxLeft))
  return placement === 'below'
    ? { left, maxHeight, placement, top: rect.bottom + MENU_GAP }
    : { bottom: viewport.height - rect.top + MENU_GAP, left, maxHeight, placement }
}
