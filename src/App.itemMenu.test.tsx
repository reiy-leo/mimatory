// @vitest-environment jsdom
// The one full-window DOM test: the item header's ellipsis menu has to survive the click that opens it (owner bug
// report 2026-10-18 — the window's outside-click closer, registered by that same click, closed it at once). It
// renders the real App against an in-memory Tauri bridge (`mockIPC` + `mockWindows`), so it also proves the
// previous / next toolbar buttons step through the list.
import '@testing-library/jest-dom/vitest'
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { flushSync } from 'react-dom'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import i18n from './app/i18n'

const item = (id: string, title: string) => ({
  custom_fields: [],
  favorite: false,
  id,
  item_type: 'login',
  notes: '',
  password: 'correct-horse',
  tags: [],
  title,
  updated_at: '2026-10-18T00:00:00Z',
  urls: [],
  username: `${id}@example.com`,
  website: '',
})
const items = [item('a', 'Alpha'), item('b', 'Bravo'), item('c', 'Charlie')]

function stubBridge() {
  mockWindows('main')
  mockIPC(
    (cmd) => {
      switch (cmd) {
        case 'initialize_database':
          return { database_ready: true, has_master_password: true, name: 'Passless', unlocked: false }
        case 'unlock_vault':
        case 'list_login_items':
          return structuredClone(items)
        case 'list_vaults':
          return [
            {
              archived: false,
              color: 'blue',
              created_at: '2026-01-01T00:00:00Z',
              icon: 'vault',
              id: 'personal',
              item_count: items.length,
              name: 'Personal',
              updated_at: '2026-10-18T00:00:00Z',
            },
            {
              archived: false,
              color: 'green',
              created_at: 'Thu 2026-01-01 8:00 AM CST (UTC+08:00)',
              icon: 'vault',
              id: 'work',
              item_count: 0,
              name: 'Work',
              updated_at: 'Sun 2026-10-18 8:00 AM CST (UTC+08:00)',
            },
          ]
        case 'list_tags':
        case 'list_archived_login_items':
        case 'list_trashed_login_items':
          return []
        case 'password_strength':
          return { bits: 60, level: 'strong' }
        default:
          return null
      }
    },
    { shouldMockEvents: true },
  )
}

beforeAll(() => {
  // jsdom has neither; the theme hook reads the first, menus scroll rows into view with the second.
  window.matchMedia ??= ((query: string) => ({
    addEventListener() {},
    addListener() {},
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener() {},
    removeListener() {},
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView ??= () => {}
  localStorage.setItem('passless-language', 'en')
  void i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  clearMocks()
})

async function renderUnlocked() {
  stubBridge()
  const { App } = await import('./App')
  render(<App />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200))
  })
  const password = await screen.findByLabelText(/password/i, { selector: 'input[type=password]' })
  fireEvent.change(password, { target: { value: 'password123' } })
  await act(async () => {
    fireEvent.submit(password.closest('form') as HTMLFormElement)
  })
  await screen.findByRole('button', { name: /Alpha/ })
}

describe('vault window', () => {
  it('opens the item ellipsis menu in view mode and keeps it open', async () => {
    await renderUnlocked()
    fireEvent.click(screen.getByRole('button', { name: /Bravo/ }))
    const trigger = await screen.findByRole('button', { name: 'Item actions' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    // A click from the user runs a microtask checkpoint after each listener, so React commits the opening
    // render — and runs its effects, which register the window's outside-click closer — while the click is still
    // on its way up to window. A script-dispatched event has no such checkpoint, so a document listener
    // flushes React at that same moment; without it this test could not see the bug.
    const flushBeforeWindow = () => flushSync(() => {})
    document.addEventListener('click', flushBeforeWindow, { once: true })
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument())
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // A click elsewhere still closes it.
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('swaps in the vault list when Move to is clicked instead of closing the menu', async () => {
    await renderUnlocked()
    fireEvent.click(screen.getByRole('button', { name: /Bravo/ }))
    const trigger = await screen.findByRole('button', { name: 'Item actions' })
    fireEvent.click(trigger)
    const moveTo = await screen.findByRole('button', { name: /move to/i })
    // Flush React between the menu and window, as a real click does, so the clicked row is already gone from
    // the document when the window's outside-click closer looks at the event.
    document.addEventListener('click', () => flushSync(() => {}), { once: true })
    await act(async () => {
      moveTo.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Work' })).toBeInTheDocument()
  })

  it('steps through the list with the toolbar arrows and disables them at the ends', async () => {
    await renderUnlocked()
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    const previous = screen.getByRole('button', { name: 'Previous item' })
    const next = screen.getByRole('button', { name: 'Next item' })
    await waitFor(() => expect(previous).toBeDisabled())
    expect(next).toBeEnabled()
    fireEvent.click(next)
    await waitFor(() => expect(screen.getByRole('button', { name: /Bravo/ })).toHaveClass('active'))
    fireEvent.click(next)
    await waitFor(() => expect(next).toBeDisabled())
    fireEvent.click(previous)
    await waitFor(() => expect(screen.getByRole('button', { name: /Bravo/ })).toHaveClass('active'))
    // ⌘↑ / Ctrl+↑ (whichever the platform's primary modifier is), but never while typing in a field.
    fireEvent.keyDown(document.body, { ctrlKey: true, key: 'ArrowUp', metaKey: true })
    await waitFor(() => expect(screen.getByRole('button', { name: /Alpha/ })).toHaveClass('active'))
    fireEvent.keyDown(screen.getByLabelText('Search all item titles'), {
      ctrlKey: true,
      key: 'ArrowDown',
      metaKey: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole('button', { name: /Alpha/ })).toHaveClass('active')
    fireEvent.keyDown(document.body, { ctrlKey: true, key: 'ArrowDown', metaKey: true })
    await waitFor(() => expect(screen.getByRole('button', { name: /Bravo/ })).toHaveClass('active'))
  })

  it('locks the rest of the window while the edit form has unsaved changes', async () => {
    await renderUnlocked()
    fireEvent.click(screen.getByRole('button', { name: /Bravo/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const title = await screen.findByLabelText('Login title')
    fireEvent.change(title, { target: { value: 'Bravo edited' } })
    await screen.findByText(/save or cancel to continue/i)
    // A list row, a vault and the toolbar arrows all stay put until the edit is saved or cancelled.
    fireEvent.click(screen.getByRole('button', { name: /Charlie/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next item' }))
    fireEvent.keyDown(document.body, { ctrlKey: true, key: 'ArrowDown', metaKey: true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByLabelText('Login title')).toHaveValue('Bravo edited')
    expect(document.querySelector('.item-list')).toHaveAttribute('inert')
    expect(document.querySelector('.sidebar')).toHaveAttribute('inert')
    // Cancel lifts the lock.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.querySelector('.item-list')).not.toHaveAttribute('inert'))
    fireEvent.click(screen.getByRole('button', { name: /Charlie/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Charlie/ })).toHaveClass('active'))
  })
})
