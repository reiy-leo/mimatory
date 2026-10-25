// @vitest-environment jsdom
// The one full-window DOM test: the item header's ellipsis menu has to survive the click that opens it (owner bug
// report 2026-10-18 — the window's outside-click closer, registered by that same click, closed it at once). It
// renders the real App against an in-memory Tauri bridge (`mockIPC` + `mockWindows`), so it also proves the
// previous / next toolbar buttons step through the list.
import '@testing-library/jest-dom/vitest'
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  tags: [] as string[],
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
// Every sync_request the window sent: a successful write asks for a sync round (vaultApi `write`).
const syncRequests: string[] = []
// Every get_login_item the window made: the list carries summaries, so a full item is read only when opened.
const detailReads: Array<{ itemId: string; vaultId: string | null }> = []

type StubItem = ReturnType<typeof item> & { vault_id?: string }

// Per-test knobs for the bridge (reset after each test), and every bulk command the window sent with its ids.
const scenario = {
  // Items a bulk trash took out of the live lists (when `liveTrash` is on, the stub's bridge really moves them).
  gone: new Set<string>(),
  liveTrash: false,
  // The Rust session on another (empty) vault while the window names Personal — the 2026-10-25 "838, empty" bug.
  sessionOnEmptyVault: false,
  switchFails: false,
  trashed: [] as StubItem[],
  workArchived: false,
}
const bulkCalls: Array<{ cmd: string; ids: string[]; vaultId?: string }> = []
const bulkCommands = [
  'trash_login_items',
  'archive_login_items',
  'restore_archived_login_items',
  'restore_trashed_login_items',
  'purge_login_items',
  'move_login_items',
]

// What the list commands answer with (vault.rs LoginItemSummary): no password, notes, fields or second address.
function summary({ custom_fields: _fields, notes: _notes, password: _password, urls: _urls, ...rest }: StubItem) {
  return structuredClone(rest)
}

const live = () => items.filter((entry) => !scenario.gone.has(entry.id))

function stubBridge() {
  mockWindows('main')
  mockIPC(
    (cmd, args) => {
      if (bulkCommands.includes(cmd)) {
        const { ids, vaultId } = args as { ids: string[]; vaultId?: string }
        bulkCalls.push({ cmd, ids: [...ids], vaultId })
        if (cmd === 'trash_login_items' && scenario.liveTrash) for (const id of ids) scenario.gone.add(id)
        if (cmd === 'purge_login_items') scenario.trashed = scenario.trashed.filter((entry) => !ids.includes(entry.id))
        return { done: ids.length, held: [] }
      }
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
          if (scenario.switchFails) throw new Error('database is locked')
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
          return { database_ready: true, has_master_password: true, name: 'Mimatory', unlocked: false }
        case 'unlock_vault':
        case 'list_login_items':
          return scenario.sessionOnEmptyVault ? [] : live().map(summary)
        case 'list_all_login_items':
          return [
            ...live().map((entry) => summary({ ...entry, vault_id: 'personal' })),
            ...(scenario.gone.has(workItem.id) ? [] : [summary(workItem)]),
          ]
        case 'list_vaults':
          return [
            {
              archived: false,
              color: 'blue',
              created_at: '2026-01-01T00:00:00Z',
              icon: 'vault',
              id: 'personal',
              item_count: live().length,
              name: 'Personal',
              updated_at: '2026-10-18T00:00:00Z',
            },
            {
              archived: scenario.workArchived,
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
        case 'list_trashed_login_items':
          return scenario.trashed.map((entry) => summary({ ...entry, vault_id: 'personal' }))
        case 'list_tags':
        case 'list_archived_login_items':
          return []
        case 'password_strength':
          return { bits: 60, level: 'strong' }
        case 'set_native_locale':
          return null
        case 'browser_connection_status':
          return {
            connected: 0,
            extensionId: 'pjcffbogeilnkbmnlegjdciggbfbekfb',
            lastBrowser: null,
            registeredBrowsers: [],
          }
        case 'sync_request':
          syncRequests.push('request')
          return null
        case 'sync_status':
          return {
            google_available: false,
            last_error: null,
            last_report: null,
            last_sync_at: null,
            provider: null,
            remote_folder: 'mimatory/',
            state: 'disconnected',
            webdav_url: null,
            webdav_username: null,
          }
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
  // The item list is virtualized and renders the rows that fit its scroll box. jsdom lays nothing out, so the
  // list reports a tall box and every row measures 0px: the whole (short) test list is rendered.
  const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('item-list') ? 800 : (clientHeight?.get?.call(this) ?? 0)
    },
  })
  localStorage.setItem('mimatory-language', 'en')
  void i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  clearMocks()
  Object.assign(scenario, {
    gone: new Set<string>(),
    liveTrash: false,
    sessionOnEmptyVault: false,
    switchFails: false,
    trashed: [],
    workArchived: false,
  })
  bulkCalls.length = 0
})

const primary = { ctrlKey: true, metaKey: true }
const row = (name: RegExp) => screen.getByRole('button', { name })
const sidebarButton = (label: string) =>
  [...(document.querySelector('.sidebar') as HTMLElement).querySelectorAll('button')].find((button) =>
    button.textContent?.trim().startsWith(label),
  ) as HTMLElement
const activeTitles = () => [...document.querySelectorAll('.item-row.active strong')].map((node) => node.textContent)

// The session is on an empty vault: the first list is empty, so the window has no row to wait for.
async function renderUnlockedAll() {
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
  await screen.findByRole('button', { name: /Delta/ })
}

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
  // The window re-lists 120ms after unlocking; let that settle before a test starts selecting.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200))
  })
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
    expect(JSON.parse(localStorage.getItem('mimatory-item-sort') ?? '{}')).toEqual({ direction: 'desc', key: 'title' })
    localStorage.removeItem('mimatory-item-sort')
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

  it('asks for a sync round after a write, and not after a read', async () => {
    await renderUnlocked()
    syncRequests.length = 0
    fireEvent.click(screen.getByRole('button', { name: /Bravo/ }))
    const star = await screen.findByRole('button', { name: 'Favorite' })
    expect(syncRequests).toEqual([])
    await act(async () => {
      fireEvent.click(star)
    })
    await waitFor(() => expect(syncRequests).toEqual(['request']))
    items[1].favorite = false
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
    localStorage.setItem('mimatory-column-widths', JSON.stringify({ itemList: 240, sidebar: 9999 }))
    await renderUnlocked()
    const shell = document.querySelector('.app-shell') as HTMLElement
    expect(shell.style.getPropertyValue('--item-list-width')).toBe('240px')
    expect(shell.style.getPropertyValue('--sidebar-width')).toBe('220px')
    const handle = screen.getByRole('button', { name: 'Resize item list' })
    fireEvent.mouseDown(handle, { clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 390 })
    fireEvent.mouseUp(window)
    expect(JSON.parse(localStorage.getItem('mimatory-column-widths') ?? '{}')).toEqual({ itemList: 230, sidebar: 9999 })
    localStorage.removeItem('mimatory-column-widths')
  })

  // Rei, 2026-10-25: "personal库显示838个items，但点击后，列表为空". The vault row listed `items` — whatever the Rust
  // session last read — whenever the window already named that vault; with the session elsewhere (here: on an empty
  // vault, and the switch to Personal failing) the row showed nothing under its count.
  it('lists the vault row from the same live items its count is made of, even when the session is elsewhere', async () => {
    scenario.sessionOnEmptyVault = true
    scenario.switchFails = true
    await renderUnlockedAll()
    await act(async () => {
      fireEvent.click(sidebarButton('Personal'))
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument())
    const count = Number(sidebarButton('Personal').querySelector('.nav-count')?.textContent)
    expect(document.querySelectorAll('.item-row')).toHaveLength(count)
    expect(screen.queryByRole('button', { name: /Delta/ })).not.toBeInTheDocument()
  })

  it('selects every row with ⌘A, but leaves ⌘A in a text field alone', async () => {
    await renderUnlocked()
    await screen.findByRole('button', { name: /Delta/ })
    const search = screen.getByLabelText('Search items and settings')
    fireEvent.keyDown(search, { ...primary, code: 'KeyA', key: 'a' })
    expect(activeTitles().length).toBeLessThanOrEqual(1)
    fireEvent.keyDown(document.body, { ...primary, code: 'KeyA', key: 'a' })
    await screen.findByText('4 Items Selected')
    expect(activeTitles()).toHaveLength(4)
    // Escape clears the selection, and the pane says nothing is selected.
    fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' })
    await screen.findByText('No Item Selected')
    expect(activeTitles()).toHaveLength(0)
  })

  it('selects all from Edit ▸ Select All (the webview’s selectAll: reaches the page as selectstart)', async () => {
    await renderUnlocked()
    await screen.findByRole('button', { name: /Delta/ })
    document.body.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true }))
    await screen.findByText('4 Items Selected')
  })

  it('toggles with ⌘-click, ranges with ⇧-click and extends with ⇧↓', async () => {
    await renderUnlocked()
    await screen.findByRole('button', { name: /Delta/ })
    const titles = () => [...document.querySelectorAll('.item-row strong')].map((node) => node.textContent as string)
    const [first, second, third, fourth] = titles()
    fireEvent.click(row(new RegExp(first)))
    fireEvent.click(row(new RegExp(third)), primary)
    await screen.findByText('2 Items Selected')
    expect(activeTitles()).toEqual([first, third])
    fireEvent.click(row(new RegExp(third)), primary)
    await waitFor(() => expect(activeTitles()).toEqual([first]))
    fireEvent.click(row(new RegExp(third)), { shiftKey: true })
    await screen.findByText('3 Items Selected')
    expect(activeTitles()).toEqual([first, second, third])
    fireEvent.keyDown(document.body, { key: 'ArrowDown', shiftKey: true })
    await waitFor(() => expect(activeTitles()).toEqual([first, second, third, fourth]))
  })

  it('moves a multi-selection to the Trash in one call, after a light confirmation that counts it', async () => {
    await renderUnlocked()
    await screen.findByRole('button', { name: /Delta/ })
    fireEvent.keyDown(document.body, { ...primary, code: 'KeyA', key: 'a' })
    await screen.findByText('4 Items Selected')
    fireEvent.keyDown(document.body, { ...primary, key: 'Backspace' })
    const alert = await screen.findByRole('alertdialog')
    expect(alert).toHaveTextContent('Move 4 items to the Trash?')
    expect(alert).toHaveTextContent('You can restore them from the Trash.')
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Move to Trash' }))
    })
    await waitFor(() => expect(bulkCalls).toHaveLength(1))
    expect(bulkCalls[0].cmd).toBe('trash_login_items')
    expect([...bulkCalls[0].ids].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('drops every count to 0 once a bulk Move to Trash empties the vault, without a restart', async () => {
    // Rei 2026-10-25: after deleting everything the list was empty but "Personal" still said 838 until a restart.
    scenario.liveTrash = true
    await renderUnlocked()
    await screen.findByRole('button', { name: /Delta/ })
    const countOf = (label: string) => sidebarButton(label).querySelector('.nav-count')?.textContent
    expect(countOf('Personal')).toBe('3')
    fireEvent.keyDown(document.body, { ...primary, code: 'KeyA', key: 'a' })
    await screen.findByText('4 Items Selected')
    fireEvent.keyDown(document.body, { ...primary, key: 'Backspace' })
    const alert = await screen.findByRole('alertdialog')
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Move to Trash' }))
    })
    await waitFor(() => expect(countOf('Personal')).toBe('0'))
    expect(countOf('All')).toBe('0')
    expect(document.querySelectorAll('.item-row')).toHaveLength(0)
  })

  it('archives a selection from the pane and from the right-click menu', async () => {
    await renderUnlocked()
    await screen.findByRole('button', { name: /Delta/ })
    fireEvent.click(row(/Alpha/))
    fireEvent.click(row(/Bravo/), primary)
    await screen.findByText('2 Items Selected')
    fireEvent.contextMenu(row(/Bravo/))
    const menu = await screen.findByRole('menu')
    expect(menu).toHaveTextContent('2 Items Selected')
    await act(async () => {
      fireEvent.click(within(menu).getByRole('button', { name: 'Archive' }))
    })
    await waitFor(() => expect(bulkCalls.map((call) => call.cmd)).toEqual(['archive_login_items']))
    expect([...bulkCalls[0].ids].sort()).toEqual(['a', 'b'])
  })

  it('opens Trash on its first item, deletes a selection permanently and empties the trash behind a destructive alert', async () => {
    scenario.trashed = [item('t1', 'Old One'), item('t2', 'Old Two'), item('t3', 'Old Three')]
    await renderUnlocked()
    await act(async () => {
      fireEvent.click(sidebarButton('Trash'))
    })
    // The first row of the trash is selected and the pane offers its way back.
    await waitFor(() => expect(activeTitles()).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    fireEvent.keyDown(document.body, { ...primary, code: 'KeyA', key: 'a' })
    await screen.findByText('3 Items Selected')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }))
    let alert = await screen.findByRole('alertdialog')
    expect(alert).toHaveTextContent('Delete 3 items permanently?')
    expect(alert).toHaveTextContent("You can't undo this.")
    // The safe button has the focus; Escape walks away with nothing deleted.
    expect(within(alert).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(bulkCalls).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Empty Trash' }))
    alert = await screen.findByRole('alertdialog')
    expect(alert).toHaveTextContent('Empty the Trash?')
    expect(alert).toHaveTextContent('(3)')
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Empty Trash' }))
    })
    await waitFor(() => expect(bulkCalls.map((call) => call.cmd)).toEqual(['purge_login_items']))
    expect([...bulkCalls[0].ids].sort()).toEqual(['t1', 't2', 't3'])
  })

  it('opens every sidebar scope on its first item and leaves the pane empty for an empty one', async () => {
    await renderUnlocked()
    await screen.findByRole('button', { name: /Delta/ })
    fireEvent.click(row(/Charlie/))
    fireEvent.click(row(/Alpha/), primary)
    await screen.findByText('2 Items Selected')
    // A tag: its one item replaces the multi-selection.
    await act(async () => {
      fireEvent.click(sidebarButton('shared'))
    })
    await waitFor(() => expect(activeTitles()).toEqual(['Delta']))
    expect(await screen.findByText('Delta', { selector: '.detail-pane *' })).toBeInTheDocument()
    // Favorites holds nothing: no stale item in the pane.
    await act(async () => {
      fireEvent.click(sidebarButton('Favorites'))
    })
    await screen.findByText('No Item Selected')
    // A vault: its first row in the current sort.
    await act(async () => {
      fireEvent.click(sidebarButton('Personal'))
    })
    await waitFor(() => expect(activeTitles()).toHaveLength(1))
    const first = document.querySelector('.item-row strong')?.textContent
    expect(activeTitles()).toEqual([first])
  })

  it('keeps the last open vault: Archive and Dissolve are there but unavailable, with the reason', async () => {
    scenario.workArchived = true
    await renderUnlocked()
    fireEvent.contextMenu(sidebarButton('Personal'))
    const archive = await screen.findByRole('button', { name: /Archive Vault/ })
    expect(archive).toBeDisabled()
    expect(archive).toHaveTextContent('At least one vault has to stay open.')
    expect(screen.getByRole('button', { name: /Dissolve/ })).toBeDisabled()
  })
})
