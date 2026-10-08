export type NavigationItem = {
  id: 'vaults' | 'favorites' | 'tags' | 'generator' | 'watchtower'
  label: string
  route: string
}

export const navigationItems: NavigationItem[] = [
  { id: 'vaults', label: 'Personal', route: '#vaults' },
  { id: 'favorites', label: 'Favorites', route: '#favorites' },
  { id: 'tags', label: 'Tags', route: '#tags' },
  { id: 'generator', label: 'Generator', route: '#generator' },
  { id: 'watchtower', label: 'Watchtower', route: '#watchtower' },
]
