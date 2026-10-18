import { invoke } from '@tauri-apps/api/core'

export type AppStatus = {
  name: string
  database_ready: boolean
  has_master_password: boolean
  unlocked: boolean
}

export type LoginItem = {
  id: string
  item_type: string
  title: string
  username: string
  password: string
  website: string
  urls: ItemUrl[]
  notes: string
  tags: string[]
  custom_fields: CustomField[]
  favorite: boolean
  updated_at: string
  // Left out of the payload when the item has no links (and by the browser bridge entirely).
  relations?: ItemRelations
  // Absent means `auto`: the website icon when the item has a site and one was found.
  icon_mode?: ItemIconMode
}

export type ItemIconMode = 'auto' | 'letter'

// One cached website icon: a PNG data URL (or null for a site that had none) and whether it is recent
// enough not to ask the site again. A site never fetched is simply absent from the answer.
export type CachedSiteIcon = {
  fresh: boolean
  icon: string | null
}

// A plain-text attachment decoded by Rust for the preview sheet (lossy UTF-8, cut at 256KB).
export type AttachmentText = {
  file_name: string
  lossy: boolean
  text: string
  total_bytes: number
  truncated: boolean
}

// One linked item, as much as the detail pane needs to draw it and navigate to it.
export type RelatedItemRef = {
  archived: boolean
  id: string
  item_type: string
  title: string
}

// A child belongs to its parent (one parent, no cycles); a related item is a peer, linked both ways.
export type ItemRelations = {
  children: RelatedItemRef[]
  parent: RelatedItemRef | null
  related: RelatedItemRef[]
  // The account this item signs in with, and the items that sign in with this one. Both are left out
  // of the payload when empty.
  sign_in_with?: RelatedItemRef | null
  signs_in_to?: RelatedItemRef[]
}

export type VaultSummary = {
  id: string
  name: string
  created_at: string
  updated_at: string
  // The same two columns a tag carries, so a sidebar that lists every vault side by side can tell
  // them apart without reading their names.
  icon: string
  color: string
  archived: boolean
  item_count: number
}

/** Autofill behaviour per website (1Password 8): anywhere on the site (default), this exact host, or never. */
export type UrlMatchType = 'domain' | 'exact' | 'never'

/** Where an address fills under each behaviour, computed in Rust (`site_match::describe`). */
export type WebsiteScope = {
  /** The host with an explicit port: what "exact host" fills on. */
  host: string
  /** The registrable domain "anywhere on this website" fills on. */
  domain: string
  /** Bundled related domains (apple.com ↔ icloud.com) fill too. */
  related: boolean
  /** False for an IP address or a public-suffix host: there are no subdomains to reach. */
  subdomains: boolean
}

export type ItemUrl = {
  label: string
  url: string
  match_type: UrlMatchType
}

export type CustomField = {
  label: string
  value: string
  field_type: string
}

export type LoginItemInput = Omit<LoginItem, 'icon_mode' | 'id' | 'relations' | 'updated_at'>

export type PasswordGeneratorMode = 'passphrase' | 'pin' | 'random'

export type PasswordGeneratorOptions = {
  length: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
  exclude_ambiguous: boolean
  mode: PasswordGeneratorMode
  words: number
}

// The password field's own key button always makes a strong random one; the generator panel is
// where the modes live, and a PIN is not what that button should ever insert.
export const randomGeneratorOptions: PasswordGeneratorOptions = {
  exclude_ambiguous: true,
  length: 24,
  lowercase: true,
  mode: 'random',
  numbers: true,
  symbols: true,
  uppercase: true,
  words: 4,
}

export type PasswordStrength = {
  bits: number
  level: 'excellent' | 'fair' | 'strong' | 'weak'
}

export type WatchtowerReport = {
  total_items: number
  weak_passwords: string[]
  reused_passwords: string[]
  missing_websites: string[]
  missing_totp: string[]
  expiring_items: string[]
  score: number
}

export type BreachCheckResult = {
  breached_passwords: string[]
}

export type Tag = {
  color: string
  icon: string
  name: string
}

export type TotpCode = {
  code: string
  seconds_remaining: number
}

export function emptyLoginItem(): LoginItemInput {
  return {
    custom_fields: [],
    favorite: false,
    item_type: 'login',
    notes: '',
    password: '',
    tags: [],
    title: '',
    urls: [],
    username: '',
    website: '',
  }
}

export function parseCustomFields(value: string): CustomField[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, ...rest] = line.split(':')
      return {
        field_type: 'text',
        label: label.trim(),
        value: rest.join(':').trim(),
      }
    })
    .filter((field) => field.label && field.value)
}

export function customFieldsToInput(fields: CustomField[]): string {
  return fields.map((field) => `${field.label}: ${field.value}`).join('\n')
}

export function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export function tagsToInput(tags: string[]): string {
  return tags.join(', ')
}

export const vaultApi = {
  archive: (id: string) => invoke<void>('archive_login_item', { id }),
  archived: () => invoke<LoginItem[]>('list_archived_login_items'),
  attachFileToItem: (id: string, path: string) => invoke<CustomField>('attach_file_to_item', { id, path }),
  // Website icons the vault already holds, for these sites. Never touches the network.
  cachedSiteIcons: (domains: string[]) => invoke<Record<string, CachedSiteIcon>>('cached_site_icons', { domains }),
  canUseBiometrics: () => invoke<boolean>('can_use_biometrics'),
  checkBreaches: () => invoke<BreachCheckResult>('check_breached_passwords'),
  clearSiteIcons: () => invoke<void>('clear_site_icons'),
  create: (input: LoginItemInput) => invoke<LoginItem>('create_login_item', { input }),
  createVault: (name: string) => invoke<VaultSummary>('create_vault', { name }),
  deleteTag: (name: string) => invoke<void>('delete_tag', { name }),
  describeWebsite: (url: string) => invoke<WebsiteScope | null>('describe_website', { url }),
  // An empty vault needs nowhere to send its items, so `intoId` is null for that one case only.
  dissolveVault: (id: string, intoId: string | null) => invoke<void>('dissolve_vault', { id, intoId }),
  duplicate: (id: string, title: string) => invoke<LoginItem>('duplicate_login_item', { id, title }),
  exportAttachmentToTemp: (id: string) => invoke<string>('export_attachment_to_temp', { id }),
  favorite: (id: string, favorite: boolean) => invoke<void>('set_login_favorite', { favorite, id }),
  // Asks Google's favicon service, then the site (Rust, favicon.rs), and caches the answer; `force` ignores a recent one.
  fetchSiteIcon: (domain: string, force: boolean) => invoke<string | null>('fetch_site_icon', { domain, force }),
  generateBrowserPairingToken: () => invoke<string>('generate_browser_pairing_token'),
  generatePassword: (options: PasswordGeneratorOptions) => invoke<string>('generate_password_command', { options }),
  generateTotp: (secret: string) => invoke<TotpCode>('generate_totp_code', { secret }),
  hideQuickAccess: () => invoke<void>('hide_quick_access'),
  initialize: () => invoke<AppStatus>('initialize_database'),
  isAutostartEnabled: () => invoke<boolean>('is_autostart_enabled'),
  // Peer links are stored on both items, so either end unlinks both.
  linkRelated: (id: string, otherId: string) => invoke<void>('link_related_items', { id, otherId }),
  list: (query?: string) => invoke<LoginItem[]>('list_login_items', { query: query || null }),
  listVaults: () => invoke<VaultSummary[]>('list_vaults'),
  lock: () => invoke<void>('lock_vault'),
  // The item leaves the vault the session is reading; this does not switch the app to the target.
  move: (id: string, vaultId: string) => invoke<void>('move_login_item', { id, vaultId }),
  passwordStrength: (password: string) => invoke<PasswordStrength>('password_strength', { password }),
  pickAttachmentFile: () => invoke<string | null>('pick_attachment_file'),
  purge: (id: string) => invoke<void>('purge_login_item', { id }),
  // Decrypted in memory only, unlike exportAttachmentToTemp, which writes a file.
  readAttachmentText: (id: string) => invoke<AttachmentText>('read_attachment_text', { id }),
  restore: (id: string) => invoke<void>('restore_login_item', { id }),
  restoreFromTrash: (id: string) => invoke<void>('restore_trashed_login_item', { id }),
  setAutostart: (enabled: boolean) => invoke<void>('set_autostart', { enabled }),
  // `parentId: null` clears the parent. Rust refuses itself, a cycle, and an item in the trash.
  setIconMode: (id: string, mode: ItemIconMode) => invoke<void>('set_item_icon_mode', { id, mode }),
  setParent: (id: string, parentId: string | null) => invoke<void>('set_item_parent', { id, parentId }),
  // `accountId: null` clears it. Rust refuses itself and an item outside this vault or in the trash.
  setSignIn: (id: string, accountId: string | null) => invoke<void>('set_item_sign_in', { accountId, id }),
  setup: (password: string) => invoke<LoginItem[]>('setup_master_password', { password }),
  // Archiving a vault archives what is in it too, so the items land in the view that already exists.
  setVaultArchived: (archived: boolean, id: string) => invoke<void>('set_vault_archived', { archived, id }),
  switchVault: (id: string) => invoke<LoginItem[]>('switch_vault', { id }),
  tags: () => invoke<Tag[]>('list_tags'),
  trash: (id: string) => invoke<void>('trash_login_item', { id }),
  trashed: () => invoke<LoginItem[]>('list_trashed_login_items'),
  unlinkRelated: (id: string, otherId: string) => invoke<void>('unlink_related_items', { id, otherId }),
  unlock: (password: string) => invoke<LoginItem[]>('unlock_vault', { password }),
  unlockWithBiometrics: () => invoke<LoginItem[]>('unlock_with_biometrics'),
  update: (id: string, input: LoginItemInput) => invoke<LoginItem>('update_login_item', { input: { id, ...input } }),
  updateTag: (patch: Tag & { from: string }) => invoke<void>('update_tag', patch),
  // One patch object rather than four positionals, for the same reason the tag editor takes one.
  updateVault: (patch: Pick<VaultSummary, 'color' | 'icon' | 'id' | 'name'>) => invoke<void>('update_vault', patch),
  watchtower: () => invoke<WatchtowerReport>('watchtower_report'),
}
