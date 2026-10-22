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

// An item in the second vault, carrying a tag the open vault does not have: All and the tag list read across vaults.
const workItem = { ...item('d', 'Delta'), tags: ['shared'], vault_id: 'work' }

const switchedTo: string[] = []
// Every get_login_item the window made: the list carries summaries, so a full item is read only when opened.
const detailReads: Array<{ itemId: string; vaultId: string | null }> = []

type StubItem = ReturnType<typeof item> & { vault_id?: string }

// What the list commands answer with (vault.rs LoginItemSummary): no password, notes, fields or second address.
function summary({ custom_fields: _fields, notes: _notes, password: _password, urls: _urls, ...rest }: StubItem) {
  return structuredClone(rest)
}

function stubBridge() {
  mockWindows('main')
  mockIPC(
    (cmd, args) => {
      switch (cmd) {
        case 'set_login_favorite': {
          const { id, favorite } = args as { favorite: boolean; id: string }
          const target = items.find((entry) => entry.id === id)
          if (target) target.favorite = favorite
          return null
        }
        case 'focus_vault':
          switchedTo.push((args as { id: string }).id)
          return null
        case 'switch_vault': {
          const id = (args as { id: string }).id
          switchedTo.push(id)
          return id === 'work' ? [summary(workItem)] : items.map(summary)
        }
        case 'get_login_item': {
          const { itemId, vaultId } = args as { itemId: string; vaultId: string | null }
          detailReads.push({ itemId, vaultId })
          const found = [...items, workItem].find((entry) => entry.id === itemId)
          if (!found) throw new Error('item not found')
          return structuredClone(found)
        }
        case 'initialize_database':
          return { database_ready: true, has_master_password: true, name: 'Passless', unlocked: false }
        case 'unlock_vault':
        case 'list_login_items':
          return items.map(summary)
        case 'list_all_login_items':
          return [...items.map((entry) => summary({ ...entry, vault_id: 'personal' })), summary(workItem)]
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
        case 'list_all_tags':
          return [{ color: '', icon: 'tag', name: 'shared' }]
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
    await waitFor(() => expect(screen.getByRole('button', { name: /Charlie/ })).toHaveClass('active'))
    // Delta lives in the Work vault: All shows it, and selecting it moves the session there quietly.
    fireEvent.click(next)
    await waitFor(() => expect(next).toBeDisabled())
    await waitFor(() => expect(switchedTo).toContain('work'))
    expect(screen.getByRole('button', { name: /Delta/ })).toHaveClass('active')
    fireEvent.click(previous)
    await waitFor(() => expect(screen.getByRole('button', { name: /Charlie/ })).toHaveClass('active'))
    // ⌘↑ / Ctrl+↑ (whichever the platform's primary modifier is), but never while typing in a field.
    fireEvent.keyDown(document.body, { ctrlKey: true, key: 'ArrowUp', metaKey: true })
    await waitFor(() => expect(screen.getByRole('button', { name: /Bravo/ })).toHaveClass('active'))
    fireEvent.keyDown(screen.getByLabelText('Search items and settings'), {
      ctrlKey: true,
      key: 'ArrowDown',
      metaKey: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole('button', { name: /Bravo/ })).toHaveClass('active')
    fireEvent.keyDown(document.body, { ctrlKey: true, key: 'ArrowDown', metaKey: true })
    await waitFor(() => expect(screen.getByRole('button', { name: /Charlie/ })).toHaveClass('active'))
  })

  it('locks the rest of the window while an item is being edited', async () => {
    await renderUnlocked()
    fireEvent.click(screen.getByRole('button', { name: /Bravo/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const title = await screen.findByLabelText('Login title')
    // The editor alone locks the window, before anything has changed (owner 2026-10-18).
    await waitFor(() => expect(document.querySelector('.sidebar')).toHaveAttribute('inert'))
    expect(screen.queryByText(/save or cancel to continue/i)).not.toBeInTheDocument()
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

  it('lists every vault under All and keeps the tags whatever vault is picked', async () => {
    await renderUnlocked()
    expect(await screen.findByRole('button', { name: /Delta/ })).toBeInTheDocument()
    const sidebar = document.querySelector('.sidebar') as HTMLElement
    expect(sidebar).toHaveTextContent('shared')
    // The Personal vault row lists only that vault, and the tag section stays as it was.
    const personal = [...sidebar.querySelectorAll('button')].find((button) => button.textContent?.includes('Personal'))
    await act(async () => {
      fireEvent.click(personal as HTMLElement)
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Delta/ })).not.toBeInTheDocument())
    expect(sidebar).toHaveTextContent('shared')
  })

  it('sorts the list from the menu at its top', async () => {
    await renderUnlocked()
    await screen.findByRole('button', { name: /Delta/ })
    const titles = () => [...document.querySelectorAll('.item-row strong')].map((node) => node.textContent)
    fireEvent.click(screen.getByRole('button', { name: /Date Modified/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Title' }))
    expect(titles()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    fireEvent.click(screen.getByRole('button', { name: /Title/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Z to A' }))
    expect(titles()).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha'])
    expect(JSON.parse(localStorage.getItem('passless-item-sort') ?? '{}')).toEqual({ direction: 'desc', key: 'title' })
    localStorage.removeItem('passless-item-sort')
  })

  it('fills the header star as soon as the item is favourited', async () => {
    await renderUnlocked()
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
    const star = await screen.findByRole('button', { name: 'Favorite' })
    expect(star).not.toHaveClass('active')
    await act(async () => {
      fireEvent.click(star)
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Favorite' })).toHaveClass('active'))
    items[0].favorite = false
  })

  it('finds settings from the toolbar search as well as items', async () => {
    await renderUnlocked()
    fireEvent.change(screen.getByLabelText('Search items and settings'), { target: { value: 'clip' } })
    expect(await screen.findByRole('button', { name: /Clipboard/ })).toHaveTextContent('Settings ▸ Security')
  })

  it('reads only the selected item in full, and shows it once it arrives', async () => {
    detailReads.length = 0
    await renderUnlocked()
    fireEvent.click(screen.getByRole('button', { name: /Charlie/ }))
    // The password row comes from the detail read; the list rows never carried one.
    expect(await screen.findByText('Charlie', { selector: '.detail-pane *' })).toBeInTheDocument()
    await waitFor(() => expect(detailReads.map((read) => read.itemId)).toContain('c'))
    // Every read was for a row the user selected, not one per listed item.
    expect(new Set(detailReads.map((read) => read.itemId)).size).toBeLessThanOrEqual(2)
  })

  it('remembers the dragged column widths', async () => {
    localStorage.setItem('passless-column-widths', JSON.stringify({ itemList: 240, sidebar: 9999 }))
    await renderUnlocked()
    const shell = document.querySelector('.app-shell') as HTMLElement
    expect(shell.style.getPropertyValue('--item-list-width')).toBe('240px')
    expect(shell.style.getPropertyValue('--sidebar-width')).toBe('220px')
    const handle = screen.getByRole('button', { name: 'Resize item list' })
    fireEvent.mouseDown(handle, { clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 390 })
    fireEvent.mouseUp(window)
    expect(JSON.parse(localStorage.getItem('passless-column-widths') ?? '{}')).toEqual({ itemList: 230, sidebar: 9999 })
    localStorage.removeItem('passless-column-widths')
  })
})
