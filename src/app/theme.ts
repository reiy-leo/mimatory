export type Theme = 'light' | 'dark'

export function getInitialTheme(savedTheme: string | null, prefersDark: boolean): Theme {
  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme
  }

  return prefersDark ? 'dark' : 'light'
}
