/**
 * Appearance follows the system by default (dark-mode.md: people expect an app to respond to their
 * systemwide appearance choice). `light` and `dark` remain as explicit overrides.
 */
export type Theme = 'system' | 'light' | 'dark'
export type Appearance = 'light' | 'dark'

export const themeOptions: Theme[] = ['system', 'light', 'dark']

const darkQuery = '(prefers-color-scheme: dark)'

export function getInitialTheme(savedTheme: string | null): Theme {
  if (savedTheme === 'system' || savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme
  }

  return 'system'
}

export function resolveAppearance(theme: Theme, prefersDark: boolean): Appearance {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light'
  }

  return theme
}

/**
 * Writes the resolved appearance to `<html data-theme>` (the selector the tokens and Tailwind's
 * `dark` variant key on) and, for `system`, keeps it in step with the OS while the window is open.
 * Returns the cleanup that stops following the OS.
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): () => void {
  const media = window.matchMedia(darkQuery)
  const update = () => {
    root.dataset.theme = resolveAppearance(theme, media.matches)
  }
  update()
  if (theme !== 'system') {
    return () => {}
  }
  media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
}
