export type NavigationItem = {
  // Archived and trash are held-out-of-the-vault views, so they sit at the foot of the sidebar
  // rather than next to the two views that show what is in it.
  group: 'vault' | 'footer'
  id: 'vaults' | 'favorites' | 'archived' | 'trash'
  label: string
  route: string
}

export const navigationItems: NavigationItem[] = [
  { group: 'vault', id: 'vaults', label: 'Personal', route: '#vaults' },
  { group: 'vault', id: 'favorites', label: 'Favorites', route: '#favorites' },
  { group: 'footer', id: 'archived', label: 'Archived', route: '#archived' },
  { group: 'footer', id: 'trash', label: 'Trash', route: '#trash' },
]
