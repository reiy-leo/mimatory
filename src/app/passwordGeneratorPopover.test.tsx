// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultGeneratorOptions } from './passwordGenerator'
import { PasswordGeneratorButton, PasswordGeneratorPanel } from './passwordGeneratorPopover'
import type { PasswordGeneratorOptions } from './vaultApi'
import './i18n'
import i18n from './i18n'

afterEach(cleanup)

function setup() {
  let count = 0
  const generate = vi.fn(async (options: PasswordGeneratorOptions) => {
    count += 1
    return `${options.mode}-${options.mode === 'passphrase' ? options.words : options.length}-${count}!`
  })
  const measure = vi.fn(async () => ({ bits: 120, level: 'excellent' as const }))
  const onUse = vi.fn()
  const onCancel = vi.fn()
  const onOptionsChange = vi.fn()
  render(
    <PasswordGeneratorPanel
      generate={generate}
      initialOptions={defaultGeneratorOptions}
      measure={measure}
      onCancel={onCancel}
      onOptionsChange={onOptionsChange}
      onUse={onUse}
    />,
  )
  return { generate, measure, onCancel, onOptionsChange, onUse }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function valueText() {
  return document.querySelector('.generator-popover-value')?.textContent ?? ''
}

describe('password generator popover', () => {
  it('generates on open, colours digits and symbols, and shows the strength bar', async () => {
    await i18n.changeLanguage('en')
    const { generate } = setup()
    await flush()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(valueText()).toBe('random-32-1!')
    const kinds = Array.from(document.querySelectorAll('.generator-popover-value span'), (span) => [
      span.className,
      span.textContent,
    ])
    expect(kinds).toEqual([
      ['is-letter', 'random'],
      ['is-symbol', '-'],
      ['is-digit', '32'],
      ['is-symbol', '-'],
      ['is-digit', '1'],
      ['is-symbol', '!'],
    ])
    expect(document.querySelector('.generator-popover-strength-bar.is-excellent.fill-full')).not.toBeNull()
  })

  it('regenerates whenever an option changes, and on the regenerate button', async () => {
    await i18n.changeLanguage('en')
    const { generate, onOptionsChange } = setup()
    await flush()
    fireEvent.click(screen.getByRole('switch', { name: 'Symbols' }))
    await flush()
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ symbols: false }))
    expect(onOptionsChange).toHaveBeenLastCalledWith(expect.objectContaining({ symbols: false }))

    const [slider] = screen.getAllByLabelText('Characters')
    fireEvent.change(slider, { target: { value: '40' } })
    await flush()
    expect(valueText()).toBe('random-40-3!')

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pin' } })
    await flush()
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ length: 12, mode: 'pin' }))
    // A PIN has no Numbers / Symbols rows; its slider counts digits.
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getAllByLabelText('Digits')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Generate Another' }))
    await flush()
    expect(generate).toHaveBeenCalledTimes(5)
  })

  it('waits for a complete number before applying a typed length', async () => {
    await i18n.changeLanguage('en')
    const { generate } = setup()
    await flush()
    const number = screen.getAllByLabelText('Characters')[1] as HTMLInputElement
    fireEvent.change(number, { target: { value: '5' } })
    await flush()
    expect(generate).toHaveBeenCalledTimes(1)
    fireEvent.change(number, { target: { value: '56' } })
    await flush()
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ length: 56 }))
    fireEvent.change(number, { target: { value: '3' } })
    fireEvent.blur(number)
    await flush()
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ length: 8 }))
    expect(number.value).toBe('8')
  })

  it('Use hands back the shown password; Cancel hands back nothing', async () => {
    await i18n.changeLanguage('en')
    const { onCancel, onUse } = setup()
    await flush()
    const use = screen.getByRole('button', { name: 'Use' })
    expect(document.activeElement).toBe(use)
    fireEvent.click(use)
    expect(onUse).toHaveBeenCalledWith('random-32-1!')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onUse).toHaveBeenCalledTimes(1)
  })

  it('keeps Tab inside the panel', async () => {
    await i18n.changeLanguage('en')
    setup()
    await flush()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const last = screen.getByRole('switch', { name: 'Symbols' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})

describe('password generator button', () => {
  it('opens the popover, Use fills and closes, Escape closes without filling, focus returns', async () => {
    await i18n.changeLanguage('en')
    const onUse = vi.fn()
    const generate = vi.fn(async () => 'abc123!')
    render(
      <PasswordGeneratorButton
        className="field-type-button"
        generate={generate}
        iconSize={18}
        label="Generate Password"
        onUse={onUse}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Generate Password' })
    fireEvent.click(trigger)
    await flush()
    expect(screen.getByRole('dialog')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Use' }))
    expect(onUse).toHaveBeenCalledWith('abc123!')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    await flush()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onUse).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
  })
})
