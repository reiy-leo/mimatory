import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  Bookmark,
  BookOpen,
  Briefcase,
  Building2,
  Camera,
  Car,
  Cat,
  Cloud,
  Code,
  Coffee,
  CreditCard,
  Database,
  Dog,
  FileText,
  Film,
  Folder,
  Gift,
  Globe,
  Heart,
  Home,
  KeyRound,
  Lock,
  Mail,
  MapPin,
  Moon,
  Music,
  Palette,
  Pencil,
  Plane,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Sun,
  Tag,
  Terminal,
  Users,
  Vault,
  Wifi,
  Wrench,
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
  { icon: Sun, name: 'sun' },
  { icon: Moon, name: 'moon' },
  { icon: Lock, name: 'lock' },
  { icon: Globe, name: 'globe' },
  { icon: Bell, name: 'bell' },
  { icon: Camera, name: 'camera' },
  { icon: Cloud, name: 'cloud' },
  { icon: Code, name: 'code' },
  { icon: Building2, name: 'building' },
  { icon: Car, name: 'car' },
  { icon: Dog, name: 'dog' },
  { icon: Cat, name: 'cat' },
  { icon: BookOpen, name: 'book' },
  { icon: Pencil, name: 'pencil' },
  { icon: ShieldCheck, name: 'shield' },
  { icon: Smartphone, name: 'phone' },
  { icon: Wifi, name: 'wifi' },
  { icon: Database, name: 'database' },
  { icon: Mail, name: 'mail' },
  { icon: Server, name: 'server' },
  { icon: Terminal, name: 'terminal' },
  { icon: FileText, name: 'file' },
  { icon: Film, name: 'film' },
  { icon: Palette, name: 'palette' },
  { icon: Sparkles, name: 'sparkles' },
  { icon: Wrench, name: 'wrench' },
  // Also what a vault row shows: the `vaults.icon` column defaults to this name.
  { icon: Vault, name: 'vault' },
]

export function tagIconComponent(name: string): LucideIcon {
  return tagIconOptions.find((option) => option.name === name)?.icon ?? Tag
}

export const defaultTagColor = ''

// The design rules (.agent/design.md) reserve the system hues for decoration, tags among them, so a hue
// here is a label, never a status. The stored value is the bare hue because the classes are the
// renderer's business: an old vault's `teal` still means teal after a restyle.
export type TagColorOption = { iconClass: string; name: string; swatchClass: string }

// Written out one by one on purpose: Tailwind scans source text for whole class names, so a
// `text-accent-icon-${hue}` built at runtime would compile to nothing.
export const tagColorOptions: readonly TagColorOption[] = [
  { iconClass: '', name: defaultTagColor, swatchClass: 'tag-swatch-none' },
  { iconClass: 'text-accent-icon-gray', name: 'gray', swatchClass: 'bg-accent-icon-gray' },
  { iconClass: 'text-accent-icon-red', name: 'red', swatchClass: 'bg-accent-icon-red' },
  { iconClass: 'text-accent-icon-orange', name: 'orange', swatchClass: 'bg-accent-icon-orange' },
  { iconClass: 'text-accent-icon-yellow', name: 'yellow', swatchClass: 'bg-accent-icon-yellow' },
  { iconClass: 'text-accent-icon-green', name: 'green', swatchClass: 'bg-accent-icon-green' },
  { iconClass: 'text-accent-icon-lime', name: 'lime', swatchClass: 'bg-accent-icon-lime' },
  { iconClass: 'text-accent-icon-teal', name: 'teal', swatchClass: 'bg-accent-icon-teal' },
  { iconClass: 'text-accent-icon-blue', name: 'blue', swatchClass: 'bg-accent-icon-blue' },
  { iconClass: 'text-accent-icon-purple', name: 'purple', swatchClass: 'bg-accent-icon-purple' },
  { iconClass: 'text-accent-icon-magenta', name: 'magenta', swatchClass: 'bg-accent-icon-magenta' },
]

export function tagColorClass(color: string): string {
  return tagColorOptions.find((option) => option.name === color)?.iconClass ?? ''
}

export function tagColorLabelKey(color: string): string {
  return `tagColors.${color === defaultTagColor ? 'none' : color}`
}
