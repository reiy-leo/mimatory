// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Globe } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ItemIconMenuButton } from './itemIconMenu'

afterEach(cleanup)

describe('edit header icon badge', () => {
  it('renders nothing when there is no icon choice', () => {
    render(<ItemIconMenuButton choices={[]} label="Icon Options" />)
    expect(screen.queryByRole('button', { name: 'Icon Options' })).toBeNull()
  })

  it('opens the choices, runs the picked one, and closes with focus back on the badge', () => {
    const onSelect = vi.fn()
    render(
      <ItemIconMenuButton
        choices={[{ icon: Globe, id: 'website', label: 'Use Website Icon', onSelect }]}
        label="Icon Options"
      />,
    )
    const badge = screen.getByRole('button', { name: 'Icon Options' })
    fireEvent.click(badge)
    expect(badge.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use Website Icon' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(badge)
  })

  it('closes on Escape without picking', () => {
    const onSelect = vi.fn()
    render(
      <ItemIconMenuButton
        choices={[{ icon: Globe, id: 'website', label: 'Use Website Icon', onSelect }]}
        label="Icon Options"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Icon Options' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })
})
