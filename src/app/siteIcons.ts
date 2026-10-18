import { useSyncExternalStore } from 'react'
import { type CachedSiteIcon, type LoginItem, vaultApi } from './vaultApi'

// Website icons for item tiles. Rust fetches each one (Google's favicon service first, then the site itself)
// and keeps it encrypted in the vault (favicon.rs); this module decides *which* sites to ask about, remembers the answers
// for the window's lifetime and hands each tile its data URL. Nothing here talks to the network.

// The "Download website icons" setting. Device-local like the theme and language, on by default.
export const siteIconsPreferenceKey = 'passless-site-icons'

export function readSiteIconsEnabled(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage) {
  return storage?.getItem(siteIconsPreferenceKey) !== 'off'
}

export function writeSiteIconsEnabled(enabled: boolean, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(siteIconsPreferenceKey, enabled ? 'on' : 'off')
  enabledListeners.forEach((listener) => {
    listener()
  })
}

const enabledListeners = new Set<() => void>()

function subscribeEnabled(listener: () => void) {
  enabledListeners.add(listener)
  // Another window (Settings) flipping the switch arrives as a storage event.
  const onStorage = (event: StorageEvent) => {
    if (event.key === siteIconsPreferenceKey) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    enabledListeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useSiteIconsEnabled(): boolean {
  return useSyncExternalStore(subscribeEnabled, () => readSiteIconsEnabled())
}

// The host an address belongs to, if it is a website worth asking: http(s) or a bare host, a name
// with a dot in it, never an IP literal or `localhost`. Rust applies the same rule again.
export function websiteHost(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  // `mailto:`, `tel:`, `otpauth:`… — a scheme without `//` that is not a port number.
  if (!hasScheme && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value)) return null
  let url: URL
  try {
    url = new URL(hasScheme ? value : `https://${value}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host)) return null
  if (!/^[a-z0-9.-]+$/.test(host)) return null
  return host
}

// The site an item's tile shows the icon of: its first address, the same one the list and the
// browser bridge treat as primary.
export function siteIconDomain(item: Pick<LoginItem, 'urls' | 'website'>): string | null {
  const first = item.website || item.urls[0]?.url || ''
  return websiteHost(first)
}

// Whether an item shows a website icon at all: it has a site and the user has not asked for the
// letter tile on it.
export function itemIconDomain(item: Pick<LoginItem, 'icon_mode' | 'urls' | 'website'>): string | null {
  return item.icon_mode === 'letter' ? null : siteIconDomain(item)
}

export function uniqueIconDomains(items: Array<Pick<LoginItem, 'icon_mode' | 'urls' | 'website'>>): string[] {
  return [...new Set(items.map(itemIconDomain).filter((domain): domain is string => Boolean(domain)))]
}

// Which of these sites to fetch now: never asked (absent from the cache) or asked long enough ago.
export function domainsToFetch(domains: string[], cached: Record<string, CachedSiteIcon>): string[] {
  return domains.filter((domain) => !cached[domain]?.fresh)
}

// --- The window's icon store -------------------------------------------------------------------

const icons = new Map<string, string | null>()
const iconListeners = new Set<() => void>()
const inFlight = new Map<string, Promise<string | null>>()
const queue: Array<{ domain: string; force: boolean; resolve: (icon: string | null) => void }> = []
let active = 0
// A slow site only ever holds up one of these, never the list.
const maxConcurrentFetches = 2

function publish(domain: string, icon: string | null) {
  icons.set(domain, icon)
  iconListeners.forEach((listener) => {
    listener()
  })
}

function subscribeIcons(listener: () => void) {
  iconListeners.add(listener)
  return () => {
    iconListeners.delete(listener)
  }
}

export function useSiteIcon(domain: string | null): string | null {
  return useSyncExternalStore(subscribeIcons, () => (domain ? (icons.get(domain) ?? null) : null))
}

function pump() {
  while (active < maxConcurrentFetches && queue.length) {
    const job = queue.shift() as (typeof queue)[number]
    active += 1
    vaultApi
      .fetchSiteIcon(job.domain, job.force)
      .catch(() => null)
      .then((icon) => {
        // A failed refetch of a stale icon keeps the one already on screen.
        if (icon || !icons.get(job.domain)) publish(job.domain, icon)
        job.resolve(icon)
      })
      .finally(() => {
        active -= 1
        inFlight.delete(job.domain)
        pump()
      })
  }
}

function enqueueFetch(domain: string, force: boolean): Promise<string | null> {
  const pending = inFlight.get(domain)
  if (pending && !force) return pending
  const promise = new Promise<string | null>((resolve) => {
    queue.push({ domain, force, resolve })
  })
  inFlight.set(domain, promise)
  pump()
  return promise
}

// Reads what the vault already holds for these sites, shows it, and — when downloading is on —
// asks the sites that were never fetched or whose answer is old.
export async function loadSiteIcons(domains: string[], { download }: { download: boolean }) {
  const unknown = domains.filter((domain) => !icons.has(domain) && !inFlight.has(domain))
  if (!unknown.length) return
  let cached: Record<string, CachedSiteIcon> = {}
  try {
    cached = await vaultApi.cachedSiteIcons(unknown)
  } catch {
    return
  }
  for (const [domain, entry] of Object.entries(cached)) publish(domain, entry.icon)
  if (!download) return
  for (const domain of domainsToFetch(unknown, cached)) void enqueueFetch(domain, false)
}

// "Refresh Icon": ask the site again even if the cached answer is recent.
export function refreshSiteIcon(domain: string): Promise<string | null> {
  return enqueueFetch(domain, true)
}

// The setting was turned off: drop every icon this window holds (the vault copy is cleared by Rust).
export function forgetSiteIcons() {
  queue.length = 0
  icons.clear()
  iconListeners.forEach((listener) => {
    listener()
  })
}
