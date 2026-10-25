// @vitest-environment jsdom
// Settings ▸ Sync against an in-memory bridge: the provider choice, the WebDAV form's https rule, the connected
// state with Sync Now, a translated HTTP error, and the remote-password sheet.
import '@testing-library/jest-dom/vitest'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import i18n from './i18n'
import type { SyncStatus } from './syncApi'
import { SyncSettingsPane } from './syncSettingsPane'

const disconnected: SyncStatus = {
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

const connected: SyncStatus = {
  ...disconnected,
  last_report: { at: '2026-10-25T01:00:00Z', deferred: 0, pulled: 2, pushed: 1 },
  last_sync_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  provider: 'webdav',
  state: 'idle',
  webdav_url: 'https://dav.example.com/dav/',
  webdav_username: 'rei',
}

type Handler = (args: Record<string, unknown>) => unknown

function stub(handlers: Record<string, Handler>) {
  const calls: Array<{ args: unknown; cmd: string }> = []
  mockIPC(
    (cmd, args) => {
      calls.push({ args, cmd })
      const handler = handlers[cmd]
      return handler ? handler((args ?? {}) as Record<string, unknown>) : null
    },
    { shouldMockEvents: true },
  )
  return calls
}

async function renderPane(googleSync = true) {
  render(<SyncSettingsPane googleSync={googleSync} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  clearMocks()
})

describe('Settings ▸ Sync', () => {
  it('disables Google with the reason when the build has no client id, and connects WebDAV over https only', async () => {
    let status = disconnected
    const calls = stub({
      sync_connect_webdav: () => {
        status = connected
        return connected
      },
      sync_status: () => status,
    })
    await renderPane()
    // Without Google the pane opens on WebDAV; Google stays offered, disabled, with the reason.
    expect(screen.getByRole('button', { name: 'WebDAV' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Google Drive' }))
    expect(screen.getByRole('button', { name: 'Sign In with Google' })).toBeDisabled()
    expect(screen.getByText(/does not include Google sign-in yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'WebDAV' }))

    const address = screen.getByLabelText('Server address')
    fireEvent.change(address, { target: { value: 'http://nas.local/dav' } })
    expect(screen.getByText(/Only https:\/\/ addresses are allowed/)).toBeInTheDocument()
    expect(address).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(screen.getByLabelText('User name'), { target: { value: 'rei' } })
    fireEvent.change(screen.getByLabelText('App password'), { target: { value: 'app-pass' } })
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()

    fireEvent.change(address, { target: { value: 'dav.example.com/dav/' } })
    expect(screen.getByText('Will connect to https://dav.example.com/dav/')).toBeInTheDocument()
    expect(screen.getByText('A folder named mimatory/ is created in the server’s root.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    })
    expect(calls.find((call) => call.cmd === 'sync_connect_webdav')?.args).toEqual({
      password: 'app-pass',
      url: 'https://dav.example.com/dav/',
      username: 'rei',
    })
    expect(await screen.findByText('https://dav.example.com/dav/')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sync Now/ })).toBeEnabled()
    expect(screen.getByText('2 received, 1 sent')).toBeInTheDocument()
  })

  it('shows a failed round with the status and its Chinese gloss', async () => {
    stub({
      sync_now: () => {
        throw { code: 'http', message: '401 未授权：用户名或应用密码不对', status: 401 }
      },
      sync_status: () => connected,
    })
    await renderPane()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sync Now/ }))
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('401 未授权: Wrong user name or app password.')
  })

  it('confirms before disconnecting', async () => {
    const calls = stub({ sync_disconnect: () => disconnected, sync_status: () => connected })
    await renderPane()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Stop Syncing on This Device?')
    expect(calls.some((call) => call.cmd === 'sync_disconnect')).toBe(false)
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' }).at(-1) as HTMLElement)
    })
    expect(calls.some((call) => call.cmd === 'sync_disconnect')).toBe(true)
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('asks for the remote vault’s master password and reports a wrong one', async () => {
    stub({
      sync_status: () => ({ ...connected, last_sync_at: null, state: 'needs_remote_password' }),
      sync_unlock_remote: ({ masterPassword }) => {
        if (masterPassword !== 'right') throw { code: 'remote_password_wrong', message: '', status: null }
        return connected
      },
    })
    await renderPane()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Master Password of the Synced Vault')
    const field = screen.getByLabelText('Master password of the synced vault')
    fireEvent.change(field, { target: { value: 'wrong' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    })
    expect(await screen.findByText('That password does not match the synced vault.')).toBeInTheDocument()
    fireEvent.change(field, { target: { value: 'right' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('explains that Google sync is desktop only on a phone', async () => {
    stub({ sync_status: () => ({ ...disconnected, google_available: true }) })
    await renderPane(false)
    fireEvent.click(screen.getByRole('button', { name: 'Google Drive' }))
    expect(screen.getByText(/not available on phones yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign In with Google' })).toBeDisabled()
  })
})
