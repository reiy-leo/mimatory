import { describe, expect, it } from 'vitest'
import { type ClipboardLike, clipboardClearDelayMs, copyText } from './clipboard'

function fakeClipboard(initial = '') {
  let text = initial
  const clipboard: ClipboardLike = {
    readText: async () => text,
    writeText: async (value: string) => {
      text = value
    },
  }
  return { clipboard, read: () => text, set: (value: string) => (text = value) }
}

describe('copyText', () => {
  it('writes the value and clears a secret after 90 seconds when the setting is on', async () => {
    const board = fakeClipboard()
    const scheduled: Array<{ callback: () => void; delay: number }> = []
    await copyText('hunter2', {
      clearAfter90Seconds: true,
      clipboard: board.clipboard,
      schedule: (callback, delay) => scheduled.push({ callback, delay }),
      sensitive: true,
    })
    expect(board.read()).toBe('hunter2')
    expect(scheduled.map((entry) => entry.delay)).toEqual([clipboardClearDelayMs])
    scheduled[0].callback()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(board.read()).toBe('')
  })

  it('leaves the clipboard alone when the user copied something else since', async () => {
    const board = fakeClipboard()
    let clear = () => {}
    await copyText('hunter2', {
      clearAfter90Seconds: true,
      clipboard: board.clipboard,
      schedule: (callback) => {
        clear = callback
      },
      sensitive: true,
    })
    board.set('something else')
    clear()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(board.read()).toBe('something else')
  })

  it('never schedules a clear for a plain value or with the setting off', async () => {
    const board = fakeClipboard()
    const scheduled: number[] = []
    const schedule = (_: () => void, delay: number) => scheduled.push(delay)
    await copyText('rei', { clearAfter90Seconds: true, clipboard: board.clipboard, schedule, sensitive: false })
    await copyText('pw', { clearAfter90Seconds: false, clipboard: board.clipboard, schedule, sensitive: true })
    expect(scheduled).toEqual([])
  })

  it('copies nothing for an empty value', async () => {
    const board = fakeClipboard('kept')
    expect(await copyText('', { clearAfter90Seconds: true, clipboard: board.clipboard, sensitive: true })).toBe(false)
    expect(board.read()).toBe('kept')
  })
})
