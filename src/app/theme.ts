/**
 * Appearance always follows the system (owner 2026-10-23: "深浅主题只保留跟随系统，设置中不能设置"; dark-mode.md:
 * "Avoid offering an app-specific appearance setting"). There is no in-app override and nothing is stored.
 */
export type Appearance = 'light' | 'dark'

const darkQuery = '(prefers-color-scheme: dark)'

/** Where builds before 2026-10-23 kept the Light / Dark / System choice; read only to delete it. */
export const legacyThemeStorageKey = 'passless-theme'

export function resolveAppearance(prefersDark: boolean): Appearance {
  return prefersDark ? 'dark' : 'light'
}

/**
 * Drops a stored Light/Dark override from an older build, so an existing install goes back to the system
 * appearance (those builds wrote the resolved value on first launch, so most installs carry one).
 */
export function clearLegacyThemeOverride(storage: Pick<Storage, 'removeItem'> = localStorage) {
  try {
    storage.removeItem(legacyThemeStorageKey)
  } catch {
    // Storage can be unavailable (private mode, a locked-down webview); there is then nothing to clear.
  }
}

/**
 * Writes the system appearance to `<html data-theme>` (the selector the tokens and Tailwind's `dark` variant
 * key on) and keeps it in step with the OS while the window is open. Returns the cleanup that stops following.
 */
export function followSystemAppearance(root: HTMLElement = document.documentElement): () => void {
  const media = window.matchMedia(darkQuery)
  const update = () => {
    root.dataset.theme = resolveAppearance(media.matches)
  }
  update()
  media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
}
