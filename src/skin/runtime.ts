import { useSyncExternalStore } from 'react'
import { type LayoutKind, type PlatformState, readOverrides, resolvePlatformState } from './platform'

/**
 * The resolved platform, skin and layout for this window, mirrored onto `<html data-platform data-skin
 * data-layout>` — the only selectors the skin stylesheets (src/skin/*.css) key on. Platform and skin are fixed
 * for the life of the page; layout follows the window width.
 */
let state: PlatformState | null = null
const listeners = new Set<() => void>()

function navigatorLike() {
  return navigator as Navigator & { userAgentData?: { platform?: string } }
}

function resolve(): PlatformState {
  return resolvePlatformState(navigatorLike(), window.innerWidth, readOverrides(window.location.search))
}

function write(root: HTMLElement, next: PlatformState) {
  root.dataset.platform = next.platform
  root.dataset.skin = next.skin
  root.dataset.layout = next.layout
}

export function applyPlatformAttributes(root: HTMLElement = document.documentElement) {
  state = resolve()
  write(root, state)
  window.addEventListener('resize', () => {
    const next = resolve()
    if (!state || next.layout === state.layout) return
    state = next
    write(root, state)
    for (const listener of listeners) listener()
  })
}

export function currentPlatformState(): PlatformState {
  if (!state) state = resolve()
  return state
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePlatformState(): PlatformState {
  return useSyncExternalStore(subscribe, currentPlatformState, currentPlatformState)
}

export function useLayout(): LayoutKind {
  return usePlatformState().layout
}
