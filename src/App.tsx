import { useEffect } from 'react'
import { QuickAccessWindow } from './app/quickAccessWindow'
import { SettingsWindow } from './app/settingsWindow'
import { VaultWindow } from './app/vaultWindow'

export function App() {
  const view = new URLSearchParams(window.location.search).get('view')

  // These are tools, not pages: the webview's own right-click menu offers reload, inspect element and
  // Save As, none of which belong in a password vault. Every window mounts through here, so one
  // listener covers all three, and the tag rows' own menu is a React handler that runs first.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => event.preventDefault()
    window.addEventListener('contextmenu', onContextMenu)
    return () => window.removeEventListener('contextmenu', onContextMenu)
  }, [])

  if (view === 'settings') {
    return <SettingsWindow />
  }
  if (view === 'quick-access') {
    return <QuickAccessWindow />
  }

  return <VaultWindow />
}
