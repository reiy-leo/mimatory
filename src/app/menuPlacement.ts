import type { CSSProperties } from 'react'

export type MenuPlacement = 'above' | 'below'

const MENU_GAP = 6

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

  return {
    placement,
    style: { left: rect.left, position: 'fixed', width: rect.width, ...vertical },
  }
}
