export type Theme = 'light' | 'dark'
export type ThemeColorName =
  | 'slate'
  | 'gray'
  | 'zinc'
  | 'neutral'
  | 'stone'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose'

export type ThemeColor = {
  name: ThemeColorName
  label: string
  value: string
  text: string
  active: string
  activeText: string
}

export const themeColors: ThemeColor[] = [
  { active: '#475569', activeText: '#ffffff', label: 'Slate', name: 'slate', text: '#0f172a', value: '#94a3b8' },
  { active: '#4b5563', activeText: '#ffffff', label: 'Gray', name: 'gray', text: '#111827', value: '#9ca3af' },
  { active: '#52525b', activeText: '#ffffff', label: 'Zinc', name: 'zinc', text: '#18181b', value: '#a1a1aa' },
  { active: '#525252', activeText: '#ffffff', label: 'Neutral', name: 'neutral', text: '#171717', value: '#a3a3a3' },
  { active: '#57534e', activeText: '#ffffff', label: 'Stone', name: 'stone', text: '#1c1917', value: '#a8a29e' },
  { active: '#dc2626', activeText: '#ffffff', label: 'Red', name: 'red', text: '#450a0a', value: '#f87171' },
  { active: '#ea580c', activeText: '#ffffff', label: 'Orange', name: 'orange', text: '#431407', value: '#fb923c' },
  { active: '#d97706', activeText: '#ffffff', label: 'Amber', name: 'amber', text: '#451a03', value: '#fbbf24' },
  { active: '#ca8a04', activeText: '#ffffff', label: 'Yellow', name: 'yellow', text: '#422006', value: '#facc15' },
  { active: '#65a30d', activeText: '#ffffff', label: 'Lime', name: 'lime', text: '#1a2e05', value: '#a3e635' },
  { active: '#16a34a', activeText: '#ffffff', label: 'Green', name: 'green', text: '#052e16', value: '#4ade80' },
  { active: '#059669', activeText: '#ffffff', label: 'Emerald', name: 'emerald', text: '#022c22', value: '#34d399' },
  { active: '#0d9488', activeText: '#ffffff', label: 'Teal', name: 'teal', text: '#042f2e', value: '#2dd4bf' },
  { active: '#0891b2', activeText: '#ffffff', label: 'Cyan', name: 'cyan', text: '#083344', value: '#22d3ee' },
  { active: '#0284c7', activeText: '#ffffff', label: 'Sky', name: 'sky', text: '#082f49', value: '#38bdf8' },
  { active: '#2563eb', activeText: '#ffffff', label: 'Blue', name: 'blue', text: '#172554', value: '#60a5fa' },
  { active: '#4f46e5', activeText: '#ffffff', label: 'Indigo', name: 'indigo', text: '#1e1b4b', value: '#818cf8' },
  { active: '#7c3aed', activeText: '#ffffff', label: 'Violet', name: 'violet', text: '#2e1065', value: '#a78bfa' },
  { active: '#9333ea', activeText: '#ffffff', label: 'Purple', name: 'purple', text: '#3b0764', value: '#c084fc' },
  { active: '#c026d3', activeText: '#ffffff', label: 'Fuchsia', name: 'fuchsia', text: '#4a044e', value: '#e879f9' },
  { active: '#db2777', activeText: '#ffffff', label: 'Pink', name: 'pink', text: '#500724', value: '#f472b6' },
  { active: '#e11d48', activeText: '#ffffff', label: 'Rose', name: 'rose', text: '#4c0519', value: '#fb7185' },
]

export function getInitialTheme(savedTheme: string | null, prefersDark: boolean): Theme {
  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme
  }

  return prefersDark ? 'dark' : 'light'
}

export function getInitialThemeColor(savedColor: string | null): ThemeColorName {
  return themeColors.some((color) => color.name === savedColor) ? (savedColor as ThemeColorName) : 'slate'
}

export function getThemeColor(name: ThemeColorName): ThemeColor {
  return themeColors.find((color) => color.name === name) ?? themeColors[0]
}

export function applyThemeColor(name: ThemeColorName, root: HTMLElement = document.documentElement) {
  const color = getThemeColor(name)
  root.style.setProperty('--passless-sidebar-bg', color.value)
  root.style.setProperty('--passless-sidebar-text', color.text)
  root.style.setProperty('--passless-sidebar-active', color.active)
  root.style.setProperty('--passless-sidebar-active-text', color.activeText)
}
