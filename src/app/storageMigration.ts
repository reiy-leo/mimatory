/**
 * The app was renamed Passless → Mimatory on 2026-10-23 (owner: "名称以后都统一成mimatory，不再使用passless").
 * Every preference key in localStorage moved from `passless-*` to `mimatory-*`; this carries an existing
 * install's values across once, before anything reads them (it is main.tsx's first import, so it runs ahead
 * of i18n's language read). A value already under the new key wins and the old key is only deleted.
 * `passless-theme` is left alone: theme.ts deletes it (appearance follows the system since 2026-10-23).
 */
export const legacyStoragePrefix = 'passless-'
export const storagePrefix = 'mimatory-'
const skippedLegacyKeys = new Set(['passless-theme'])

type MigratableStorage = Pick<Storage, 'getItem' | 'key' | 'length' | 'removeItem' | 'setItem'>

export function migrateLegacyStorageKeys(storage: MigratableStorage): string[] {
  const legacyKeys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(legacyStoragePrefix) && !skippedLegacyKeys.has(key)) legacyKeys.push(key)
  }
  const moved: string[] = []
  for (const legacyKey of legacyKeys) {
    const value = storage.getItem(legacyKey)
    const key = storagePrefix + legacyKey.slice(legacyStoragePrefix.length)
    if (value !== null && storage.getItem(key) === null) {
      storage.setItem(key, value)
      moved.push(key)
    }
    storage.removeItem(legacyKey)
  }
  return moved
}

try {
  if (typeof globalThis.localStorage !== 'undefined') migrateLegacyStorageKeys(globalThis.localStorage)
} catch {
  // Storage can be unavailable (private mode, a locked-down webview); there is then nothing to carry over.
}
