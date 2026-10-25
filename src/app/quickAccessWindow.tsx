import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Search, X } from 'lucide-react'
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlatformState } from '../skin/runtime'
import { copyText } from './clipboard'
import { applyLanguagePreference, type LanguagePreference } from './i18n'
import { ItemIcon } from './itemIcon'
import { isPrimaryModifier, shortcutLabel } from './platformFeatures'
import { loadSecurityPreferences } from './securityPreferences'
import { useSignInLabel } from './signInControls'
import { summarySignInProvider } from './signInProviders'
import { loadSiteIcons, uniqueIconDomains, useSiteIconsEnabled } from './siteIcons'
import { followSystemAppearance } from './theme'
import { otpSecretFieldIndexes } from './totpDisplay'
import { type LoginItemSummary, vaultApi } from './vaultApi'

export const quickAccessMaxResults = 8

export const quickAccessCloseDelayMs = 400

export function QuickAccessWindow() {
  const { t } = useTranslation()
  const { platform } = usePlatformState()
  const [items, setItems] = useState<LoginItemSummary[]>([])
  const [query, setQuery] = useState('')
  const [locked, setLocked] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | null>(null)

  const signInLabel = useSignInLabel()
  const siteIconsEnabled = useSiteIconsEnabled()
  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const matches = normalizedQuery
      ? items.filter(
          (item) =>
            item.title.toLowerCase().includes(normalizedQuery) ||
            item.username.toLowerCase().includes(normalizedQuery) ||
            item.website.toLowerCase().includes(normalizedQuery),
        )
      : items
    return matches.slice(0, quickAccessMaxResults)
  }, [items, query])

  // The panel only reads icons the main window already fetched; it never starts a download itself.
  useEffect(() => {
    if (siteIconsEnabled && results.length) void loadSiteIcons(uniqueIconDomains(results), { download: false })
  }, [results, siteIconsEnabled])

  async function refresh() {
    try {
      const nextStatus = await vaultApi.initialize()
      setLocked(!nextStatus.unlocked)
      setItems(nextStatus.unlocked ? await vaultApi.list() : [])
    } catch {
      // Locking between the two calls fails here too, so drop everything rather than
      // leaving secrets from the previous session on screen.
      setLocked(true)
      setItems([])
    }
  }

  // Same clipboard rules as the main window: a password or code is cleared after 90 seconds when the
  // Security setting asks for it (read fresh, since Settings may have changed it while the panel was hidden).
  // The list carries summaries only, so a password or a one-time code is read from the one item at copy time.
  async function copyFromItem(row: LoginItemSummary, kind: 'otp' | 'password' | 'username') {
    const item = kind === 'username' ? null : await vaultApi.getItem(row.id, row.vault_id).catch(() => null)
    let value = kind === 'username' ? row.username : kind === 'password' ? (item?.password ?? '') : ''
    if (kind === 'otp' && item) {
      const index = otpSecretFieldIndexes(item.custom_fields)[0]
      const secret = index === undefined ? '' : (item.custom_fields[index]?.value ?? '')
      if (secret.trim()) value = (await vaultApi.generateTotp(secret).catch(() => null))?.code ?? ''
    }
    const copied = await copyText(value, {
      clearAfter90Seconds: loadSecurityPreferences().clearClipboardAfter90Seconds,
      sensitive: kind !== 'username',
    })
    if (!copied) return
    setCopiedId(row.id)
    hideTimerRef.current = window.setTimeout(() => void vaultApi.hideQuickAccess(), quickAccessCloseDelayMs)
  }

  async function copyPassword(item: LoginItemSummary) {
    await copyFromItem(item, 'password')
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      void vaultApi.hideQuickAccess()
      return
    }
    if (results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((current) => (current + 1) % results.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((current) => (current - 1 + results.length) % results.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const item = results[selectedIndex]
      if (item) void copyPassword(item)
      return
    }
    // 1Password's Quick Access keys: ⌘C username, ⇧⌘C password, ⌥⌘C one-time password (Ctrl elsewhere).
    // Text selected in the search field keeps ⌘C as a plain copy.
    if (event.code !== 'KeyC' || !isPrimaryModifier(event, platform)) return
    const input = event.target instanceof HTMLInputElement ? event.target : null
    if (input && input.selectionStart !== input.selectionEnd) return
    const item = results[selectedIndex]
    if (!item) return
    event.preventDefault()
    void copyFromItem(item, event.altKey ? 'otp' : event.shiftKey ? 'password' : 'username')
  }

  useEffect(() => followSystemAppearance(), [])

  useEffect(() => setSelectedIndex(0), [query])

  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  useEffect(() => {
    let unlistenLanguage: (() => void) | undefined
    listen<LanguagePreference>(
      'mimatory-language-changed',
      (event) => void applyLanguagePreference(event.payload),
    ).then((nextUnlisten) => {
      unlistenLanguage = nextUnlisten
    })
    return () => {
      unlistenLanguage?.()
    }
  }, [])

  useEffect(() => {
    let unlistenOpened: (() => void) | undefined
    let unlistenFocus: (() => void) | undefined

    inputRef.current?.focus()
    void refresh()

    listen('quick-access:opened', () => {
      setQuery('')
      setSelectedIndex(0)
      setCopiedId(null)
      inputRef.current?.focus()
      void refresh()
    }).then((nextUnlisten) => {
      unlistenOpened = nextUnlisten
    })

    // An overlay you have to remember to close is a secret sitting on screen, so it
    // goes away as soon as focus moves elsewhere.
    getCurrentWebviewWindow()
      .onFocusChanged(({ payload }) => {
        if (!payload) void vaultApi.hideQuickAccess()
      })
      .then((nextUnlisten) => {
        unlistenFocus = nextUnlisten
      })

    return () => {
      unlistenOpened?.()
      unlistenFocus?.()
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    }
  }, [])

  return (
    <main className="quick-access-shell" onKeyDown={handleKeyDown}>
      <header className="quick-access-header" data-tauri-drag-region>
        <h1>{t('quickAccess.title')}</h1>
        <button className="quick-access-close" onClick={() => void vaultApi.hideQuickAccess()} type="button">
          <X size={16} />
        </button>
      </header>

      <div className="quick-access-search" data-tauri-drag-region>
        <Search size={16} />
        <input
          aria-label={t('quickAccess.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('quickAccess.searchPlaceholder')}
          ref={inputRef}
          value={query}
        />
      </div>

      {locked ? (
        <p className="quick-access-message">{t('quickAccess.unlockPrompt')}</p>
      ) : (
        <div className="quick-access-list" ref={listRef}>
          {results.map((item, index) => (
            <button
              className="quick-access-row"
              data-row={index}
              data-selected={index === selectedIndex}
              key={item.id}
              onClick={() => void copyPassword(item)}
              type="button"
            >
              <ItemIcon item={item} />
              <strong>{item.title}</strong>
              <small>
                {item.username || (summarySignInProvider(item) ? signInLabel(summarySignInProvider(item)) : '')}
              </small>
              {copiedId === item.id ? <span className="quick-access-badge">{t('quickAccess.copied')}</span> : null}
            </button>
          ))}
          {results.length === 0 ? <p className="quick-access-message">{t('quickAccess.empty')}</p> : null}
        </div>
      )}

      <footer className="quick-access-footer" data-tauri-drag-region>
        <span>{t('quickAccess.copyHint')}</span>
        <span>
          {t('quickAccess.copyKeysHint', {
            otp: shortcutLabel('mod+alt+c', platform),
            password: shortcutLabel('mod+shift+c', platform),
            username: shortcutLabel('mod+c', platform),
          })}
        </span>
      </footer>
    </main>
  )
}
