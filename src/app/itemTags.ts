import { defaultTagColor } from './tagIcons'
import { parseTags, type Tag, tagsToInput } from './vaultApi'

export type TagCount = { count: number; key: string; name: string }
export type TagNavigation = `tag:${string}`
export type TagRow = { color: string; count: number; icon: string; key: string; name: string }

const tagNavigationPrefix = 'tag:'

// A tag row gets this on creation, in storage as well as here, so a tag that predates the icon column
// and one that has never been styled look the same.
export const defaultTagIcon = 'tag'

// Mirrors `normalized_tag_names` in `vault.rs`: tags are compared case-insensitively and the first
// spelling seen is the one that gets stored, so "Work" and "work" are one tag here too. Without that
// the sidebar would offer two rows that filter to the same items.
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase()
}

export function tagNavigationId(key: string): TagNavigation {
  return `${tagNavigationPrefix}${key}`
}

export function tagKeyFromNavigation(id: string): string | null {
  return id.startsWith(tagNavigationPrefix) ? id.slice(tagNavigationPrefix.length) : null
}

export function tagList(tagsInput: string): string[] {
  const seen = new Set<string>()
  return parseTags(tagsInput).filter((tag) => {
    if (seen.has(tagKey(tag))) return false
    seen.add(tagKey(tag))
    return true
  })
}

export function addTag(tagsInput: string, text: string): string {
  const tags = tagList(tagsInput)
  for (const candidate of parseTags(text)) {
    const key = tagKey(candidate)
    if (!tags.some((tag) => tagKey(tag) === key)) tags.push(candidate)
  }
  return tagsToInput(tags)
}

export function removeTag(tagsInput: string, tag: string): string {
  const key = tagKey(tag)
  return tagsToInput(tagList(tagsInput).filter((entry) => tagKey(entry) !== key))
}

export function countItemTags(items: readonly { tags: readonly string[] }[], locale: string): TagCount[] {
  const counts = new Map<string, TagCount>()
  for (const item of items) {
    for (const tag of item.tags) {
      const key = tagKey(tag)
      if (!key) continue
      const existing = counts.get(key)
      if (existing) existing.count += 1
      else counts.set(key, { count: 1, key, name: tag.trim() })
    }
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, locale))
}

export function filterItemsByTag<T extends { tags: readonly string[] }>(items: readonly T[], key: string): T[] {
  return items.filter((item) => item.tags.some((tag) => tagKey(tag) === key))
}

// Which tags the sidebar offers, and how many items each one names, comes from the live item list; the
// icon and hue come from the storage row. Joined here on the key both sides casefold to, so a count
// cannot disagree with what clicking that tag reveals.
export function tagRows(counts: readonly TagCount[], tags: readonly Tag[]): TagRow[] {
  const styled = new Map<string, Tag>()
  for (const tag of tags) styled.set(tagKey(tag.name), tag)
  return counts.map((count) => {
    const found = styled.get(count.key)
    return { ...count, color: found?.color ?? defaultTagColor, icon: found?.icon ?? defaultTagIcon }
  })
}
