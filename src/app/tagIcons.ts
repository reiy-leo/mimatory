import type { LucideIcon } from 'lucide-react'
import {
  Bookmark,
  Briefcase,
  Coffee,
  CreditCard,
  Folder,
  Gift,
  Heart,
  Home,
  KeyRound,
  MapPin,
  Music,
  Plane,
  Star,
  Tag,
  Users,
  Zap,
} from 'lucide-react'

export type TagIconOption = { icon: LucideIcon; name: string }

// A tag's icon is stored as one of these names rather than as a component or a glyph, so a value written
// by an older build still resolves. `update_tag` stores whatever name the picker sends, so the fallback
// below is what keeps a hand-edited or stale row from rendering nothing.
export const tagIconOptions: readonly TagIconOption[] = [
  { icon: Tag, name: 'tag' },
  { icon: Star, name: 'star' },
  { icon: Heart, name: 'heart' },
  { icon: Bookmark, name: 'bookmark' },
  { icon: KeyRound, name: 'key' },
  { icon: Briefcase, name: 'briefcase' },
  { icon: Users, name: 'users' },
  { icon: Home, name: 'home' },
  { icon: Folder, name: 'folder' },
  { icon: CreditCard, name: 'credit-card' },
  { icon: Gift, name: 'gift' },
  { icon: Plane, name: 'plane' },
  { icon: MapPin, name: 'map-pin' },
  { icon: Coffee, name: 'coffee' },
  { icon: Music, name: 'music' },
  { icon: Zap, name: 'zap' },
]

export function tagIconComponent(name: string): LucideIcon {
  return tagIconOptions.find((option) => option.name === name)?.icon ?? Tag
}
