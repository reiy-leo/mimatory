/**
 * Full-colour art for each item type, drawn in the New Item picker (owner 2026-10-18, after 1Password's picker;
 * the artwork itself is Microsoft Fluent Emoji, MIT — see src/assets/item-icons/LICENSE, never 1Password's).
 * One SVG per type, named after the type, so a new type's file is found by name.
 */
const files = import.meta.glob<string>('../assets/item-icons/*.svg', { eager: true, import: 'default', query: '?url' })

export const itemTypeArt: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), url]),
)

/** The art for a type, or null for a type with no file (the picker then keeps the line glyph). */
export function itemTypeArtFor(itemType: string): string | null {
  return itemTypeArt[itemType] ?? null
}
