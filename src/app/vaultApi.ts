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
}

export type VaultSummary = {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export type UrlMatchType = 'domain' | 'exact'

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

export type LoginItemInput = Omit<LoginItem, 'id' | 'updated_at'>

export type PasswordGeneratorOptions = {
  length: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
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
  canUseBiometrics: () => invoke<boolean>('can_use_biometrics'),
  checkBreaches: () => invoke<BreachCheckResult>('check_breached_passwords'),
  create: (input: LoginItemInput) => invoke<LoginItem>('create_login_item', { input }),
  createVault: (name: string) => invoke<VaultSummary>('create_vault', { name }),
  exportAttachmentToTemp: (id: string) => invoke<string>('export_attachment_to_temp', { id }),
  favorite: (id: string, favorite: boolean) => invoke<void>('set_login_favorite', { favorite, id }),
  generateBrowserPairingToken: () => invoke<string>('generate_browser_pairing_token'),
  generatePassword: (options: PasswordGeneratorOptions) => invoke<string>('generate_password_command', { options }),
  generateTotp: (secret: string) => invoke<TotpCode>('generate_totp_code', { secret }),
  hideQuickAccess: () => invoke<void>('hide_quick_access'),
  initialize: () => invoke<AppStatus>('initialize_database'),
  isAutostartEnabled: () => invoke<boolean>('is_autostart_enabled'),
  list: (query?: string) => invoke<LoginItem[]>('list_login_items', { query: query || null }),
  listVaults: () => invoke<VaultSummary[]>('list_vaults'),
  lock: () => invoke<void>('lock_vault'),
  passwordStrength: (password: string) => invoke<PasswordStrength>('password_strength', { password }),
  pickAttachmentFile: () => invoke<string | null>('pick_attachment_file'),
  purge: (id: string) => invoke<void>('purge_login_item', { id }),
  restore: (id: string) => invoke<void>('restore_login_item', { id }),
  restoreFromTrash: (id: string) => invoke<void>('restore_trashed_login_item', { id }),
  setAutostart: (enabled: boolean) => invoke<void>('set_autostart', { enabled }),
  setup: (password: string) => invoke<LoginItem[]>('setup_master_password', { password }),
  switchVault: (id: string) => invoke<LoginItem[]>('switch_vault', { id }),
  trash: (id: string) => invoke<void>('trash_login_item', { id }),
  trashed: () => invoke<LoginItem[]>('list_trashed_login_items'),
  unlock: (password: string) => invoke<LoginItem[]>('unlock_vault', { password }),
  unlockWithBiometrics: () => invoke<LoginItem[]>('unlock_with_biometrics'),
  update: (id: string, input: LoginItemInput) => invoke<LoginItem>('update_login_item', { input: { id, ...input } }),
  watchtower: () => invoke<WatchtowerReport>('watchtower_report'),
}
