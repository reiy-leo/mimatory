import { type MouseEvent as ReactMouseEvent, useState } from 'react'
import { itemListWidthLimits, readColumnWidth, sidebarWidthLimits, storeColumnWidth } from './vaultModel'

/**
 * The sidebar's and the item list's widths: drag-resized from their gutters, clamped, remembered in
 * localStorage (moved out of App.tsx 2026-10-23).
 */
export function useColumnWidths() {
  const [itemListWidth, setItemListWidth] = useState(() => readColumnWidth('itemList', itemListWidthLimits))
  const [sidebarWidth, setSidebarWidth] = useState(() => readColumnWidth('sidebar', sidebarWidthLimits))
  // A gutter drag measures from where the drag began rather than accumulating, so a column stops at
  // its own limits instead of drifting once the cursor has run past them.
  function beginColumnResize(
    event: ReactMouseEvent<HTMLButtonElement>,
    input: {
      key: 'itemList' | 'sidebar'
      limits: { max: number; min: number }
      onWidth: (width: number) => void
      startWidth: number
    },
  ) {
    event.preventDefault()
    const startX = event.clientX
    let width = input.startWidth
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = input.startWidth + (moveEvent.clientX - startX)
      width = Math.min(input.limits.max, Math.max(input.limits.min, nextWidth))
      input.onWidth(width)
    }
    const handleMouseUp = () => {
      storeColumnWidth(input.key, width)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  function beginItemListResize(event: ReactMouseEvent<HTMLButtonElement>) {
    beginColumnResize(event, {
      key: 'itemList',
      limits: itemListWidthLimits,
      onWidth: setItemListWidth,
      startWidth: itemListWidth,
    })
  }

  function beginSidebarResize(event: ReactMouseEvent<HTMLButtonElement>) {
    beginColumnResize(event, {
      key: 'sidebar',
      limits: sidebarWidthLimits,
      onWidth: setSidebarWidth,
      startWidth: sidebarWidth,
    })
  }

  return {
    beginColumnResize,
    beginItemListResize,
    beginSidebarResize,
    itemListWidth,
    setItemListWidth,
    setSidebarWidth,
    sidebarWidth,
  }
}
