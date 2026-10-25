import { describe, expect, it } from 'vitest'
import { isLastOpenVaultIn, openingVaultId, sameVaults, withLiveCounts } from './useVaultItems'
import type { LoginItemSummary, VaultSummary } from './vaultApi'

const vault = (id: string, archived = false): VaultSummary =>
  ({ archived, color: '', created_at: '', icon: 'vault', id, item_count: 0, name: id, updated_at: '' }) as VaultSummary

describe('the vault the window reads', () => {
  it('stays on an open vault, and otherwise opens the first open one — Rust’s unlock rule', () => {
    const vaults = [vault('personal'), vault('work')]
    expect(openingVaultId(vaults, 'work')).toBe('work')
    expect(openingVaultId(vaults, 'gone')).toBe('personal')
    expect(openingVaultId([vault('personal', true), vault('work')], 'personal')).toBe('work')
    expect(openingVaultId([vault('only', true)], 'personal')).toBe('only')
    expect(openingVaultId([], 'personal')).toBe('personal')
  })

  it('treats the one open vault as the one that can be neither archived nor dissolved', () => {
    const personal = vault('personal')
    const archivedWork = vault('work', true)
    expect(isLastOpenVaultIn([personal], personal)).toBe(true)
    expect(isLastOpenVaultIn([personal, archivedWork], personal)).toBe(true)
    // An archived vault can always be restored; with a second open vault either may go.
    expect(isLastOpenVaultIn([personal, archivedWork], archivedWork)).toBe(false)
    expect(isLastOpenVaultIn([personal, vault('work')], personal)).toBe(false)
  })
})

describe('the vault rows’ counts', () => {
  const row = (id: string, vault_id: string) => ({ id, vault_id }) as LoginItemSummary
  it('read each open vault’s count off the live rows, so a bulk trash of everything shows 0 at once', () => {
    // Rei 2026-10-25: list_vaults said 838 until a restart, while the list was already empty.
    const stale = [
      { ...vault('personal'), item_count: 838 },
      { ...vault('old', true), item_count: 5 },
    ]
    const counted = withLiveCounts(stale, [])
    expect(counted.map((entry) => entry.item_count)).toEqual([0, 5])
    expect(withLiveCounts(stale, [row('a', 'personal'), row('b', 'personal')])[0].item_count).toBe(2)
    // Before All has loaded the Rust count stands, and an unchanged count keeps the same array.
    expect(withLiveCounts(stale, null)).toBe(stale)
    const exact = [{ ...vault('personal'), item_count: 1 }]
    expect(withLiveCounts(exact, [row('a', 'personal')])).toBe(exact)
  })

  it('tells an unchanged re-read of the vaults from a changed one', () => {
    expect(sameVaults([vault('a')], [vault('a')])).toBe(true)
    expect(sameVaults([vault('a')], [{ ...vault('a'), item_count: 3 }])).toBe(false)
  })
})
