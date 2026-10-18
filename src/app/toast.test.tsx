// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readToastPosition, Toast, toastDurationMs, toastPositionPreferenceKey, writeToastPosition } from './toast'

describe('toast position preference', () => {
  afterEach(() => localStorage.clear())

  it('defaults to bottom right and ignores unknown values', () => {
    expect(readToastPosition()).toBe('bottom-right')
    localStorage.setItem(toastPositionPreferenceKey, 'middle')
    expect(readToastPosition()).toBe('bottom-right')
  })

  it('remembers the chosen position', () => {
    writeToastPosition('top-center')
    expect(readToastPosition()).toBe('top-center')
  })
})

describe('Toast', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('clears itself after the duration, even when the parent re-renders', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const { rerender } = render(<Toast message="Vault updated" onDismiss={onDismiss} />)
    expect(screen.getByRole('status').textContent).toBe('Vault updated')
    act(() => vi.advanceTimersByTime(toastDurationMs - 500))
    rerender(<Toast message="Vault updated" onDismiss={() => onDismiss()} />)
    act(() => vi.advanceTimersByTime(500))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('sits where the setting says', () => {
    writeToastPosition('top-right')
    render(<Toast message="Saved" onDismiss={() => {}} />)
    expect(screen.getByRole('status').dataset.position).toBe('top-right')
  })
})
