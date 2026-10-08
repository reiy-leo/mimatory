import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  AlertCircle,
  BadgeCheck,
  Calendar,
  CalendarRange,
  ChevronDown,
  CircleMinus,
  Cog,
  Copy,
  CreditCard,
  Database,
  DollarSign,
  Edit3,
  Eye,
  EyeOff,
  Fingerprint,
  GripVertical,
  Group,
  IdCard,
  KeyRound,
  Link,
  Link2,
  Lock,
  LogIn,
  Mail,
  MapPin,
  NotebookTabs,
  Paperclip,
  Phone,
  Plus,
  RefreshCw,
  Router,
  Search,
  Server,
  ShieldCheck,
  ShieldQuestion,
  Star,
  Tags,
  Terminal,
  Timer,
  Trash2,
  Type,
  Vault,
  X,
} from 'lucide-react'
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import i18n, { getInitialLanguage, languageOptions, type SupportedLanguage } from './app/i18n'
import { isFormDirty } from './app/itemDrafts'
import { getItemTemplate } from './app/itemTemplates'
import { getLockScreenVariant, shouldShowTouchIdUnlock } from './app/lockScreen'
import { getMenuAnchorStyle, type MenuAnchor } from './app/menuPlacement'
import { navigationItems } from './app/navigation'
import {
  type AccountPasswordRequirement,
  type AutoLockIdleDuration,
  accountPasswordOptions,
  autoLockIdleOptions,
  type DeviceUnlockDuration,
  deviceUnlockOptions,
  getAutoLockMilliseconds,
  loadSecurityPreferences,
  type SecurityPreferences,
  saveSecurityPreferences,
} from './app/securityPreferences'
import { getInitialTheme, type Theme } from './app/theme'
import { formatOtpCode, getTotpProgress } from './app/totpDisplay'
import {
  type AppStatus,
  type BreachCheckResult,
  type CustomField,
  customFieldsToInput,
  emptyLoginItem,
  type ImportPreviewResult,
  type ItemUrl,
  type LoginItem,
  type LoginItemInput,
  type PasswordGeneratorOptions,
  type PasswordStrength,
  parseCustomFields,
  parseTags,
  type SnapshotSummary,
  tagsToInput,
  type UrlMatchType,
  type VaultSummary,
  vaultApi,
  type WatchtowerReport,
} from './app/vaultApi'

type VaultMode = 'loading' | 'setup' | 'locked' | 'unlocked'
type CategoryNavigation = `category:${(typeof categoryItems)[number]['itemType']}`
type ActiveNavigation = (typeof navigationItems)[number]['id'] | CategoryNavigation

type LoginFormState = LoginItemInput & {
  tagsInput: string
  customFieldsInput: string
  urlsInput: UrlFormState[]
}

type UrlFormState = ItemUrl & {
  id: string
}

type SectionChildField = CustomField & {
  id?: string
}

type FieldTotpPreview = {
  code: string
  secondsRemaining: number
}

const defaultWebsiteLabel = 'website'
const defaultUrlMatchType: UrlMatchType = 'domain'
const quickAccessMaxResults = 8
const quickAccessCloseDelayMs = 400

function createFormId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function toUrlFormState(url: ItemUrl): UrlFormState {
  return {
    id: createFormId(),
    label: url.label || defaultWebsiteLabel,
    match_type: url.match_type,
    url: url.url,
  }
}

function urlsForForm(item: LoginItem | LoginItemInput): UrlFormState[] {
  const urls = item.urls?.length
    ? item.urls
    : item.website
      ? [{ label: defaultWebsiteLabel, match_type: defaultUrlMatchType, url: item.website }]
      : [{ label: defaultWebsiteLabel, match_type: defaultUrlMatchType, url: '' }]
  return urls.map(toUrlFormState)
}

function normalizeFormUrls(urls: UrlFormState[], fallbackWebsite: string): ItemUrl[] {
  const normalized = urls.map((itemUrl) => ({
    label: itemUrl.label.trim() || defaultWebsiteLabel,
    match_type: itemUrl.match_type,
    url: itemUrl.url.trim(),
  }))
  const filled = normalized.filter((itemUrl) => itemUrl.url)
  if (filled.length === 0 && fallbackWebsite.trim()) {
    return [{ label: defaultWebsiteLabel, match_type: defaultUrlMatchType, url: fallbackWebsite.trim() }]
  }
  return filled
}

const addMoreOptions = [
  {
    descriptionKey: 'vault.addMoreOptions.securityQuestionsDescription',
    icon: ShieldQuestion,
    labelKey: 'vault.addMoreOptions.securityQuestions',
    type: 'security_questions',
  },
  { icon: Type, labelKey: 'vault.addMoreOptions.text', type: 'text' },
  { icon: Link, labelKey: 'vault.addMoreOptions.url', type: 'url' },
  { icon: Mail, labelKey: 'vault.addMoreOptions.email', type: 'email' },
  { icon: MapPin, labelKey: 'vault.addMoreOptions.address', type: 'address' },
  { icon: Calendar, labelKey: 'vault.addMoreOptions.date', type: 'date' },
  { icon: CalendarRange, labelKey: 'vault.addMoreOptions.monthYear', type: 'month_year' },
  { icon: Timer, labelKey: 'vault.addMoreOptions.oneTimePassword', type: 'otp' },
  { icon: KeyRound, labelKey: 'vault.addMoreOptions.password', type: 'password' },
  { icon: Phone, labelKey: 'vault.addMoreOptions.phone', type: 'phone' },
  { icon: LogIn, labelKey: 'vault.addMoreOptions.signInWith', type: 'sign_in_with' },
  { icon: Fingerprint, labelKey: 'vault.addMoreOptions.passkey', type: 'passkey' },
  { icon: Group, labelKey: 'vault.addMoreOptions.section', type: 'section' },
  { icon: Paperclip, labelKey: 'vault.addMoreOptions.attachFile', type: 'file' },
  { icon: Link2, labelKey: 'vault.addMoreOptions.relatedItem', type: 'related_item' },
] as const

// Sections hold plain values only: no nested section, attachment, related item,
// OTP secret or OAuth provider.
const sectionChildFieldTypes: readonly string[] = [
  'security_questions',
  'text',
  'url',
  'email',
  'address',
  'date',
  'month_year',
  'password',
  'phone',
]

const sectionChildOptions = addMoreOptions.filter((option) => sectionChildFieldTypes.includes(option.type))

// Only used to decide which side of the trigger has more room, so a rough height is enough.
const menuRowHeight = 36
const addMoreMenuHeight = addMoreOptions.length * menuRowHeight + 40
const sectionMenuHeight = Math.ceil(sectionChildOptions.length / 2) * menuRowHeight + 24

// These belong with the credentials they protect, so they render in the username /
// password group instead of the custom field list.
const loginSectionFieldTypes = ['otp', 'sign_in_with', 'passkey']

// Ordered weakest to strongest; the meter fills one segment per step.
const strengthLevels = ['weak', 'fair', 'strong', 'excellent'] as const

const categoryItems = [
  { colorClass: 'text-accent-icon-teal', icon: KeyRound, itemType: 'login' },
  { colorClass: 'text-accent-icon-yellow', icon: NotebookTabs, itemType: 'secure_note' },
  { colorClass: 'text-accent-icon-blue', icon: CreditCard, itemType: 'credit_card' },
  { colorClass: 'text-accent-icon-green', icon: IdCard, itemType: 'identity' },
  { colorClass: 'text-accent-icon-gray', icon: KeyRound, itemType: 'password' },
  { colorClass: 'text-accent-icon-yellow', icon: Terminal, itemType: 'ssh_key' },
  { colorClass: 'text-accent-icon-orange', icon: DollarSign, itemType: 'bank_account' },
  { colorClass: 'text-accent-icon-lime', icon: Database, itemType: 'database' },
  { colorClass: 'text-accent-icon-magenta', icon: Mail, itemType: 'email' },
  { colorClass: 'text-accent-icon-blue', icon: Router, itemType: 'router' },
  { colorClass: 'text-accent-icon-gray', icon: Server, itemType: 'server' },
  { colorClass: 'text-accent-icon-blue', icon: BadgeCheck, itemType: 'software_license' },
] as const

function parseSectionFields(value: string): SectionChildField[] {
  if (!value.trim()) return []
  try {
    const fields = JSON.parse(value)
    if (!Array.isArray(fields)) return []
    return fields
      .map((field) => ({
        field_type: typeof field.field_type === 'string' ? field.field_type : 'text',
        id: typeof field.id === 'string' ? field.id : createFormId(),
        label: typeof field.label === 'string' ? field.label : '',
        value: typeof field.value === 'string' ? field.value : '',
      }))
      .filter((field) => field.label || field.value)
  } catch {
    return []
  }
}

function stringifySectionFields(fields: SectionChildField[]): string {
  return JSON.stringify(
    fields.map((field) => ({
      field_type: field.field_type,
      id: field.id ?? createFormId(),
      label: field.label,
      value: field.value,
    })),
  )
}

// email/url stay type="text" on purpose: the detail form has no noValidate, so the
// browser's constraint validation on those types would block saving.
function fieldValueInputProps(fieldType: string): { inputMode?: 'email' | 'tel' | 'url'; type: string } {
  if (fieldType === 'password') return { type: 'password' }
  if (fieldType === 'date') return { type: 'date' }
  if (fieldType === 'email') return { inputMode: 'email', type: 'text' }
  if (fieldType === 'phone') return { inputMode: 'tel', type: 'text' }
  if (fieldType === 'url') return { inputMode: 'url', type: 'text' }
  return { type: 'text' }
}

function fieldValuePlaceholderKey(fieldType: string) {
  if (fieldType === 'month_year') return 'vault.monthYearPlaceholder'
  if (fieldType === 'otp') return 'vault.otpSecretPlaceholder'
  return 'vault.fieldValue'
}

function itemTitleById(items: LoginItem[], id: string) {
  return items.find((item) => item.id === id)?.title ?? id
}

function filterItemsByTitle(items: LoginItem[], query: string, excludeId?: string) {
  const normalizedQuery = query.trim().toLowerCase()
  return items.filter(
    (item) => item.id !== excludeId && (!normalizedQuery || item.title.toLowerCase().includes(normalizedQuery)),
  )
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

const iconById = {
  favorites: Star,
  generator: KeyRound,
  tags: Tags,
  vaults: Vault,
  watchtower: ShieldCheck,
} as const

function ItemSearchField({
  ariaLabel,
  emptyMessage,
  excludeId,
  items,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string
  emptyMessage: string
  excludeId?: string
  items: LoginItem[]
  onChange: (itemId: string) => void
  placeholder: string
  value: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const matches = open ? filterItemsByTitle(items, query, excludeId) : []

  return (
    <div className="item-search-wrap">
      <input
        aria-label={ariaLabel}
        className="custom-field-value-input"
        onBlur={() => {
          setOpen(false)
          setQuery('')
        }}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            setQuery('')
          }
        }}
        placeholder={placeholder}
        value={open ? query : itemTitleById(items, value)}
      />
      {open ? (
        <div
          className="item-search-list"
          // Keep focus on the input so selecting an option is not raced by blur.
          onMouseDown={(event) => event.preventDefault()}
        >
          {matches.map((item) => (
            <button
              className="menu-option"
              key={item.id}
              onClick={() => {
                onChange(item.id)
                setOpen(false)
                setQuery('')
              }}
              type="button"
            >
              <span>{item.title}</span>
              {item.username || item.website ? <small>{item.username || item.website}</small> : null}
            </button>
          ))}
          {matches.length === 0 ? <p className="item-search-empty">{emptyMessage}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function OtpFieldActions({
  onCopy,
  onPreview,
  preview,
  secret,
}: {
  onCopy: () => void
  onPreview: () => void
  preview?: FieldTotpPreview
  secret: string
}) {
  const { t } = useTranslation()

  return (
    <div className="field-inline-actions">
      <button className="secondary-button" disabled={!secret.trim()} onClick={onPreview} type="button">
        {t('vault.previewOtp')}
      </button>
      {preview ? (
        <button
          className="otp-display-button"
          onClick={onCopy}
          style={{ '--otp-progress': getTotpProgress(preview.secondsRemaining).toString() } as CSSProperties}
          title={t('vault.copyOtp', { defaultValue: 'Copy current OTP' })}
          type="button"
        >
          <span className="otp-code">{formatOtpCode(preview.code)}</span>
          <span
            aria-label={t('vault.otpSecondsRemaining', {
              defaultValue: '{{seconds}} seconds remaining',
              seconds: preview.secondsRemaining,
            })}
            className="otp-countdown"
            role="timer"
          >
            <span aria-hidden="true" className="otp-countdown-ring" />
            <span>{preview.secondsRemaining.toString().padStart(2, '0')}</span>
          </span>
        </button>
      ) : null}
    </div>
  )
}

function toFormState(item: LoginItem | LoginItemInput): LoginFormState {
  return {
    custom_fields: item.custom_fields,
    customFieldsInput: customFieldsToInput(item.custom_fields),
    favorite: item.favorite,
    item_type: item.item_type,
    notes: item.notes,
    password: item.password,
    tags: item.tags,
    tagsInput: tagsToInput(item.tags),
    title: item.title,
    urls: item.urls ?? [],
    urlsInput: urlsForForm(item),
    username: item.username,
    website: item.website,
  }
}

function toInput(form: LoginFormState): LoginItemInput {
  const urls = normalizeFormUrls(form.urlsInput, '')
  const parsedCustomFields = parseCustomFields(form.customFieldsInput)
  const customFields = form.custom_fields.length > 0 ? form.custom_fields : parsedCustomFields
  return {
    custom_fields: customFields,
    favorite: form.favorite,
    item_type: form.item_type,
    notes: form.notes,
    password: form.password,
    tags: parseTags(form.tagsInput),
    title: form.title.trim(),
    urls,
    username: form.username.trim(),
    website: urls[0]?.url ?? '',
  }
}

const itemTypes = [
  ['login', 'Login'],
  ['secure_note', 'Secure note'],
  ['credit_card', 'Credit card'],
  ['identity', 'Identity'],
  ['password', 'Password'],
  ['ssh_key', 'SSH key'],
  ['bank_account', 'Bank account'],
  ['passport', 'Passport'],
  ['driver_license', 'Driver license'],
  ['wifi', 'Wi-Fi'],
  ['api_credential', 'API credential'],
  ['server', 'Server'],
  ['database', 'Database'],
  ['email', 'Email'],
  ['router', 'Router'],
  ['software_license', 'Software license'],
  ['crypto_wallet', 'Crypto wallet'],
] as const

const settingsTabLabels: Record<SettingsTab, string> = {
  appearance: 'settings.tabs.appearance',
  browser: 'settings.tabs.browser',
  general: 'settings.tabs.general',
  'import-export': 'settings.tabs.importExport',
  security: 'settings.tabs.security',
  shortcuts: 'settings.tabs.shortcuts',
  sync: 'settings.tabs.sync',
  watchtower: 'settings.tabs.watchtower',
}

export function App() {
  const view = new URLSearchParams(window.location.search).get('view')
  if (view === 'settings') {
    return <SettingsWindow />
  }
  if (view === 'quick-access') {
    return <QuickAccessWindow />
  }

  return <VaultWindow />
}

function VaultWindow() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [mode, setMode] = useState<VaultMode>('loading')
  const [items, setItems] = useState<LoginItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [vaults, setVaults] = useState<VaultSummary[]>([])
  const [activeVaultId, setActiveVaultId] = useState('personal')
  const [itemListWidth, setItemListWidth] = useState(220)
  const [activeNavigation, setActiveNavigation] = useState<ActiveNavigation>('vaults')
  const [topSearch, setTopSearch] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [repoUrl, setRepoUrl] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [syncBranch, setSyncBranch] = useState('main')
  const [syncPath, setSyncPath] = useState('vault.enc')
  const [operationMessage, setOperationMessage] = useState<string | null>(null)
  const [autoSync, setAutoSync] = useState(false)
  const [archivedItems, setArchivedItems] = useState<LoginItem[]>([])
  const [biometricsAvailable, setBiometricsAvailable] = useState(false)
  const [securityPreferences, setSecurityPreferences] = useState<SecurityPreferences>(() => loadSecurityPreferences())
  const [form, setForm] = useState<LoginFormState>(() => toFormState(emptyLoginItem()))
  const [generatorOptions, setGeneratorOptions] = useState<PasswordGeneratorOptions>({
    length: 24,
    lowercase: true,
    numbers: true,
    symbols: true,
    uppercase: true,
  })
  const [generatedPassword, setGeneratedPassword] = useState('')
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength | null>(null)
  const [showAddMore, setShowAddMore] = useState(false)
  const [sectionMenuIndex, setSectionMenuIndex] = useState<number | null>(null)
  const [addMoreMenuAnchor, setAddMoreMenuAnchor] = useState<MenuAnchor>()
  const [sectionMenuAnchor, setSectionMenuAnchor] = useState<MenuAnchor>()
  const [fieldTotpPreviews, setFieldTotpPreviews] = useState<Record<number, FieldTotpPreview>>({})
  const [isEditing, setIsEditing] = useState(false)
  // What the current form was loaded from. A ref, not state: the switch effect below runs only
  // when the selected item changes, and it has to compare the outgoing form against the baseline
  // that form came from.
  const baselineRef = useRef(form)
  const draftKeyRef = useRef('')
  const draftsRef = useRef<Record<string, LoginFormState>>({})
  const formRef = useRef(form)
  const [lastActivityAt, setLastActivityAt] = useState(() => Date.now())
  const topSearchInputRef = useRef<HTMLInputElement>(null)
  const [theme, setTheme] = useState<Theme>(() =>
    getInitialTheme(localStorage.getItem('passless-theme'), window.matchMedia('(prefers-color-scheme: dark)').matches),
  )
  const [, setLanguage] = useState<SupportedLanguage>(() =>
    getInitialLanguage(localStorage.getItem('passless-language')),
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('passless-theme', theme)
  }, [theme])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<Theme>('passless-theme-changed', (event) => setTheme(event.payload)).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<SupportedLanguage>('passless-language-changed', (event) => {
      setLanguage(event.payload)
      localStorage.setItem('passless-language', event.payload)
      void i18n.changeLanguage(event.payload)
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<SecurityPreferences>('passless-security-preferences-changed', (event) => {
      setSecurityPreferences(event.payload)
      saveSecurityPreferences(event.payload)
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    vaultApi
      .initialize()
      .then((nextStatus) => {
        setStatus(nextStatus)
        setMode(nextStatus.has_master_password ? 'locked' : 'setup')
      })
      .catch((nextError) => {
        setError(String(nextError))
        setMode('setup')
      })
  }, [])

  useEffect(() => {
    vaultApi
      .canUseBiometrics()
      .then(setBiometricsAvailable)
      .catch(() => setBiometricsAvailable(false))
  }, [])

  useEffect(() => {
    if (mode !== 'unlocked') return
    const timer = window.setTimeout(() => {
      vaultApi
        .list()
        .then((nextItems) => {
          setItems(nextItems)
          setSelectedId((current) => current ?? nextItems[0]?.id ?? null)
        })
        .catch((nextError) => setError(String(nextError)))
    }, 120)
    return () => window.clearTimeout(timer)
  }, [mode])

  useEffect(() => {
    if (mode !== 'unlocked') return
    loadArchivedItems().catch((nextError) => setError(String(nextError)))
  }, [mode])

  useEffect(() => {
    if (mode !== 'unlocked') return
    let unlisten: (() => void) | undefined
    listen('passless-vault-changed', () => {
      refreshItems().catch((nextError) => setError(String(nextError)))
      loadArchivedItems().catch((nextError) => setError(String(nextError)))
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [mode])

  useEffect(() => {
    if (mode !== 'unlocked') return
    const updateActivity = () => setLastActivityAt(Date.now())
    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach((eventName) => window.addEventListener(eventName, updateActivity, { capture: true, passive: true }))
    return () => events.forEach((eventName) => window.removeEventListener(eventName, updateActivity, { capture: true }))
  }, [mode])

  useEffect(() => {
    if (mode !== 'unlocked') return
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.metaKey) return
      const key = event.key.toLowerCase()
      if (key === ',') {
        event.preventDefault()
        void openSettingsWindow()
      } else if (key === 'n') {
        event.preventDefault()
        void handleNewItem()
      } else if (key === 'f') {
        event.preventDefault()
        topSearchInputRef.current?.focus()
      } else if (key === 'k') {
        event.preventDefault()
        void handleLock()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [mode])

  useEffect(() => {
    if (mode !== 'unlocked') return
    const timeout = getAutoLockMilliseconds(securityPreferences.autoLockIdleDuration)
    if (timeout === null) return
    const lockTimer = window.setTimeout(() => {
      handleLock()
    }, timeout)
    return () => window.clearTimeout(lockTimer)
  }, [mode, lastActivityAt, securityPreferences.autoLockIdleDuration])

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId])

  const activeVaultName = useMemo(
    () => vaults.find((vault) => vault.id === activeVaultId)?.name ?? t('vault.personalVault'),
    [activeVaultId, t, vaults],
  )

  const visibleItems = useMemo(() => {
    if (activeNavigation === 'generator' || activeNavigation === 'watchtower') return []
    if (activeNavigation === 'favorites') return items.filter((item) => item.favorite)
    if (activeNavigation === 'tags') return items.filter((item) => item.tags.length > 0)
    if (activeNavigation.startsWith('category:')) {
      const itemType = activeNavigation.replace('category:', '')
      return items.filter((item) => item.item_type === itemType)
    }
    return items
  }, [activeNavigation, items])

  const topSearchResults = useMemo(() => {
    const normalizedQuery = topSearch.trim().toLowerCase()
    if (!normalizedQuery) return []
    return items.filter((item) => item.title.toLowerCase().includes(normalizedQuery)).slice(0, 8)
  }, [items, topSearch])

  const template = useMemo(() => getItemTemplate(form.item_type), [form.item_type])

  // Original custom_fields indexes are kept so every mutator still addresses the right row.
  const customFieldEntries = useMemo(
    () => form.custom_fields.map((field, index) => ({ field, index })),
    [form.custom_fields],
  )
  // OTP, passkeys and sign-in methods belong to the credential they protect. On a category
  // with no credential block they fall back to the plain custom-field list instead of
  // disappearing with it.
  const inCredentialBlock = (field: CustomField) =>
    template.credentials && loginSectionFieldTypes.includes(field.field_type)
  const loginSectionFields = useMemo(
    () => customFieldEntries.filter(({ field }) => inCredentialBlock(field)),
    [customFieldEntries, template.credentials],
  )
  const detailCustomFields = useMemo(
    () => customFieldEntries.filter(({ field }) => !inCredentialBlock(field)),
    [customFieldEntries, template.credentials],
  )

  // The category the sidebar is showing is the category a new item belongs to, which is
  // what decides both the layout and the fields an empty item starts out with.
  const newItemCategory = activeNavigation.startsWith('category:')
    ? activeNavigation.slice('category:'.length)
    : 'login'

  // A draft belongs to whatever the form is showing: a saved item, or the category a new
  // item is being built under.
  const draftKey = selectedItem?.id ?? `new:${newItemCategory}`
  const hasUnsavedChanges = isFormDirty(baselineRef.current, form)

  const listTitle = useMemo(() => {
    if (activeNavigation === 'favorites') return t('listTitle.favorites')
    if (activeNavigation === 'tags') return t('listTitle.tags')
    if (activeNavigation === 'generator') return t('listTitle.generator')
    if (activeNavigation === 'watchtower') return t('listTitle.watchtower')
    if (activeNavigation.startsWith('category:')) {
      const itemType = activeNavigation.replace('category:', '')
      return t(`itemTypes.${itemType}`, { defaultValue: itemType })
    }
    return t('listTitle.vaults')
  }, [activeNavigation, t])

  useEffect(() => {
    formRef.current = form
  }, [form])

  useEffect(() => {
    const previousKey = draftKeyRef.current
    if (previousKey && previousKey !== draftKey) {
      if (isFormDirty(baselineRef.current, formRef.current)) draftsRef.current[previousKey] = formRef.current
      else delete draftsRef.current[previousKey]
    }
    const nextBaseline = selectedItem ? toFormState(selectedItem) : buildDraftForm(newItemCategory)
    const restored = draftsRef.current[draftKey]
    setForm(restored ?? nextBaseline)
    baselineRef.current = nextBaseline
    setIsEditing(Boolean(restored) || !selectedItem)
    draftKeyRef.current = draftKey
    setShowPassword(false)
    setFieldTotpPreviews({})
  }, [draftKey])

  useEffect(() => {
    if (!form.password) {
      setPasswordStrength(null)
      return
    }
    let stale = false
    vaultApi
      .passwordStrength(form.password)
      .then((next) => {
        if (!stale) setPasswordStrength(next)
      })
      .catch(() => setPasswordStrength(null))
    return () => {
      stale = true
    }
  }, [form.password])

  useEffect(() => {
    if (!Object.keys(fieldTotpPreviews).length) return
    const timer = window.setInterval(() => {
      setFieldTotpPreviews((current) => {
        const nextEntries = Object.entries(current).map(([index, preview]) => [
          index,
          {
            ...preview,
            secondsRemaining: Math.max(0, preview.secondsRemaining - 1),
          },
        ])
        return Object.fromEntries(nextEntries) as Record<number, FieldTotpPreview>
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [fieldTotpPreviews])

  useEffect(() => {
    const expiredIndexes = Object.entries(fieldTotpPreviews)
      .filter(([, preview]) => preview.secondsRemaining <= 0)
      .map(([index]) => Number(index))
    if (!expiredIndexes.length) return
    expiredIndexes.forEach((index) => {
      const secret = form.custom_fields[index]?.value
      if (secret) void previewFieldTotp(index, secret)
    })
  }, [fieldTotpPreviews, form.custom_fields])

  const databaseLabel = useMemo(() => {
    if (error && mode === 'loading') return t('vault.databaseOffline')
    if (!status) return t('vault.preparingDatabase')
    return status.database_ready ? t('vault.databaseReady') : t('vault.databasePending')
  }, [error, mode, status, t])

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    try {
      const nextItems = mode === 'setup' ? await vaultApi.setup(masterPassword) : await vaultApi.unlock(masterPassword)
      setItems(nextItems)
      setSelectedId(nextItems[0]?.id ?? null)
      setMasterPassword('')
      setMode('unlocked')
      await loadVaults()
      vaultApi.loadSyncSettings().then((settings) => {
        if (!settings) return
        setRepoUrl(settings.repo_url)
        setSyncBranch(settings.branch)
        setSyncPath(settings.path)
        setAutoSync(settings.auto_sync)
      })
      vaultApi.loadGithubPat().then((token) => {
        if (token) setGithubToken(token)
      })
      loadArchivedItems().catch((nextError) => setError(String(nextError)))
      setStatus((current) => (current ? { ...current, has_master_password: true, unlocked: true } : current))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function handleBiometricUnlock() {
    setError(null)
    try {
      const nextItems = await vaultApi.unlockWithBiometrics()
      setItems(nextItems)
      setSelectedId(nextItems[0]?.id ?? null)
      setMode('unlocked')
      await loadVaults()
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function handleLock() {
    await vaultApi.lock()
    setMode('locked')
    setItems([])
    setSelectedId(null)
    setVaults([])
    setActiveVaultId('personal')
    setForm(toFormState(emptyLoginItem()))
    draftsRef.current = {}
    draftKeyRef.current = ''
    setIsEditing(false)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const input = toInput(form)
      if (!input.title) {
        throw new Error(t('vault.titleRequired'))
      }
      const saved = selectedItem ? await vaultApi.update(selectedItem.id, input) : await vaultApi.create(input)
      const nextItems = await vaultApi.list()
      // A save retires the draft and moves the form off its `new:` key, so the switch effect
      // below does not file the just-saved values as unsaved edits on the old key.
      delete draftsRef.current[draftKeyRef.current]
      draftKeyRef.current = saved.id
      baselineRef.current = toFormState(saved)
      setItems(nextItems)
      setSelectedId(saved.id)
      setIsEditing(false)
      await maybeAutoSync()
    } catch (nextError) {
      setError(String(nextError))
    } finally {
      setSaving(false)
    }
  }

  function handleCancelEdit() {
    closeFieldMenus()
    delete draftsRef.current[draftKeyRef.current]
    setForm(baselineRef.current)
    setShowPassword(false)
    setFieldTotpPreviews({})
    setIsEditing(!selectedItem)
  }

  // A template's fields are ordinary custom fields, so a seeded item can be edited,
  // reordered or emptied with the same mutators as a hand-built one.
  function templateSectionFields(itemType: string): CustomField[] {
    return getItemTemplate(itemType).sections.map((section) => ({
      field_type: 'section',
      label: t(section.titleKey),
      value: stringifySectionFields(
        section.fields.map((field) => ({
          field_type: field.field_type,
          id: createFormId(),
          label: t(field.labelKey),
          value: '',
        })),
      ),
    }))
  }

  function buildDraftForm(itemType: string): LoginFormState {
    return toFormState({
      ...emptyLoginItem(),
      custom_fields: templateSectionFields(itemType),
      item_type: itemType,
    })
  }

  async function handleNewItem() {
    setSelectedId(null)
    setForm(buildDraftForm(newItemCategory))
    setShowPassword(false)
    closeFieldMenus()
    setIsEditing(true)
  }

  async function loadVaults() {
    const nextVaults = await vaultApi.listVaults()
    setVaults(nextVaults)
    setActiveVaultId(
      (current) => nextVaults.find((vault) => vault.id === current)?.id ?? nextVaults[0]?.id ?? 'personal',
    )
  }

  async function handleSwitchVault(vaultId: string) {
    setError(null)
    try {
      const nextItems = await vaultApi.switchVault(vaultId)
      setActiveVaultId(vaultId)
      setItems(nextItems)
      setSelectedId(nextItems[0]?.id ?? null)
      setForm(toFormState(nextItems[0] ?? emptyLoginItem()))
      await loadArchivedItems()
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function handleCreateVault() {
    const name = window.prompt(t('vault.createVaultPrompt', { defaultValue: 'Vault name' }))
    if (!name?.trim()) return
    setError(null)
    try {
      const vault = await vaultApi.createVault(name)
      const nextVaults = await vaultApi.listVaults()
      setVaults(nextVaults)
      setActiveVaultId(vault.id)
      setItems([])
      setArchivedItems([])
      setSelectedId(null)
      setForm(toFormState(emptyLoginItem()))
      setIsEditing(true)
      setOperationMessage(t('messages.createdVault', { defaultValue: 'Created vault {{name}}', name: vault.name }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  function jumpToSearchResult(itemId: string) {
    setActiveNavigation('vaults')
    setSelectedId(itemId)
    setTopSearch('')
  }

  function beginItemListResize(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = itemListWidth
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.min(250, Math.max(180, startWidth + moveEvent.clientX - startX))
      setItemListWidth(nextWidth)
    }
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  function updateUrl(index: number, patch: Partial<ItemUrl>) {
    setForm((current) => ({
      ...current,
      urlsInput: current.urlsInput.map((itemUrl, itemIndex) =>
        itemIndex === index ? { ...itemUrl, ...patch } : itemUrl,
      ),
    }))
  }

  function addWebsite() {
    setForm((current) => ({
      ...current,
      urlsInput: [
        ...current.urlsInput,
        toUrlFormState({ label: defaultWebsiteLabel, match_type: defaultUrlMatchType, url: '' }),
      ],
    }))
  }

  function removeWebsite(index: number) {
    setForm((current) => {
      if (current.urlsInput.length <= 1) return current
      const urlsInput = current.urlsInput.filter((_, itemIndex) => itemIndex !== index)
      return {
        ...current,
        urlsInput,
      }
    })
  }

  function updateCustomField(index: number, patch: Partial<CustomField>) {
    setForm((current) => {
      const customFields = current.custom_fields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field,
      )
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  // The field rows clip an absolutely positioned panel, so both menus are anchored to the
  // viewport and open on whichever side of the trigger has room.
  function toggleAddMoreMenu(trigger: HTMLElement) {
    const next = !showAddMore
    setSectionMenuIndex(null)
    setShowAddMore(next)
    if (!next) return
    setAddMoreMenuAnchor(
      getMenuAnchorStyle({
        menuHeight: addMoreMenuHeight,
        rect: trigger.getBoundingClientRect(),
        viewportHeight: window.innerHeight,
      }),
    )
  }

  function toggleSectionMenu(sectionIndex: number, trigger: HTMLElement) {
    const next = sectionMenuIndex === sectionIndex ? null : sectionIndex
    setShowAddMore(false)
    setSectionMenuIndex(next)
    if (next === null) return
    const buttonRect = trigger.getBoundingClientRect()
    // The panel spans the card it belongs to rather than the width of the text button.
    const cardRect = trigger.closest('.section-field-card')?.getBoundingClientRect() ?? buttonRect
    setSectionMenuAnchor(
      getMenuAnchorStyle({
        menuHeight: sectionMenuHeight,
        rect: { bottom: buttonRect.bottom, left: cardRect.left, top: buttonRect.top, width: cardRect.width },
        viewportHeight: window.innerHeight,
      }),
    )
  }

  function closeFieldMenus() {
    setAddMoreMenuAnchor(undefined)
    setSectionMenuAnchor(undefined)
    setSectionMenuIndex(null)
    setShowAddMore(false)
  }

  async function addCustomField(fieldType: (typeof addMoreOptions)[number]['type']) {
    const attachmentPath = fieldType === 'file' ? await vaultApi.pickAttachmentFile() : null
    if (fieldType === 'file' && !attachmentPath) {
      setShowAddMore(false)
      return
    }
    const label = t(`vault.customFieldDefaults.${fieldType}`)
    setForm((current) => {
      const value = fieldType === 'section' ? stringifySectionFields([]) : (attachmentPath ?? '')
      const customFields = [
        ...current.custom_fields,
        {
          field_type: fieldType,
          label: fieldType === 'file' && attachmentPath ? fileNameFromPath(attachmentPath) : label,
          value,
        },
      ]
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
    setShowAddMore(false)
  }

  function removeCustomField(index: number) {
    setForm((current) => {
      const customFields = current.custom_fields.filter((_, fieldIndex) => fieldIndex !== index)
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  async function previewFieldTotp(index: number, secret: string) {
    if (!secret.trim()) return
    setError(null)
    try {
      const code = await vaultApi.generateTotp(secret)
      setFieldTotpPreviews((current) => ({
        ...current,
        [index]: {
          code: code.code,
          secondsRemaining: code.seconds_remaining,
        },
      }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function copyFieldTotp(index: number) {
    const preview = fieldTotpPreviews[index]
    if (!preview) return
    await navigator.clipboard.writeText(preview.code)
    setOperationMessage(t('messages.copiedOtp', { defaultValue: 'Copied one-time password' }))
  }

  async function chooseAttachmentForField(index: number) {
    const path = await vaultApi.pickAttachmentFile()
    if (!path) return
    const attachedField = selectedItem && isEditing ? await vaultApi.attachFileToItem(selectedItem.id, path) : null
    setForm((current) => {
      const customFields = current.custom_fields.map((field, fieldIndex) =>
        fieldIndex === index
          ? {
              ...field,
              label: attachedField?.label ?? (field.label.trim() ? field.label : fileNameFromPath(path)),
              value: attachedField?.value ?? path,
            }
          : field,
      )
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  async function openAttachment(field: CustomField) {
    if (!field.value.startsWith('attachment://')) return
    setError(null)
    try {
      const path = await vaultApi.exportAttachmentToTemp(field.value.replace('attachment://', ''))
      setOperationMessage(t('messages.exportedAttachment', { defaultValue: 'Attachment exported to {{path}}', path }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  function updateSectionChild(sectionIndex: number, childIndex: number, patch: Partial<CustomField>) {
    setForm((current) => {
      const customFields = current.custom_fields.map((field, fieldIndex) => {
        if (fieldIndex !== sectionIndex) return field
        const sectionFields = parseSectionFields(field.value)
        const nextSectionFields = sectionFields.map((child, index) =>
          index === childIndex ? { ...child, ...patch } : child,
        )
        return { ...field, value: stringifySectionFields(nextSectionFields) }
      })
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  function addSectionChild(sectionIndex: number, fieldType: (typeof addMoreOptions)[number]['type']) {
    setSectionMenuIndex(null)
    setForm((current) => {
      const customFields = current.custom_fields.map((field, fieldIndex) => {
        if (fieldIndex !== sectionIndex) return field
        const sectionFields = parseSectionFields(field.value)
        return {
          ...field,
          value: stringifySectionFields([
            ...sectionFields,
            {
              field_type: fieldType,
              id: createFormId(),
              label: t(`vault.customFieldDefaults.${fieldType}`),
              value: '',
            },
          ]),
        }
      })
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  function removeSectionChild(sectionIndex: number, childIndex: number) {
    setForm((current) => {
      const customFields = current.custom_fields.map((field, fieldIndex) => {
        if (fieldIndex !== sectionIndex) return field
        const nextSectionFields = parseSectionFields(field.value).filter((_, index) => index !== childIndex)
        return { ...field, value: stringifySectionFields(nextSectionFields) }
      })
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  async function handleDelete() {
    if (!selectedItem) return
    await vaultApi.archive(selectedItem.id)
    const nextItems = await vaultApi.list()
    setItems(nextItems)
    setSelectedId(nextItems[0]?.id ?? null)
    await loadArchivedItems()
    await maybeAutoSync()
  }

  async function handleFavorite() {
    if (!selectedItem) {
      setForm((current) => ({ ...current, favorite: !current.favorite }))
      return
    }
    await vaultApi.favorite(selectedItem.id, !selectedItem.favorite)
    const nextItems = await vaultApi.list()
    setItems(nextItems)
  }

  async function handleGeneratePassword() {
    const password = await vaultApi.generatePassword({
      length: 24,
      lowercase: true,
      numbers: true,
      symbols: true,
      uppercase: true,
    })
    setForm((current) => ({ ...current, password }))
    setShowPassword(true)
  }

  async function handleStandaloneGeneratePassword() {
    setError(null)
    try {
      const password = await vaultApi.generatePassword(generatorOptions)
      setGeneratedPassword(password)
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function copyGeneratedPassword() {
    if (generatedPassword) {
      await navigator.clipboard.writeText(generatedPassword)
    }
  }

  function useGeneratedPassword() {
    if (!generatedPassword) return
    setActiveNavigation('vaults')
    setForm((current) => ({ ...current, password: generatedPassword }))
    setShowPassword(true)
    setIsEditing(true)
  }

  async function copyPassword() {
    if (form.password) {
      await navigator.clipboard.writeText(form.password)
      if (securityPreferences.clearClipboardAfter90Seconds) {
        window.setTimeout(async () => {
          try {
            if ((await navigator.clipboard.readText()) === form.password) {
              await navigator.clipboard.writeText('')
            }
          } catch {
            await navigator.clipboard.writeText('')
          }
        }, 90 * 1000)
      }
    }
  }

  async function refreshItems() {
    const nextItems = await vaultApi.list()
    setItems(nextItems)
    setSelectedId((current) => current ?? nextItems[0]?.id ?? null)
  }

  async function maybeAutoSync() {
    if (!autoSync || !repoUrl || !githubToken) return
    const result = await vaultApi.githubUpload(syncConfig())
    setOperationMessage(t('messages.autoSynced', { count: result.item_count }))
  }

  function syncConfig() {
    return {
      branch: syncBranch || 'main',
      path: syncPath || 'vault.enc',
      repo_url: repoUrl,
      token: githubToken,
    }
  }

  async function loadArchivedItems() {
    setArchivedItems(await vaultApi.archived())
  }

  async function restoreArchivedItem(id: string) {
    await vaultApi.restore(id)
    await refreshItems()
    await loadArchivedItems()
    await maybeAutoSync()
  }

  async function openSettingsWindow() {
    setError(null)
    try {
      const existing = await WebviewWindow.getByLabel('settings')
      if (existing) {
        await existing.show()
        await existing.setFocus()
        return
      }

      const settingsWindow = new WebviewWindow('settings', {
        alwaysOnTop: true,
        center: true,
        decorations: true,
        height: 680,
        hiddenTitle: true,
        minHeight: 560,
        minWidth: 760,
        resizable: false,
        shadow: true,
        skipTaskbar: true,
        title: 'Passless Settings',
        titleBarStyle: 'overlay',
        url: '/?view=settings',
        width: 920,
      })
      settingsWindow.once('tauri://error', (event) =>
        setError(t('messages.settingsWindowFailed', { error: String(event.payload) })),
      )
    } catch (nextError) {
      setError(t('messages.settingsWindowFailed', { error: String(nextError) }))
    }
  }

  if (mode !== 'unlocked') {
    const lockVariant = getLockScreenVariant(mode)
    const showTouchIdUnlock = shouldShowTouchIdUnlock(
      biometricsAvailable,
      securityPreferences.unlockUsingTouchId,
      securityPreferences.unlockWithMacPassword,
    )
    if (lockVariant === 'compact-unlock') {
      return (
        <main className="lock-screen compact-lock-screen" data-tauri-drag-region>
          <form className="compact-unlock-form" onSubmit={handleUnlock}>
            <h1 className="compact-lock-brand">
              <span aria-hidden="true" className="brand-mark">
                <Lock size={16} />
              </span>
              <span>{t('lock.appName')}</span>
            </h1>
            <div className="compact-password-control">
              <input
                aria-label={t('lock.masterPassword')}
                autoFocus
                minLength={8}
                onChange={(event) => setMasterPassword(event.target.value)}
                placeholder={t('lock.enterPasswordPlaceholder', { defaultValue: 'Enter your password' })}
                type={showPassword ? 'text' : 'password'}
                value={masterPassword}
              />
              <button
                aria-label={t('vault.showPassword')}
                className="compact-unlock-icon-button"
                onClick={() => setShowPassword((value) => !value)}
                title={t('vault.showPassword')}
                type="button"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              {showTouchIdUnlock ? (
                <button
                  aria-label={t('lock.unlockWithTouchId')}
                  className="compact-unlock-icon-button"
                  onClick={handleBiometricUnlock}
                  title={t('lock.unlockWithTouchId')}
                  type="button"
                >
                  <Fingerprint size={16} strokeWidth={1.5} />
                </button>
              ) : null}
            </div>
            {error ? <div className="compact-lock-error">{error}</div> : null}
          </form>
        </main>
      )
    }

    return (
      <main className="lock-screen" data-tauri-drag-region>
        <section className="lock-panel">
          <div className="brand large">
            <div className="brand-mark">
              <Lock size={16} />
            </div>
            <div>
              <strong>{t('lock.appName')}</strong>
              <span>{t('lock.tagline')}</span>
            </div>
          </div>
          <form onSubmit={handleUnlock}>
            <h1>{mode === 'setup' ? t('lock.createTitle') : t('lock.unlockTitle')}</h1>
            <p>{mode === 'setup' ? t('lock.createDescription') : t('lock.unlockDescription')}</p>
            <label>
              {t('lock.masterPassword')}
              <input
                autoFocus
                minLength={8}
                onChange={(event) => setMasterPassword(event.target.value)}
                placeholder={t('lock.masterPasswordPlaceholder')}
                type="password"
                value={masterPassword}
              />
            </label>
            {error ? <div className="error-banner">{error}</div> : null}
            <button className="primary-button" disabled={masterPassword.length < 8 || mode === 'loading'} type="submit">
              {mode === 'setup' ? t('lock.createVault') : t('lock.unlock')}
            </button>
            {mode === 'locked' && showTouchIdUnlock ? (
              <button className="secondary-button" onClick={handleBiometricUnlock} type="button">
                {t('lock.unlockWithTouchId')}
              </button>
            ) : null}
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell" style={{ '--item-list-width': `${itemListWidth}px` } as CSSProperties}>
      <h1 className="sr-only">{t('landmarks.vaultItems')}</h1>
      <aside aria-label={t('landmarks.primaryNavigation')} className="sidebar" data-tauri-drag-region="deep">
        <div className="brand">
          <div className="brand-mark">
            <Lock size={16} />
          </div>
          <div>
            <strong>Passless</strong>
            <span>{t('vault.personalVault')}</span>
          </div>
        </div>

        <nav className="nav-list">
          {navigationItems.map((item) => {
            const Icon = iconById[item.id]
            return (
              <button
                className={item.id === activeNavigation ? 'nav-item active' : 'nav-item'}
                key={item.id}
                onClick={() => setActiveNavigation(item.id)}
                type="button"
              >
                <Icon size={16} />
                <span>{t(`nav.${item.id}`)}</span>
              </button>
            )
          })}
        </nav>

        <nav aria-label={t('common.categories')} className="category-nav">
          <div className="sidebar-section-title">
            <span>{t('common.categories')}</span>
          </div>
          <div className="nav-list">
            {categoryItems.map((category) => {
              const Icon = category.icon
              const id = `category:${category.itemType}` as const
              return (
                <button
                  className={activeNavigation === id ? 'nav-item category-item active' : 'nav-item category-item'}
                  key={category.itemType}
                  onClick={() => setActiveNavigation(id)}
                  type="button"
                >
                  <Icon className={category.colorClass} size={16} />
                  <span>{t(`itemTypes.${category.itemType}`)}</span>
                </button>
              )
            })}
          </div>
        </nav>

        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={openSettingsWindow} type="button">
            <Cog size={16} />
            {t('common.settings')}
          </button>
          <section aria-label={t('common.archive')} className="sidebar-archive">
            <div className="sidebar-section-title">
              <span>{t('common.archive')}</span>
              <button
                aria-label={t('common.refreshArchive')}
                onClick={loadArchivedItems}
                title={t('common.refreshArchive')}
                type="button"
              >
                <RefreshCw size={16} />
              </button>
            </div>
            <div className="sidebar-archive-list">
              {archivedItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => restoreArchivedItem(item.id)}
                  title={t('vault.restore', { title: item.title })}
                  type="button"
                >
                  <span>{item.title.slice(0, 1).toUpperCase() || 'A'}</span>
                  <strong>{item.title}</strong>
                </button>
              ))}
              {archivedItems.length === 0 ? <p>{t('common.noArchivedItems')}</p> : null}
            </div>
          </section>
        </div>
      </aside>

      <header className="top-search-bar" data-tauri-drag-region="deep">
        <div className="top-search-wrap">
          <label className="top-search-box">
            <Search size={16} />
            <input
              aria-label={t('vault.searchAllItems')}
              onChange={(event) => setTopSearch(event.target.value)}
              placeholder={t('vault.searchAllItems')}
              ref={topSearchInputRef}
              value={topSearch}
            />
          </label>
          {topSearch.trim() ? (
            <div className="top-search-results" data-tauri-drag-region="false">
              {topSearchResults.map((item) => (
                <button key={item.id} onClick={() => jumpToSearchResult(item.id)} type="button">
                  <span className="item-icon">{item.title.slice(0, 1).toUpperCase() || 'L'}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.username || item.website || t('vault.loginFallback')}</small>
                  </span>
                </button>
              ))}
              {topSearchResults.length === 0 ? <p>{t('vault.noSearchResults')}</p> : null}
            </div>
          ) : null}
        </div>
        <button className="top-new-item-button" onClick={handleNewItem} type="button">
          <Plus size={16} />
          {t('vault.newItem')}
        </button>
      </header>

      <section aria-label={t('landmarks.vaultItems')} className="item-list">
        <div className="sync-state">
          {error ? <AlertCircle size={16} /> : <ShieldCheck size={16} />}
          <span>{error ?? databaseLabel}</span>
        </div>

        {activeNavigation === 'generator' ? (
          <div className="sidebar-tool-panel">
            <KeyRound size={16} />
            <strong>{t('vault.passwordGenerator')}</strong>
            <p>{t('vault.generatorHint')}</p>
          </div>
        ) : null}

        {activeNavigation === 'watchtower' ? (
          <div className="sidebar-tool-panel">
            <ShieldCheck size={16} />
            <strong>{t('integrations.watchtower')}</strong>
            <p>{t('vault.watchtowerHint')}</p>
            <button className="secondary-button" onClick={openSettingsWindow} type="button">
              {t('common.openSettings')}
            </button>
          </div>
        ) : null}

        <div className="rows">
          {visibleItems.map((item) => (
            <button
              className={item.id === selectedId ? 'item-row active' : 'item-row'}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              type="button"
            >
              <span className="item-icon">{item.title.slice(0, 1).toUpperCase() || 'L'}</span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.username || item.website || t('vault.loginFallback')}</small>
              </span>
              {item.favorite ? <Star className="row-star" size={14} /> : null}
            </button>
          ))}
          {visibleItems.length === 0 && activeNavigation !== 'generator' && activeNavigation !== 'watchtower' ? (
            <p className="empty-state">{t('vault.noItems', { target: listTitle })}</p>
          ) : null}
        </div>
      </section>

      <button
        aria-label={t('vault.resizeColumns')}
        className="column-resize-handle"
        onMouseDown={beginItemListResize}
        type="button"
      />

      <section aria-label={t('landmarks.itemDetails')} className="detail-pane">
        <div className="detail-topbar" data-tauri-drag-region="deep">
          <div className="vault-picker-row">
            <label className="vault-picker">
              <select onChange={(event) => handleSwitchVault(event.target.value)} value={activeVaultId}>
                {vaults.length ? (
                  vaults.map((vault) => (
                    <option key={vault.id} value={vault.id}>
                      {vault.name}
                    </option>
                  ))
                ) : (
                  <option value="personal">{activeVaultName}</option>
                )}
              </select>
            </label>
            <button
              aria-label={t('vault.createVault', { defaultValue: 'Create vault' })}
              className="icon-button vault-add-button"
              onClick={handleCreateVault}
              title={t('vault.createVault', { defaultValue: 'Create vault' })}
              type="button"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="detail-topbar-actions">
            {selectedItem && !isEditing ? (
              <button className="top-edit-button" onClick={() => setIsEditing(true)} type="button">
                <Edit3 size={15} />
                {t('vault.edit')}
              </button>
            ) : null}
            {isEditing ? (
              <select
                className="type-picker"
                onChange={(event) => setForm((current) => ({ ...current, item_type: event.target.value }))}
                value={form.item_type}
              >
                {itemTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(`itemTypes.${value}`, { defaultValue: label })}
                  </option>
                ))}
              </select>
            ) : (
              <span className="type-display">{t(`itemTypes.${form.item_type}`, { defaultValue: form.item_type })}</span>
            )}
          </div>
        </div>
        {activeNavigation === 'generator' ? (
          <section className="generator-pane">
            <div className="detail-header">
              <div className="large-icon">
                <KeyRound size={16} />
              </div>
              <div>
                <h2>{t('vault.passwordGenerator')}</h2>
                <p>
                  {t('vault.generatorDescription', {
                    defaultValue: 'Create a password with precise length and character controls.',
                  })}
                </p>
              </div>
            </div>

            <div className="generator-output">
              <input
                aria-label={t('vault.generatedPassword', { defaultValue: 'Generated password' })}
                placeholder={t('vault.generatedPasswordPlaceholder', { defaultValue: 'Generate a password' })}
                readOnly
                value={generatedPassword}
              />
              <button
                className="secondary-button"
                disabled={!generatedPassword}
                onClick={copyGeneratedPassword}
                type="button"
              >
                <Copy size={16} />
                {t('vault.copyPassword')}
              </button>
            </div>

            <div className="generator-controls">
              <label className="generator-length-control">
                <span>{t('vault.passwordLength', { defaultValue: 'Length' })}</span>
                <input
                  max={128}
                  min={8}
                  onChange={(event) =>
                    setGeneratorOptions((current) => ({ ...current, length: Number(event.target.value) }))
                  }
                  type="range"
                  value={generatorOptions.length}
                />
                <input
                  max={128}
                  min={8}
                  onChange={(event) =>
                    setGeneratorOptions((current) => ({ ...current, length: Number(event.target.value) }))
                  }
                  type="number"
                  value={generatorOptions.length}
                />
              </label>
              {(['uppercase', 'lowercase', 'numbers', 'symbols'] as const).map((option) => (
                <label className="generator-check-row" key={option}>
                  <input
                    checked={generatorOptions[option]}
                    onChange={(event) =>
                      setGeneratorOptions((current) => ({ ...current, [option]: event.target.checked }))
                    }
                    type="checkbox"
                  />
                  {t(`vault.generatorOptions.${option}`, { defaultValue: option })}
                </label>
              ))}
            </div>

            <div className="detail-actions generator-actions">
              <button
                className="secondary-button"
                disabled={!generatedPassword}
                onClick={useGeneratedPassword}
                type="button"
              >
                {t('vault.useGeneratedPassword', { defaultValue: 'Use in current item' })}
              </button>
              <button className="primary-button" onClick={handleStandaloneGeneratePassword} type="button">
                <KeyRound size={16} />
                {t('vault.generatePassword')}
              </button>
            </div>
          </section>
        ) : (
          <>
            <form className="detail-form" onSubmit={handleSave}>
              <fieldset className="detail-fieldset" disabled={!isEditing} onScroll={closeFieldMenus}>
                <div className="detail-header">
                  <div className="large-icon">{form.title.slice(0, 1).toUpperCase() || '+'}</div>
                  <div>
                    <input
                      aria-label={t('vault.loginTitle')}
                      className="title-input"
                      onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                      placeholder={t('vault.loginTitle')}
                      value={form.title}
                    />
                    <p>{selectedItem ? t('vault.loginItem') : t('vault.newLoginItem')}</p>
                  </div>
                  <button
                    aria-label={t('vault.favorite')}
                    className={form.favorite ? 'icon-button active' : 'icon-button'}
                    onClick={handleFavorite}
                    title={t('vault.favorite')}
                    type="button"
                  >
                    <Star size={16} />
                  </button>
                </div>

                <div className="form-grid onepassword-form">
                  {template.credentials ? (
                    <div className="wide onepassword-group">
                      <label className="onepassword-field">
                        {t('vault.username')}
                        <input
                          onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                          value={form.username}
                        />
                      </label>
                      <label className="onepassword-field">
                        {t('vault.password')}
                        <span className="password-control">
                          <input
                            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                            placeholder={t('vault.passwordPlaceholder')}
                            type={showPassword ? 'text' : 'password'}
                            value={form.password}
                          />
                          <button
                            aria-label={t('vault.showPassword')}
                            onClick={() => setShowPassword((value) => !value)}
                            title={t('vault.showPassword')}
                            type="button"
                          >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                          <button
                            aria-label={t('vault.copyPassword')}
                            onClick={copyPassword}
                            title={t('vault.copyPassword')}
                            type="button"
                          >
                            <Copy size={16} />
                          </button>
                          <button
                            aria-label={t('vault.generatePassword')}
                            onClick={handleGeneratePassword}
                            title={t('vault.generatePassword')}
                            type="button"
                          >
                            <KeyRound size={16} />
                          </button>
                        </span>
                        {passwordStrength ? (
                          <div className={`password-strength is-${passwordStrength.level}`}>
                            <span aria-hidden="true" className="password-strength-bar">
                              {strengthLevels.map((level) => (
                                <span
                                  className={
                                    strengthLevels.indexOf(level) <= strengthLevels.indexOf(passwordStrength.level)
                                      ? 'password-strength-segment filled'
                                      : 'password-strength-segment'
                                  }
                                  key={level}
                                />
                              ))}
                            </span>
                            <span className="password-strength-label">
                              <span>{t(`vault.strength.${passwordStrength.level}`)}</span>
                              <span>{t('vault.strengthBits', { bits: passwordStrength.bits })}</span>
                            </span>
                          </div>
                        ) : null}
                      </label>
                      {loginSectionFields.map(({ field, index }) => (
                        <div
                          className="onepassword-field login-custom-field"
                          key={`login-field-${field.field_type}-${index}`}
                        >
                          <input
                            aria-label={t('vault.fieldLabel')}
                            className="custom-field-name-input"
                            onChange={(event) => updateCustomField(index, { label: event.target.value })}
                            placeholder={t(`vault.customFieldDefaults.${field.field_type}`, {
                              defaultValue: t('vault.fieldLabel'),
                            })}
                            value={field.label}
                          />
                          <div className="login-custom-field-value">
                            <div className="login-custom-field-control">
                              {field.field_type === 'sign_in_with' ? (
                                <ItemSearchField
                                  ariaLabel={t('vault.signInWith')}
                                  emptyMessage={t('vault.noSearchResults')}
                                  excludeId={selectedItem?.id}
                                  items={items}
                                  onChange={(itemId) => updateCustomField(index, { value: itemId })}
                                  placeholder={t('vault.signInWithPlaceholder')}
                                  value={field.value}
                                />
                              ) : (
                                <input
                                  aria-label={t('vault.fieldValue')}
                                  className="custom-field-value-input"
                                  onChange={(event) => updateCustomField(index, { value: event.target.value })}
                                  placeholder={t(fieldValuePlaceholderKey(field.field_type))}
                                  value={field.value}
                                  {...fieldValueInputProps(field.field_type)}
                                />
                              )}
                              {field.field_type === 'otp' ? (
                                <OtpFieldActions
                                  onCopy={() => copyFieldTotp(index)}
                                  onPreview={() => previewFieldTotp(index, field.value)}
                                  preview={fieldTotpPreviews[index]}
                                  secret={field.value}
                                />
                              ) : null}
                            </div>
                            <button
                              aria-label={t('vault.removeField')}
                              className="round-remove-button"
                              onClick={() => removeCustomField(index)}
                              title={t('vault.removeField')}
                              type="button"
                            >
                              <CircleMinus size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {template.websites ? (
                    <div className="wide website-section onepassword-block">
                      <div className="website-list">
                        {form.urlsInput.map((itemUrl, index) => (
                          <div className="website-row" key={itemUrl.id}>
                            <div className="website-stack">
                              <input
                                aria-label={t('vault.urlName')}
                                className="website-name-input"
                                onChange={(event) => updateUrl(index, { label: event.target.value })}
                                placeholder={t('vault.urlName')}
                                value={itemUrl.label}
                              />
                              <input
                                aria-label={t('vault.urlAddress')}
                                className="website-address-input"
                                onChange={(event) => updateUrl(index, { url: event.target.value })}
                                placeholder="https://example.com"
                                value={itemUrl.url}
                              />
                              <select
                                aria-label={t('vault.urlMatchType')}
                                className="website-match-select"
                                onChange={(event) =>
                                  updateUrl(index, { match_type: event.target.value as UrlMatchType })
                                }
                                title={t('vault.urlMatchTypeHelp')}
                                value={itemUrl.match_type}
                              >
                                <option value="domain">{t('vault.matchTypes.domain')}</option>
                                <option value="exact">{t('vault.matchTypes.exact')}</option>
                              </select>
                            </div>
                            <button
                              aria-label={t('vault.removeWebsite')}
                              className="round-remove-button"
                              disabled={form.urlsInput.length <= 1}
                              onClick={() => removeWebsite(index)}
                              title={t('vault.removeWebsite')}
                              type="button"
                            >
                              <CircleMinus size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button className="inline-add-button" onClick={addWebsite} type="button">
                        <Plus size={16} />
                        {t('vault.addAnotherWebsite')}
                      </button>
                    </div>
                  ) : null}
                  <label className="onepassword-field standalone">
                    {t('vault.tags')}
                    <input
                      onChange={(event) => setForm((current) => ({ ...current, tagsInput: event.target.value }))}
                      placeholder={t('vault.tagsPlaceholder')}
                      value={form.tagsInput}
                    />
                  </label>
                  <label className="wide onepassword-field onepassword-block">
                    {t('vault.notes')}
                    <textarea
                      onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                      placeholder={t('vault.notePlaceholder')}
                      rows={3}
                      value={form.notes}
                    />
                  </label>
                  <div className="wide custom-fields-section">
                    {detailCustomFields.length ? (
                      <div className="custom-field-list">
                        {detailCustomFields.map(({ field, index }) => (
                          <div className="custom-field-row" key={`${field.field_type}-${index}`}>
                            <GripVertical aria-hidden="true" className="drag-handle" size={14} />
                            {field.field_type === 'section' ? (
                              <div className="section-field-card">
                                <input
                                  aria-label={t('vault.sectionName')}
                                  className="custom-field-name-input section-name-input"
                                  onChange={(event) => updateCustomField(index, { label: event.target.value })}
                                  placeholder={t('vault.sectionName')}
                                  value={field.label}
                                />
                                <div className="section-child-list">
                                  {parseSectionFields(field.value).map((child, childIndex) => (
                                    <div className="section-child-row" key={child.id ?? childIndex}>
                                      <div className="custom-field-stack">
                                        <input
                                          aria-label={t('vault.fieldLabel')}
                                          className="custom-field-name-input"
                                          onChange={(event) =>
                                            updateSectionChild(index, childIndex, { label: event.target.value })
                                          }
                                          placeholder={t(`vault.customFieldDefaults.${child.field_type}`, {
                                            defaultValue: t('vault.fieldLabel'),
                                          })}
                                          value={child.label}
                                        />
                                        <input
                                          aria-label={t('vault.fieldValue')}
                                          className="custom-field-value-input"
                                          onChange={(event) =>
                                            updateSectionChild(index, childIndex, { value: event.target.value })
                                          }
                                          placeholder={t(fieldValuePlaceholderKey(child.field_type))}
                                          value={child.value}
                                          {...fieldValueInputProps(child.field_type)}
                                        />
                                      </div>
                                      <button
                                        aria-label={t('vault.removeField')}
                                        className="round-remove-button"
                                        onClick={() => removeSectionChild(index, childIndex)}
                                        title={t('vault.removeField')}
                                        type="button"
                                      >
                                        <CircleMinus size={16} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                                <button
                                  className="inline-add-button section-add-button"
                                  onClick={(event) => toggleSectionMenu(index, event.currentTarget)}
                                  type="button"
                                >
                                  <Plus size={16} />
                                  {t('vault.addFieldToSection')}
                                </button>
                                {sectionMenuIndex === index ? (
                                  <div className="section-add-menu" style={sectionMenuAnchor?.style}>
                                    {sectionChildOptions.map((option) => (
                                      <button
                                        className="menu-option with-icon"
                                        key={option.type}
                                        onClick={() => addSectionChild(index, option.type)}
                                        type="button"
                                      >
                                        <option.icon aria-hidden="true" size={15} />
                                        <span className="menu-option-label">
                                          <span>{t(option.labelKey)}</span>
                                          {'descriptionKey' in option ? (
                                            <small>{t(option.descriptionKey)}</small>
                                          ) : null}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="custom-field-stack">
                                <input
                                  aria-label={t('vault.fieldLabel')}
                                  className="custom-field-name-input"
                                  onChange={(event) => updateCustomField(index, { label: event.target.value })}
                                  placeholder={t(`vault.customFieldDefaults.${field.field_type}`, {
                                    defaultValue: t('vault.fieldLabel'),
                                  })}
                                  value={field.label}
                                />
                                {field.field_type === 'related_item' ? (
                                  <select
                                    aria-label={t('vault.relatedItem')}
                                    className="custom-field-value-input"
                                    onChange={(event) => updateCustomField(index, { value: event.target.value })}
                                    value={field.value}
                                  >
                                    <option value="">{t('vault.chooseRelatedItem')}</option>
                                    {items
                                      .filter((item) => item.id !== selectedItem?.id)
                                      .map((item) => (
                                        <option key={item.id} value={item.id}>
                                          {item.title}
                                        </option>
                                      ))}
                                  </select>
                                ) : (
                                  <input
                                    aria-label={t('vault.fieldValue')}
                                    className="custom-field-value-input"
                                    onChange={(event) => updateCustomField(index, { value: event.target.value })}
                                    placeholder={t(fieldValuePlaceholderKey(field.field_type))}
                                    readOnly={field.field_type === 'file'}
                                    value={
                                      field.field_type === 'file' && field.value
                                        ? fileNameFromPath(field.value)
                                        : field.value
                                    }
                                    {...fieldValueInputProps(field.field_type)}
                                  />
                                )}
                                {field.field_type === 'file' ? (
                                  <div className="field-inline-actions">
                                    <button
                                      className="secondary-button"
                                      onClick={() => chooseAttachmentForField(index)}
                                      type="button"
                                    >
                                      <Paperclip size={16} />
                                      {field.value ? t('vault.changeAttachment') : t('vault.chooseAttachment')}
                                    </button>
                                    {field.value.startsWith('attachment://') ? (
                                      <button
                                        className="secondary-button"
                                        onClick={() => openAttachment(field)}
                                        type="button"
                                      >
                                        {t('vault.exportAttachment', { defaultValue: 'Export attachment' })}
                                      </button>
                                    ) : null}
                                    {field.value ? <small title={field.value}>{field.value}</small> : null}
                                  </div>
                                ) : null}
                                {field.field_type === 'related_item' && field.value ? (
                                  <div className="field-inline-actions related-item-preview">
                                    <Link size={16} />
                                    <small>{itemTitleById(items, field.value)}</small>
                                  </div>
                                ) : null}
                              </div>
                            )}
                            <button
                              aria-label={t('vault.removeField')}
                              className="round-remove-button"
                              onClick={() => removeCustomField(index)}
                              title={t('vault.removeField')}
                              type="button"
                            >
                              <CircleMinus size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="add-more-wrap">
                      <button
                        className={
                          addMoreMenuAnchor?.placement === 'above' ? 'add-more-button placement-top' : 'add-more-button'
                        }
                        onClick={(event) => toggleAddMoreMenu(event.currentTarget)}
                        type="button"
                      >
                        <Plus size={16} />
                        {t('vault.addMore')}
                        <ChevronDown size={16} />
                      </button>
                      {showAddMore ? (
                        <div className="add-more-menu" style={addMoreMenuAnchor?.style}>
                          {addMoreOptions.map((option) => (
                            <button
                              className={
                                option.type === 'section' || option.type === 'file'
                                  ? 'menu-option with-icon separated'
                                  : 'menu-option with-icon'
                              }
                              key={option.type}
                              onClick={() => addCustomField(option.type)}
                              type="button"
                            >
                              <option.icon aria-hidden="true" size={15} />
                              <span className="menu-option-label">
                                <span>{t(option.labelKey)}</span>
                                {'descriptionKey' in option ? <small>{t(option.descriptionKey)}</small> : null}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </fieldset>

              <div className="detail-actions">
                {selectedItem ? (
                  <button className="danger-button" onClick={handleDelete} type="button">
                    <Trash2 size={16} />
                    {t('vault.archiveAction')}
                  </button>
                ) : null}
                {isEditing && hasUnsavedChanges ? (
                  <span className="unsaved-hint">{t('vault.unsavedChanges')}</span>
                ) : null}
                {isEditing ? (
                  <>
                    <button className="secondary-button" onClick={handleCancelEdit} type="button">
                      {t('vault.cancelEditing')}
                    </button>
                    <button className="primary-button" disabled={saving} type="submit">
                      {saving ? t('vault.saving') : selectedItem ? t('vault.saveChanges') : t('vault.createLogin')}
                    </button>
                  </>
                ) : null}
              </div>
            </form>

            {operationMessage ? <div className="success-banner mt-300 max-w-content">{operationMessage}</div> : null}
          </>
        )}
      </section>
    </main>
  )
}

type SettingsTab =
  | 'general'
  | 'appearance'
  | 'import-export'
  | 'sync'
  | 'browser'
  | 'watchtower'
  | 'security'
  | 'shortcuts'

const settingsTabs: SettingsTab[] = [
  'general',
  'appearance',
  'import-export',
  'sync',
  'browser',
  'watchtower',
  'security',
  'shortcuts',
]

function SettingsWindow() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [operationMessage, setOperationMessage] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null)
  const [jsonPath, setJsonPath] = useState('')
  const [backupPassword, setBackupPassword] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [syncBranch, setSyncBranch] = useState('main')
  const [syncPath, setSyncPath] = useState('vault.enc')
  const [autoSync, setAutoSync] = useState(false)
  const [watchtower, setWatchtower] = useState<WatchtowerReport | null>(null)
  const [breachResult, setBreachResult] = useState<BreachCheckResult | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([])
  const [browserToken, setBrowserToken] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [securityPreferences, setSecurityPreferences] = useState<SecurityPreferences>(() => loadSecurityPreferences())
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [theme, setTheme] = useState<Theme>(() =>
    getInitialTheme(localStorage.getItem('passless-theme'), window.matchMedia('(prefers-color-scheme: dark)').matches),
  )
  const [language, setLanguage] = useState<SupportedLanguage>(() =>
    getInitialLanguage(localStorage.getItem('passless-language')),
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('passless-theme', theme)
  }, [theme])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<Theme>('passless-theme-changed', (event) => setTheme(event.payload)).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<SupportedLanguage>('passless-language-changed', (event) => {
      setLanguage(event.payload)
      localStorage.setItem('passless-language', event.payload)
      void i18n.changeLanguage(event.payload)
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<SecurityPreferences>('passless-security-preferences-changed', (event) => {
      setSecurityPreferences(event.payload)
      saveSecurityPreferences(event.payload)
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    vaultApi
      .initialize()
      .then(setStatus)
      .catch((nextError) => setError(String(nextError)))
    vaultApi.loadSyncSettings().then((settings) => {
      if (!settings) return
      setRepoUrl(settings.repo_url)
      setSyncBranch(settings.branch)
      setSyncPath(settings.path)
      setAutoSync(settings.auto_sync)
    })
    vaultApi.loadGithubPat().then((token) => {
      if (token) setGithubToken(token)
    })
    vaultApi
      .isAutostartEnabled()
      .then(setAutostartEnabled)
      .catch(() => setAutostartEnabled(false))
  }, [])

  async function updateAutostart(enabled: boolean) {
    setError(null)
    try {
      await vaultApi.setAutostart(enabled)
      setAutostartEnabled(enabled)
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  function syncConfig() {
    return {
      branch: syncBranch || 'main',
      path: syncPath || 'vault.enc',
      repo_url: repoUrl,
      token: githubToken,
    }
  }

  async function notifyVaultChanged() {
    await emit('passless-vault-changed')
  }

  async function chooseImportFile() {
    const path = await vaultApi.pickImportFile()
    if (path) setJsonPath(path)
  }

  async function chooseExportFile() {
    const path = await vaultApi.pickExportFile()
    if (path) setJsonPath(path)
  }

  async function handlePreviewImport(path: string) {
    if (!path) return
    setError(null)
    setOperationMessage(null)
    try {
      setImportPreview(await vaultApi.previewImport(path, backupPassword))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function handleJsonExport() {
    setError(null)
    setOperationMessage(null)
    try {
      const count = await vaultApi.exportBackup(jsonPath, backupPassword)
      setBackupPassword('')
      setOperationMessage(t('messages.exportedBackup', { count }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function handleJsonImport() {
    setError(null)
    setOperationMessage(null)
    try {
      const count = await vaultApi.importBackup(jsonPath, backupPassword)
      setBackupPassword('')
      await notifyVaultChanged()
      setOperationMessage(t('messages.importedBackup', { count }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function saveSyncSettings() {
    await vaultApi.saveSyncSettings({
      auto_sync: autoSync,
      branch: syncBranch || 'main',
      path: syncPath || 'vault.enc',
      repo_url: repoUrl,
    })
  }

  async function handleGithubUpload() {
    setError(null)
    setOperationMessage(null)
    try {
      const result = await vaultApi.githubUpload(syncConfig())
      if (githubToken) await vaultApi.saveGithubPat(githubToken)
      await saveSyncSettings()
      setOperationMessage(t('messages.uploaded', { commit: result.commit_sha ?? 'created', count: result.item_count }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function handleGithubDownload() {
    setError(null)
    setOperationMessage(null)
    try {
      const imported = await vaultApi.githubDownload(syncConfig())
      if (githubToken) await vaultApi.saveGithubPat(githubToken)
      await saveSyncSettings()
      await notifyVaultChanged()
      setOperationMessage(t('messages.downloaded', { count: imported }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function clearSavedGithubPat() {
    await vaultApi.deleteGithubPat()
    setGithubToken('')
    setOperationMessage(t('messages.githubTokenRemoved'))
  }

  async function loadWatchtower() {
    setError(null)
    try {
      setWatchtower(await vaultApi.watchtower())
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function checkBreaches() {
    setError(null)
    setOperationMessage(t('messages.checkingBreaches'))
    try {
      setBreachResult(await vaultApi.checkBreaches())
    } catch (nextError) {
      setError(String(nextError))
    } finally {
      setOperationMessage(null)
    }
  }

  async function createSnapshot() {
    const snapshot = await vaultApi.createSnapshot(t('messages.manualSnapshot'))
    setOperationMessage(t('messages.createdSnapshot', { count: snapshot.item_count }))
    setSnapshots(await vaultApi.listSnapshots())
  }

  async function loadSnapshots() {
    setSnapshots(await vaultApi.listSnapshots())
  }

  async function restoreSnapshot(id: string) {
    const count = await vaultApi.restoreSnapshot(id)
    await notifyVaultChanged()
    setOperationMessage(t('messages.restoredSnapshot', { count }))
  }

  async function generatePairingToken() {
    setBrowserToken(await vaultApi.generateBrowserPairingToken())
  }

  async function generateTotp() {
    const code = await vaultApi.generateTotp(totpSecret)
    setTotpCode(`${code.code} (${code.seconds_remaining}s)`)
  }

  async function closeSettingsWindow() {
    await getCurrentWebviewWindow().close()
  }

  async function updateTheme(nextTheme: Theme) {
    setTheme(nextTheme)
    await emit('passless-theme-changed', nextTheme)
  }

  async function updateLanguage(nextLanguage: SupportedLanguage) {
    setLanguage(nextLanguage)
    localStorage.setItem('passless-language', nextLanguage)
    await i18n.changeLanguage(nextLanguage)
    await emit('passless-language-changed', nextLanguage)
  }

  async function updateSecurityPreferences(nextPreferences: SecurityPreferences) {
    setSecurityPreferences(nextPreferences)
    saveSecurityPreferences(nextPreferences)
    await emit('passless-security-preferences-changed', nextPreferences)
  }

  async function updateSecurityPreference<K extends keyof SecurityPreferences>(key: K, value: SecurityPreferences[K]) {
    await updateSecurityPreferences({
      ...securityPreferences,
      [key]: value,
    })
  }

  const locked = status ? !status.unlocked : true

  return (
    <main className="settings-shell" data-tauri-drag-region>
      <aside className="settings-sidebar h-full" data-tauri-drag-region="deep">
        <div className="settings-title">
          <div className="brand-mark">
            <Cog size={16} />
          </div>
          <div>
            <strong>{t('settings.title')}</strong>
            <span>{t('settings.subtitle')}</span>
          </div>
        </div>
        <nav aria-label={t('landmarks.settingsSections')} className="settings-tabs">
          {settingsTabs.map((id) => (
            <button
              className={activeTab === id ? 'active' : ''}
              key={id}
              onClick={() => setActiveTab(id)}
              type="button"
            >
              {t(settingsTabLabels[id])}
            </button>
          ))}
        </nav>
      </aside>

      <section className="settings-content">
        <header className="settings-header" data-tauri-drag-region="deep">
          <div>
            <h1>{t(settingsTabLabels[activeTab])}</h1>
            <p>{locked ? t('settings.lockedHint') : t('settings.unlockedHint')}</p>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {operationMessage ? <div className="success-banner">{operationMessage}</div> : null}

        {activeTab === 'general' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('settings.language')}</h2>
              <p>{t('settings.languageDescription')}</p>
              <label>
                {t('settings.language')}
                <select onChange={(event) => updateLanguage(event.target.value as SupportedLanguage)} value={language}>
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="integration-card">
              <h2>{t('settings.autostart')}</h2>
              <p>{t('settings.autostartDescription')}</p>
              <label className="checkbox-row">
                <input
                  checked={autostartEnabled}
                  onChange={(event) => void updateAutostart(event.target.checked)}
                  type="checkbox"
                />
                {t('settings.autostart')}
              </label>
            </div>
            <div className="integration-card">
              <h2>{t('settings.vaultStatus')}</h2>
              <div className="watchtower-grid">
                <span>
                  {t('settings.database')}: {status?.database_ready ? t('settings.ready') : t('settings.pending')}
                </span>
                <span>
                  {t('settings.masterPassword')}:{' '}
                  {status?.has_master_password ? t('settings.configured') : t('settings.notConfigured')}
                </span>
                <span>
                  {t('settings.session')}: {status?.unlocked ? t('settings.unlocked') : t('settings.locked')}
                </span>
                <span>
                  {t('settings.app')}: {status?.name ?? 'Passless'}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'appearance' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('settings.appearance')}</h2>
              <p>{t('settings.appearanceDescription')}</p>
              <div className="integration-actions">
                <button
                  aria-pressed={theme === 'light'}
                  className="segment-button secondary-button"
                  onClick={() => updateTheme('light')}
                  type="button"
                >
                  {t('settings.light')}
                </button>
                <button
                  aria-pressed={theme === 'dark'}
                  className="segment-button secondary-button"
                  onClick={() => updateTheme('dark')}
                  type="button"
                >
                  {t('settings.dark')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'import-export' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('integrations.vaultBackup')}</h2>
              <p>{t('integrations.vaultBackupDescription')}</p>
              <label>
                {t('integrations.filePath')}
                <input
                  onChange={(event) => setJsonPath(event.target.value)}
                  placeholder="/path/to/passless-backup.json"
                  value={jsonPath}
                />
              </label>
              <label>
                {t('integrations.backupPassword')}
                <input
                  onChange={(event) => setBackupPassword(event.target.value)}
                  type="password"
                  value={backupPassword}
                />
              </label>
              <p>{t('integrations.backupPasswordHint')}</p>
              <div className="integration-actions">
                <button className="secondary-button" onClick={chooseImportFile} type="button">
                  {t('common.chooseFile')}
                </button>
                <button className="secondary-button" onClick={chooseExportFile} type="button">
                  {t('common.chooseExportPath')}
                </button>
                <button
                  className="secondary-button"
                  disabled={!jsonPath}
                  onClick={() => handlePreviewImport(jsonPath)}
                  type="button"
                >
                  {t('integrations.previewImport')}
                </button>
                <button
                  className="secondary-button"
                  disabled={!jsonPath || !backupPassword || locked}
                  onClick={handleJsonExport}
                  type="button"
                >
                  {t('integrations.exportBackup')}
                </button>
                <button
                  className="secondary-button"
                  disabled={!jsonPath || locked}
                  onClick={handleJsonImport}
                  type="button"
                >
                  {t('integrations.importBackup')}
                </button>
              </div>
              {importPreview ? (
                <div className="import-preview">
                  <strong>
                    {importPreview.encrypted && importPreview.total_items === 0
                      ? t('integrations.encryptedBackupNotice')
                      : t('integrations.importPreviewSummary', { total: importPreview.total_items })}
                  </strong>
                  {importPreview.sample_titles.length ? <small>{importPreview.sample_titles.join(', ')}</small> : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === 'sync' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('integrations.githubSync')}</h2>
              <p>{t('integrations.githubDescription')}</p>
              <div className="sync-grid">
                <label>
                  {t('integrations.repoUrl')}
                  <input
                    onChange={(event) => setRepoUrl(event.target.value)}
                    placeholder="https://github.com/user/private-vault.git"
                    value={repoUrl}
                  />
                </label>
                <label>
                  {t('integrations.pat')}
                  <input
                    onChange={(event) => setGithubToken(event.target.value)}
                    placeholder="github_pat_..."
                    type="password"
                    value={githubToken}
                  />
                </label>
                <label>
                  {t('integrations.branch')}
                  <input onChange={(event) => setSyncBranch(event.target.value)} value={syncBranch} />
                </label>
                <label>
                  {t('integrations.syncFile')}
                  <input onChange={(event) => setSyncPath(event.target.value)} value={syncPath} />
                </label>
              </div>
              <div className="integration-actions">
                <button
                  className="secondary-button"
                  disabled={!repoUrl || !githubToken || locked}
                  onClick={handleGithubUpload}
                  type="button"
                >
                  <RefreshCw size={16} />
                  {t('integrations.upload')}
                </button>
                <button
                  className="secondary-button"
                  disabled={!repoUrl || !githubToken || locked}
                  onClick={handleGithubDownload}
                  type="button"
                >
                  <RefreshCw size={16} />
                  {t('integrations.download')}
                </button>
              </div>
              <label className="checkbox-row">
                <input checked={autoSync} onChange={(event) => setAutoSync(event.target.checked)} type="checkbox" />
                {t('integrations.autoUpload')}
              </label>
              <div className="integration-actions">
                <button
                  className="secondary-button"
                  disabled={!githubToken}
                  onClick={() => vaultApi.saveGithubPat(githubToken)}
                  type="button"
                >
                  {t('integrations.savePat')}
                </button>
                <button className="secondary-button" onClick={clearSavedGithubPat} type="button">
                  {t('integrations.clearPat')}
                </button>
                <button className="secondary-button" onClick={saveSyncSettings} type="button">
                  {t('integrations.saveSyncSettings')}
                </button>
              </div>
            </div>

            <div className="integration-card">
              <h2>{t('integrations.syncHistory')}</h2>
              <p>{t('integrations.syncHistoryDescription')}</p>
              <div className="integration-actions">
                <button className="secondary-button" disabled={locked} onClick={createSnapshot} type="button">
                  {t('integrations.createSnapshot')}
                </button>
                <button className="secondary-button" disabled={locked} onClick={loadSnapshots} type="button">
                  {t('integrations.loadSnapshots')}
                </button>
              </div>
              <div className="archive-list">
                {snapshots.map((snapshot) => (
                  <button
                    className="archive-row"
                    key={snapshot.id}
                    onClick={() => restoreSnapshot(snapshot.id)}
                    type="button"
                  >
                    <strong>
                      {t('integrations.restoreSnapshot', { count: snapshot.item_count, label: snapshot.label })}
                    </strong>
                    <small>{snapshot.created_at}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'browser' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('integrations.browserExtension')}</h2>
              <p>{t('integrations.browserDescription')}</p>
              <code>http://127.0.0.1:17891</code>
              <button className="secondary-button" disabled={locked} onClick={generatePairingToken} type="button">
                {t('integrations.generatePairingToken')}
              </button>
              {browserToken ? <code>{browserToken}</code> : null}
            </div>
          </div>
        ) : null}

        {activeTab === 'watchtower' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('integrations.watchtower')}</h2>
              <p>{t('integrations.watchtowerDescription')}</p>
              <button className="secondary-button" disabled={locked} onClick={loadWatchtower} type="button">
                {t('integrations.runWatchtower')}
              </button>
              {watchtower ? (
                <div className="watchtower-grid">
                  <strong>{t('integrations.score', { score: watchtower.score })}</strong>
                  <span>{t('integrations.items', { count: watchtower.total_items })}</span>
                  <span>{t('integrations.weak', { count: watchtower.weak_passwords.length })}</span>
                  <span>{t('integrations.reused', { count: watchtower.reused_passwords.length })}</span>
                  <span>{t('integrations.missingWebsites', { count: watchtower.missing_websites.length })}</span>
                  <span>{t('integrations.missingTotp', { count: watchtower.missing_totp.length })}</span>
                  <span>{t('integrations.expiring', { count: watchtower.expiring_items.length })}</span>
                </div>
              ) : null}
              <button className="secondary-button" disabled={locked} onClick={checkBreaches} type="button">
                {t('integrations.checkBreaches')}
              </button>
              {breachResult ? (
                <p>{t('integrations.breachedResult', { count: breachResult.breached_passwords.length })}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === 'security' ? (
          <div className="settings-section">
            <div className="security-group">
              <h2>{t('security.unlock')}</h2>
              <label className="security-check-row">
                <input
                  checked={securityPreferences.unlockUsingTouchId}
                  onChange={(event) => updateSecurityPreference('unlockUsingTouchId', event.target.checked)}
                  type="checkbox"
                />
                {t('security.unlockUsingTouchId')}
              </label>
              <label className="security-check-row">
                <input
                  checked={securityPreferences.unlockWithMacPassword}
                  onChange={(event) => updateSecurityPreference('unlockWithMacPassword', event.target.checked)}
                  type="checkbox"
                />
                {t('security.unlockWithMacPassword')}
              </label>
              <label className="security-inline-row">
                <span>{t('security.unlockWithDevice')}</span>
                <select
                  onChange={(event) =>
                    updateSecurityPreference('deviceUnlockDuration', event.target.value as DeviceUnlockDuration)
                  }
                  value={securityPreferences.deviceUnlockDuration}
                >
                  {deviceUnlockOptions.map((option) => (
                    <option key={option} value={option}>
                      {t(`security.deviceUnlockOptions.${option}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="security-inline-row">
                <span>{t('security.requireAccountPassword')}</span>
                <select
                  onChange={(event) =>
                    updateSecurityPreference(
                      'accountPasswordRequirement',
                      event.target.value as AccountPasswordRequirement,
                    )
                  }
                  value={securityPreferences.accountPasswordRequirement}
                >
                  {accountPasswordOptions.map((option) => (
                    <option key={option} value={option}>
                      {t(`security.accountPasswordOptions.${option}`)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="security-help">{t('security.accountPasswordHelp')}</p>
            </div>

            <div className="security-group">
              <h2>{t('security.autoLock')}</h2>
              <label className="security-check-row">
                <input
                  checked={securityPreferences.lockWhenDeviceLocks}
                  onChange={(event) => updateSecurityPreference('lockWhenDeviceLocks', event.target.checked)}
                  type="checkbox"
                />
                {t('security.lockWhenDeviceLocks')}
              </label>
              <label className="security-inline-row">
                <span>{t('security.lockAfterIdle')}</span>
                <select
                  onChange={(event) =>
                    updateSecurityPreference('autoLockIdleDuration', event.target.value as AutoLockIdleDuration)
                  }
                  value={securityPreferences.autoLockIdleDuration}
                >
                  {autoLockIdleOptions.map((option) => (
                    <option key={option} value={option}>
                      {t(`security.autoLockOptions.${option}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="security-group">
              <h2>{t('security.clipboard')}</h2>
              <label className="security-check-row">
                <input
                  checked={securityPreferences.clearClipboardAfter90Seconds}
                  onChange={(event) => updateSecurityPreference('clearClipboardAfter90Seconds', event.target.checked)}
                  type="checkbox"
                />
                {t('security.clearClipboardAfter90Seconds')}
              </label>
              <label className="security-check-row">
                <input
                  checked={securityPreferences.useUniversalClipboard}
                  onChange={(event) => updateSecurityPreference('useUniversalClipboard', event.target.checked)}
                  type="checkbox"
                />
                {t('security.useUniversalClipboard')}
              </label>
            </div>

            <div className="integration-card">
              <h2>{t('integrations.totp')}</h2>
              <p>{t('integrations.totpDescription')}</p>
              <label>
                {t('integrations.secret')}
                <input onChange={(event) => setTotpSecret(event.target.value)} value={totpSecret} />
              </label>
              <button
                className="secondary-button"
                disabled={!totpSecret || locked}
                onClick={generateTotp}
                type="button"
              >
                {t('integrations.generateTotp')}
              </button>
              {totpCode ? <code>{totpCode}</code> : null}
            </div>
          </div>
        ) : null}

        {activeTab === 'shortcuts' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('shortcuts.title')}</h2>
              <p>{t('shortcuts.description')}</p>
              <div className="shortcut-list">
                {[
                  ['⌘ ,', 'shortcuts.openSettings'],
                  ['⌘ N', 'shortcuts.newItem'],
                  ['⌘ F', 'shortcuts.focusSearch'],
                  ['⌘ K', 'shortcuts.lockVault'],
                  ['⌘ ⇧ Space', 'shortcuts.quickAccess'],
                ].map(([keys, label]) => (
                  <div className="shortcut-row" key={keys}>
                    <kbd>{keys}</kbd>
                    <span>{t(label)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}

function QuickAccessWindow() {
  const { t } = useTranslation()
  const [items, setItems] = useState<LoginItem[]>([])
  const [query, setQuery] = useState('')
  const [locked, setLocked] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(() =>
    getInitialTheme(localStorage.getItem('passless-theme'), window.matchMedia('(prefers-color-scheme: dark)').matches),
  )
  const [language, setLanguage] = useState<SupportedLanguage>(() =>
    getInitialLanguage(localStorage.getItem('passless-language')),
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | null>(null)

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const matches = normalizedQuery
      ? items.filter(
          (item) =>
            item.title.toLowerCase().includes(normalizedQuery) ||
            item.username.toLowerCase().includes(normalizedQuery) ||
            item.website.toLowerCase().includes(normalizedQuery),
        )
      : items
    return matches.slice(0, quickAccessMaxResults)
  }, [items, query])

  async function refresh() {
    try {
      const nextStatus = await vaultApi.initialize()
      setLocked(!nextStatus.unlocked)
      setItems(nextStatus.unlocked ? await vaultApi.list() : [])
    } catch {
      // Locking between the two calls fails here too, so drop everything rather than
      // leaving secrets from the previous session on screen.
      setLocked(true)
      setItems([])
    }
  }

  async function copyPassword(item: LoginItem) {
    await navigator.clipboard.writeText(item.password)
    setCopiedId(item.id)
    hideTimerRef.current = window.setTimeout(() => void vaultApi.hideQuickAccess(), quickAccessCloseDelayMs)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      void vaultApi.hideQuickAccess()
      return
    }
    if (results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((current) => (current + 1) % results.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((current) => (current - 1 + results.length) % results.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const item = results[selectedIndex]
      if (item) void copyPassword(item)
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    void i18n.changeLanguage(language)
  }, [language])

  useEffect(() => setSelectedIndex(0), [query])

  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  useEffect(() => {
    let unlistenTheme: (() => void) | undefined
    let unlistenLanguage: (() => void) | undefined
    listen<Theme>('passless-theme-changed', (event) => setTheme(event.payload)).then((nextUnlisten) => {
      unlistenTheme = nextUnlisten
    })
    listen<SupportedLanguage>('passless-language-changed', (event) => setLanguage(event.payload)).then(
      (nextUnlisten) => {
        unlistenLanguage = nextUnlisten
      },
    )
    return () => {
      unlistenTheme?.()
      unlistenLanguage?.()
    }
  }, [])

  useEffect(() => {
    let unlistenOpened: (() => void) | undefined
    let unlistenVault: (() => void) | undefined
    let unlistenFocus: (() => void) | undefined

    inputRef.current?.focus()
    void refresh()

    listen('quick-access:opened', () => {
      setQuery('')
      setSelectedIndex(0)
      setCopiedId(null)
      inputRef.current?.focus()
      void refresh()
    }).then((nextUnlisten) => {
      unlistenOpened = nextUnlisten
    })

    listen('passless-vault-changed', () => void refresh()).then((nextUnlisten) => {
      unlistenVault = nextUnlisten
    })

    // An overlay you have to remember to close is a secret sitting on screen, so it
    // goes away as soon as focus moves elsewhere.
    getCurrentWebviewWindow()
      .onFocusChanged(({ payload }) => {
        if (!payload) void vaultApi.hideQuickAccess()
      })
      .then((nextUnlisten) => {
        unlistenFocus = nextUnlisten
      })

    return () => {
      unlistenOpened?.()
      unlistenVault?.()
      unlistenFocus?.()
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    }
  }, [])

  return (
    <main className="quick-access-shell" onKeyDown={handleKeyDown}>
      <header className="quick-access-header" data-tauri-drag-region>
        <h1>{t('quickAccess.title')}</h1>
        <button className="quick-access-close" onClick={() => void vaultApi.hideQuickAccess()} type="button">
          <X size={16} />
        </button>
      </header>

      <div className="quick-access-search" data-tauri-drag-region>
        <Search size={16} />
        <input
          aria-label={t('quickAccess.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('quickAccess.searchPlaceholder')}
          ref={inputRef}
          value={query}
        />
      </div>

      {locked ? (
        <p className="quick-access-message">{t('quickAccess.unlockPrompt')}</p>
      ) : (
        <div className="quick-access-list" ref={listRef}>
          {results.map((item, index) => (
            <button
              className="quick-access-row"
              data-row={index}
              data-selected={index === selectedIndex}
              key={item.id}
              onClick={() => void copyPassword(item)}
              type="button"
            >
              <strong>{item.title}</strong>
              <small>{item.username}</small>
              {copiedId === item.id ? <span className="quick-access-badge">{t('quickAccess.copied')}</span> : null}
            </button>
          ))}
          {results.length === 0 ? <p className="quick-access-message">{t('quickAccess.empty')}</p> : null}
        </div>
      )}

      <footer className="quick-access-footer" data-tauri-drag-region>
        {t('quickAccess.copyHint')}
      </footer>
    </main>
  )
}
