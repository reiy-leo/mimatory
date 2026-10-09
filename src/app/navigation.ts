export type NavigationItem = {
  id: 'vaults' | 'favorites' | 'trash'
  label: string
  route: string
}

export const navigationItems: NavigationItem[] = [
  { id: 'vaults', label: 'Personal', route: '#vaults' },
  { id: 'favorites', label: 'Favorites', route: '#favorites' },
  { id: 'trash', label: 'Trash', route: '#trash' },
]
