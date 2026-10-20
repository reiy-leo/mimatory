import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  Braces,
  Car,
  CaseUpper,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleMinus,
  Cog,
  Coins,
  Copy,
  CreditCard,
  Database,
  DollarSign,
  Ellipsis,
  Eye,
  EyeOff,
  Fingerprint,
  FolderInput,
  Globe,
  IdCard,
  Inbox,
  KeyRound,
  LayoutGrid,
  Mail,
  NotebookTabs,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plane,
  Plus,
  RefreshCw,
  Router,
  ScanQrCode,
  Search,
  Server,
  Settings,
  Shapes,
  Share,
  Star,
  Terminal,
  Trash2,
  Vault,
  Wifi,
  X,
} from 'lucide-react'
import {
  type CSSProperties,
  type FormEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { AddMoreControl } from './app/addMoreMenu'
import type { AddMoreFieldType } from './app/addMoreOptions'
import { useAnchoredPanel } from './app/anchoredPanel'
import {
  AttachmentEditActions,
  attachmentId,
  isTextPreviewable,
  TextPreviewDialog,
  type TextPreviewState,
} from './app/attachmentControls'
import { copyText } from './app/clipboard'
import { EditBannerPattern } from './app/editBanner'
import {
  FieldActionMenu,
  type FieldMenuAnchor,
  FieldMenuButton,
  LargeTypeOverlay,
  useLongPress,
} from './app/fieldActionControls'
import { openAndFillUrl } from './app/fieldActions'
import {
  FieldEditor,
  type FieldMeta,
  FieldView,
  openUrlExternally,
  SshFingerprintCaption,
  SshFingerprintView,
} from './app/fieldControls'
import {
  type Container,
  type ContainerLists,
  canEnter,
  keyboardTarget,
  moveFieldEntry,
  orderCredentialFields,
  type Slot,
} from './app/fieldReorder'
import {
  AddRowButton,
  AutofillBehaviorButton,
  autofillViewNote,
  EditFieldRow,
  EditSectionCard,
  type ReorderControl,
  useFieldDrag,
} from './app/fieldRows'
import i18n, { getInitialLanguage, languageOptions, type SupportedLanguage, supportedLanguages } from './app/i18n'
import { isFormDirty } from './app/itemDrafts'
import {
  applyDerivedValues,
  childDisplayLabel,
  type LabelResolver,
  newSectionChild,
  normalizeTemplateFields,
  parseSectionChildren,
  pruneEmptyTemplateFields,
  type SectionChild,
  sectionDisplayTitle,
  stringifySectionChildren,
} from './app/itemFields'
import { ItemIcon } from './app/itemIcon'
import { type ItemIconChoice, ItemIconMenuButton } from './app/itemIconMenu'
import { adjacentItemId } from './app/itemNavigation'
import {
  emptyRelationDraft,
  filterByTitle,
  hasRelations,
  type RelationDraft,
  type RelationKind,
  relationCandidates,
  relationChanges,
  relationDraftOf,
  relationRef,
} from './app/itemRelations'
import {
  defaultDirectionFor,
  type ItemSort,
  type ItemSortKey,
  itemSortKeys,
  itemSortStorageKey,
  readItemSort,
  sortItems,
} from './app/itemSort'
import {
  addTag,
  countItemTags,
  filterItemsByTag,
  removeTag,
  type TagNavigation,
  type TagRow,
  tagKey,
  tagKeyFromNavigation,
  tagList,
  tagNavigationId,
  tagRows,
} from './app/itemTags'
import { findTemplateField, getItemTemplate, sshFingerprintLabelKey, type TemplateField } from './app/itemTemplates'
import { itemTypeArtFor } from './app/itemTypeArt'
import { getLockScreenVariant, shouldShowTouchIdUnlock } from './app/lockScreen'
import { getMenuAnchorStyle, type MenuAnchor } from './app/menuPlacement'
import { type NavigationItem, navigationItems } from './app/navigation'
import { clipboardImageFile, otpSecretFromQrImage } from './app/otpQrImport'
import { PasskeyRow, passkeyCreatedAt } from './app/passkeyRow'
import { PasswordGeneratorButton } from './app/passwordGeneratorPopover'
import { featuresFor, isPrimaryModifier, quickAccessKeys, shortcutLabel } from './app/platformFeatures'
import { RelationSection } from './app/relationControls'
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
import {
  clearHighlightKeys,
  type HighlightKind,
  isHighlighted,
  readHighlightKeys,
  renameHighlightKeys,
  saveHighlightKeys,
  toggleHighlightKeys,
} from './app/sidebarHighlights'
import { SignInPicker, SignInRow, useSignInLabel } from './app/signInControls'
import { itemSignInProvider, parseSignInProvider, withSignInField } from './app/signInProviders'
import {
  forgetSiteIcons,
  loadSiteIcons,
  readSiteIconsEnabled,
  refreshSiteIcon,
  siteIconDomain,
  uniqueIconDomains,
  useSiteIconsEnabled,
  writeSiteIconsEnabled,
} from './app/siteIcons'
import {
  defaultTagColor,
  tagColorClass,
  tagColorLabelKey,
  tagColorOptions,
  tagIconComponent,
  tagIconOptions,
} from './app/tagIcons'
import { applyTheme, getInitialTheme, type Theme, themeOptions } from './app/theme'
import { Toast, toastPositions, useToastPosition, writeToastPosition } from './app/toast'
import {
  buildOtpAuthUri,
  formatOtpSecret,
  getTotpProgress,
  normalizeTotpSecret,
  otpCodeGroups,
  otpSecretFieldIndexes,
  parseOtpSecretInput,
} from './app/totpDisplay'
import {
  type AppStatus,
  type BreachCheckResult,
  type CustomField,
  customFieldsToInput,
  emptyLoginItem,
  type ItemUrl,
  type LoginItem,
  type LoginItemInput,
  type OnePuxPreview,
  type PasswordGeneratorOptions,
  parseCustomFields,
  parseTags,
  type Tag,
  tagsToInput,
  type UrlMatchType,
  type VaultSummary,
  vaultApi,
  type WatchtowerReport,
} from './app/vaultApi'
import { settingsWindowChrome, syncWindowTheme } from './app/windowChrome'
import { getTopLeftCenteredOver } from './app/windowPlacement'
import appIcon from './assets/app-icon.png'
import { currentPlatformState, usePlatformState } from './skin/runtime'

type VaultMode = 'loading' | 'setup' | 'locked' | 'unlocked'
type CategoryItemType = (typeof categoryItems)[number]['itemType']
type CategoryNavigation = `category:${CategoryItemType}`
// 'vault' is a vault row picked in the sidebar: it and All (`vaults`) are exclusive, so only one of them is ever
// highlighted (owner 2026-10-18).
type ActiveNavigation = (typeof navigationItems)[number]['id'] | CategoryNavigation | TagNavigation | 'vault'

type LoginFormState = LoginItemInput & {
  tagsInput: string
  customFieldsInput: string
  urlsInput: UrlFormState[]
  // The item's links as the form is editing them. Not part of the item payload: a save writes the
  // item first, then sends the difference from the stored links through their own commands.
  relationDraft: RelationDraft
}

type UrlFormState = ItemUrl & {
  id: string
}

type FieldTotpPreview = {
  code: string
  secondsRemaining: number
}

const defaultWebsiteLabel = 'website'
const defaultUrlMatchType: UrlMatchType = 'domain'
const quickAccessMaxResults = 8
const quickAccessCloseDelayMs = 400
// Each drag-resized column keeps its own clamp; `default` is what `--measure-*` in styles.css also
// starts the column at, and the two gutter handles below are the only thing that changes it.
const itemListWidthLimits = { default: 220, max: 250, min: 180 }
const sidebarWidthLimits = { default: 220, max: 220, min: 150 }

// Column widths the user dragged survive relaunches (owner 2026-10-18), clamped in case the limits changed.
const columnWidthStorageKey = 'passless-column-widths'

function readColumnWidth(key: 'itemList' | 'sidebar', limits: { default: number; max: number; min: number }) {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(columnWidthStorageKey) ?? '{}')?.[key]
    if (typeof stored === 'number' && Number.isFinite(stored)) return Math.min(limits.max, Math.max(limits.min, stored))
  } catch {
    // Unreadable store: fall back to the default width.
  }
  return limits.default
}

function storeColumnWidth(key: 'itemList' | 'sidebar', width: number) {
  try {
    const current = JSON.parse(globalThis.localStorage?.getItem(columnWidthStorageKey) ?? '{}')
    globalThis.localStorage?.setItem(
      columnWidthStorageKey,
      JSON.stringify({ ...(current && typeof current === 'object' ? current : {}), [key]: width }),
    )
  } catch {
    // Private mode or a full store: the width still holds for this session.
  }
}
const settingsWindowSize = { height: 680, width: 920 }

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

// Only used to decide which side of the trigger has more room, so a rough height is enough.
const menuRowHeight = 36
// Edit, highlight, delete — the highlight row reads 取消突出显示 once the row already carries one.
const tagMenuHeight = 3 * menuRowHeight + 24
// A category row has the one action, and so does a section title once it has anything to clear.
const highlightMenuHeight = menuRowHeight + 24
// Edit, archive or restore, and dissolve — the last only when the row can be emptied somewhere.
const vaultMenuHeight = 3 * menuRowHeight + 24
// The item panel is wider than the button it hangs from, and its two sections are the same height
// because only the taller one can ever be the one that has to flip above the trigger.
const itemMenuWidth = 220
// Move and Delete each carry a one-line hint while the item has links, hence the extra allowance.
const itemMenuHeight = 10 * menuRowHeight + 40

// These belong with the credentials they protect, so they render in the username /
// password group instead of the custom field list.
const loginSectionFieldTypes = ['otp', 'sign_in_with', 'passkey']
/** Passkeys Passless itself created (passkey.rs): JSON with the private key, kept but never shown. */
const passkeyCredentialFieldType = 'passkey_credential'

// One table for every item type the vault can hold: it is the sidebar's category list *and* the
// new-item picker's list, in the same order, so a type can never be creatable but nowhere to be
// found. Each row carries the accent hue its icon wears; the ramp is decoration only and never
// stands in for a status. `i18n.test.ts` reads this shape to prove every `itemTypes.*` key exists.
const sortKeyLabel: Record<ItemSortKey, string> = {
  created: 'vault.sortCreated',
  frequent: 'vault.sortFrequent',
  modified: 'vault.sortModified',
  recent: 'vault.sortRecent',
  title: 'vault.sortTitle',
}

/** The second group of the sort menu, worded for what is being sorted: A to Z, newest first, most first. */
function sortDirections(key: ItemSortKey): Array<[ItemSort['direction'], string]> {
  if (key === 'title')
    return [
      ['asc', 'vault.sortAscTitle'],
      ['desc', 'vault.sortDescTitle'],
    ]
  if (key === 'frequent')
    return [
      ['desc', 'vault.sortDescUse'],
      ['asc', 'vault.sortAscUse'],
    ]
  return [
    ['desc', 'vault.sortDescDate'],
    ['asc', 'vault.sortAscDate'],
  ]
}

const categoryItems = [
  { colorClass: 'text-accent-icon-teal', icon: KeyRound, itemType: 'login' },
  { colorClass: 'text-accent-icon-yellow', icon: NotebookTabs, itemType: 'secure_note' },
  { colorClass: 'text-accent-icon-blue', icon: CreditCard, itemType: 'credit_card' },
  { colorClass: 'text-accent-icon-green', icon: IdCard, itemType: 'identity' },
  { colorClass: 'text-accent-icon-gray', icon: KeyRound, itemType: 'password' },
  { colorClass: 'text-accent-icon-yellow', icon: Terminal, itemType: 'ssh_key' },
  { colorClass: 'text-accent-icon-orange', icon: DollarSign, itemType: 'bank_account' },
  { colorClass: 'text-accent-icon-purple', icon: Plane, itemType: 'passport' },
  { colorClass: 'text-accent-icon-orange', icon: Car, itemType: 'driver_license' },
  { colorClass: 'text-accent-icon-teal', icon: Wifi, itemType: 'wifi' },
  { colorClass: 'text-accent-icon-magenta', icon: Braces, itemType: 'api_credential' },
  { colorClass: 'text-accent-icon-gray', icon: Server, itemType: 'server' },
  { colorClass: 'text-accent-icon-lime', icon: Database, itemType: 'database' },
  { colorClass: 'text-accent-icon-magenta', icon: Mail, itemType: 'email' },
  { colorClass: 'text-accent-icon-blue', icon: Router, itemType: 'router' },
  { colorClass: 'text-accent-icon-blue', icon: BadgeCheck, itemType: 'software_license' },
  { colorClass: 'text-accent-icon-lime', icon: Coins, itemType: 'crypto_wallet' },
] as const

// Labels reach the template code as a resolver: the current language for display, every language for
// recognising a label an older build stored already translated.
const fieldLabels: LabelResolver = {
  label: (labelKey) => i18n.t(labelKey),
  variants: (labelKey) => supportedLanguages.map((language) => i18n.getFixedT(language)(labelKey)),
}

function templateFieldMeta(field: TemplateField | undefined): FieldMeta | undefined {
  if (!field) return undefined
  return {
    expiry: field.expiry,
    inputMode: field.inputMode,
    monospace: field.monospace,
    options: field.options,
    validation: field.validation,
  }
}

// These keep their own controls (a seed with QR import, an attachment, an item picker); every other type
// is drawn by the shared field components.
const specialFieldTypes = ['otp', 'file', 'related_item', 'sign_in_with', 'passkey', 'section']

function fieldValuePlaceholderKey(fieldType: string) {
  if (fieldType === 'month_year') return 'vault.monthYearPlaceholder'
  if (fieldType === 'otp') return 'vault.otpSecretPlaceholder'
  if (fieldType === 'card_number') return 'vault.cardNumberPlaceholder'
  if (fieldType === 'email') return 'vault.emailPlaceholder'
  if (fieldType === 'url') return 'vault.urlPlaceholder'
  return 'vault.fieldValue'
}

function itemTitleById(items: LoginItem[], id: string) {
  return items.find((item) => item.id === id)?.title ?? id
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

const iconById = {
  archived: Archive,
  favorites: Star,
  trash: Trash2,
  vaults: Vault,
} as const

/**
 * The one-time password as a field row of the credentials card (1Password 8, owner screenshot 2026-10-17):
 * label, then the code as "214 • 685" with a countdown pill; selecting the row copies the code, the chevron adds
 * Show in Large Type and the two ways to hand the secret to another authenticator.
 */
function OtpFieldView({
  label,
  onCopy,
  onCopySecret,
  onCopySetupLink,
  preview,
}: {
  label: string
  onCopy: () => void
  onCopySecret: () => void
  onCopySetupLink: () => void
  preview?: FieldTotpPreview
}) {
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<FieldMenuAnchor | null>(null)
  const [largeType, setLargeType] = useState(false)
  const [copied, setCopied] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const valueId = useId()
  const hintId = useId()
  const longPress = useLongPress((anchor) => setMenuAnchor(anchor))
  const copyTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    },
    [],
  )

  function copy() {
    if (!preview) return
    onCopy()
    setCopied(true)
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  const groups = preview ? otpCodeGroups(preview.code) : []
  const seconds = preview?.secondsRemaining ?? 0
  return (
    <div
      className={[
        'field-row',
        preview ? 'is-actionable' : '',
        copied ? 'is-copied' : '',
        menuAnchor ? 'is-menu-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuAnchor({ bottom: event.clientY, left: event.clientX, right: event.clientX + 220, top: event.clientY })
      }}
      ref={rowRef}
    >
      {preview ? (
        <button
          aria-describedby={hintId}
          aria-labelledby={`${labelId} ${valueId}`}
          className="field-row-primary"
          onClick={() => {
            if (longPress.consumeClick()) return
            copy()
          }}
          type="button"
          {...longPress.handlers}
        />
      ) : null}
      <div className="field-row-main">
        <span className="field-row-label" id={labelId}>
          {label}
        </span>
        <span className="field-row-value otp-value" id={valueId}>
          {preview ? (
            <>
              <span className="otp-code">
                {groups.map((group, index) => (
                  <span className="contents" key={group + index.toString()}>
                    {index > 0 ? (
                      <span aria-hidden="true" className="otp-code-separator">
                        •
                      </span>
                    ) : null}
                    <span>{group}</span>
                  </span>
                ))}
              </span>
              <span
                aria-label={t('vault.otpSecondsRemaining', { seconds })}
                className={seconds <= 5 ? 'otp-countdown is-ending' : 'otp-countdown'}
                role="timer"
                style={{ '--otp-progress': getTotpProgress(seconds).toString() } as CSSProperties}
              >
                <span aria-hidden="true" className="otp-countdown-ring" />
                <span>{seconds}</span>
              </span>
            </>
          ) : (
            <span className="field-row-caption">{t('vault.otpCodePending')}</span>
          )}
        </span>
      </div>
      <div className="field-row-actions">
        {preview ? (
          <span aria-live="polite" className="field-row-hint" id={hintId}>
            {copied ? t('fieldActions.copied') : t('fieldActions.copy')}
          </span>
        ) : null}
        <FieldMenuButton expanded={menuAnchor !== null} label={label} onOpen={setMenuAnchor} />
      </div>
      {menuAnchor ? (
        <FieldActionMenu
          actions={preview ? ['copy', 'largeType', 'copySecret', 'copySetupLink'] : ['copySecret', 'copySetupLink']}
          anchor={menuAnchor}
          label={label}
          onClose={(restoreFocus) => {
            setMenuAnchor(null)
            if (restoreFocus) rowRef.current?.querySelector<HTMLButtonElement>('.field-menu-button')?.focus()
          }}
          onSelect={(id) => {
            if (id === 'copy') copy()
            else if (id === 'largeType') setLargeType(true)
            else if (id === 'copySecret') onCopySecret()
            else if (id === 'copySetupLink') onCopySetupLink()
          }}
        />
      ) : null}
      {/* The code changes every period, so the overlay follows the live code rather than a snapshot. */}
      {largeType && preview ? (
        <LargeTypeOverlay label={label} onClose={() => setLargeType(false)} value={preview.code} />
      ) : null}
    </div>
  )
}

function OtpScanButton({ label, onScan }: { label: string; onScan: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      aria-label={`${t('fieldRows.scanQr')}: ${label}`}
      className="field-type-button"
      onClick={onScan}
      title={t('fieldRows.scanQr')}
      type="button"
    >
      <ScanQrCode aria-hidden="true" size={18} />
    </button>
  )
}

function toFormState(item: LoginItem | LoginItemInput): LoginFormState {
  // Old items gain the fields their template has grown since, and labels saved in any language find
  // their template field again; nothing here is written back until the user saves.
  const customFields = normalizeTemplateFields(item.item_type, item.custom_fields, fieldLabels)
  return {
    custom_fields: customFields,
    customFieldsInput: customFieldsToInput(customFields),
    favorite: item.favorite,
    item_type: item.item_type,
    notes: item.notes,
    password: item.password,
    relationDraft: relationDraftOf('relations' in item ? item.relations : undefined),
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
    // An empty template field is re-seeded on load, so it is not worth a row in the vault.
    custom_fields: pruneEmptyTemplateFields(form.item_type, customFields),
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

const settingsTabLabels: Record<SettingsTab, string> = {
  appearance: 'settings.tabs.appearance',
  browser: 'settings.tabs.browser',
  general: 'settings.tabs.general',
  security: 'settings.tabs.security',
  shortcuts: 'settings.tabs.shortcuts',
  watchtower: 'settings.tabs.watchtower',
}

/**
 * What the toolbar search can find in Settings (owner 2026-10-18: the search covers settings too, not just item
 * titles): each pane's section headings, plus the pane itself. Picking one opens Settings on that pane.
 */
const settingsSearchEntries: Array<{
  key: string
  requires?: 'autostart' | 'browserExtension' | 'keyboardShortcuts'
  tab: SettingsTab
}> = [
  { key: 'settings.language', tab: 'general' },
  { key: 'settings.siteIcons', tab: 'general' },
  { key: 'settings.autostart', requires: 'autostart', tab: 'general' },
  { key: 'settings.vaultStatus', tab: 'general' },
  { key: 'settings.appearance', tab: 'appearance' },
  { key: 'settings.toastPosition', tab: 'appearance' },
  { key: 'integrations.browserExtension', requires: 'browserExtension', tab: 'browser' },
  { key: 'integrations.watchtower', tab: 'watchtower' },
  { key: 'security.unlock', tab: 'security' },
  { key: 'security.autoLock', tab: 'security' },
  { key: 'security.clipboard', tab: 'security' },
  { key: 'shortcuts.title', requires: 'keyboardShortcuts', tab: 'shortcuts' },
]

/** Settings opened from the toolbar search land on this pane: the window's URL for a new one, an event otherwise. */
const settingsTabEvent = 'passless://settings-tab'

function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && (settingsTabs as string[]).includes(value)
}

export function App() {
  const view = new URLSearchParams(window.location.search).get('view')

  // These are tools, not pages: the webview's own right-click menu offers reload, inspect element and
  // Save As, none of which belong in a password vault. Every window mounts through here, so one
  // listener covers all three, and the tag rows' own menu is a React handler that runs first.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => event.preventDefault()
    window.addEventListener('contextmenu', onContextMenu)
    return () => window.removeEventListener('contextmenu', onContextMenu)
  }, [])

  if (view === 'settings') {
    return <SettingsWindow />
  }
  if (view === 'quick-access') {
    return <QuickAccessWindow />
  }

  return <VaultWindow />
}

function SidebarSectionToggle({
  collapsed,
  label,
  onContextMenu,
  onToggle,
}: {
  collapsed: boolean
  label: string
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onToggle: () => void
}) {
  return (
    <button
      aria-expanded={!collapsed}
      className="sidebar-section-title section-toggle"
      onClick={onToggle}
      onContextMenu={onContextMenu}
      type="button"
    >
      <span>{label}</span>
      {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
    </button>
  )
}

type StyleDraft = { color: string; icon: string; name: string }

// A tag and a vault are styled by the same three choices — a name, one of the shared glyph set, one of
// the accent hues — so the dialog offering them is one component rather than two grids that can drift apart.
function StyleEditorDialog({
  draft,
  nameLabel,
  onCancel,
  onDraftChange,
  onSubmit,
  title,
  titleId,
}: {
  draft: StyleDraft
  nameLabel: string
  onCancel: () => void
  onDraftChange: (patch: Partial<StyleDraft>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  title: string
  titleId: string
}) {
  const { t } = useTranslation()
  const nameInputRef = useRef<HTMLInputElement>(null)

  // The dialog mounts when the row is opened, so this runs once per edit: typing in the name — or
  // picking an icon — must not drag the caret back to the field every keystroke.
  useEffect(() => {
    nameInputRef.current?.focus()
  }, [])

  return (
    <div className="confirm-layer">
      <button aria-label={t('common.close')} className="confirm-backdrop" onClick={onCancel} type="button" />
      <div aria-labelledby={titleId} aria-modal="true" className="confirm-dialog" role="dialog">
        <h2 id={titleId}>{title}</h2>
        <form onSubmit={onSubmit}>
          <label>
            {nameLabel}
            <input
              onChange={(event) => onDraftChange({ name: event.target.value })}
              ref={nameInputRef}
              type="text"
              value={draft.name}
            />
          </label>
          <fieldset className="tag-icon-picker">
            <legend>{t('vault.tagIcon')}</legend>
            <div className="tag-icon-grid">
              {tagIconOptions.map((option) => (
                <button
                  aria-label={t(`tagIcons.${option.name}`)}
                  aria-pressed={draft.icon === option.name}
                  className="tag-icon-option"
                  key={option.name}
                  onClick={() => onDraftChange({ icon: option.name })}
                  type="button"
                >
                  <option.icon aria-hidden="true" size={16} />
                </button>
              ))}
            </div>
          </fieldset>
          {/* Tags are one of the places a system hue stands for itself rather than for a status, so the
              picker offers every hue and "none" alongside it. */}
          <fieldset className="tag-color-picker">
            <legend>{t('vault.tagColor')}</legend>
            <div className="tag-color-row">
              {tagColorOptions.map((option) => (
                <button
                  aria-label={t(tagColorLabelKey(option.name))}
                  aria-pressed={draft.color === option.name}
                  className={`tag-color-option ${option.swatchClass}`}
                  key={option.name === defaultTagColor ? 'none' : option.name}
                  onClick={() => onDraftChange({ color: option.name })}
                  type="button"
                />
              ))}
            </div>
          </fieldset>
          <div className="confirm-actions">
            <button className="secondary-button" onClick={onCancel} type="button">
              {t('vault.cancelEditing')}
            </button>
            <button className="primary-button" disabled={!draft.name.trim()} type="submit">
              {t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function VaultWindow() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [mode, setMode] = useState<VaultMode>('loading')
  const [items, setItems] = useState<LoginItem[]>([])
  // All (owner 2026-10-18): every open vault's live items. `items` stays the open vault's (the session's), which
  // the vault row lists and every edit acts on; every other sidebar row reads this.
  const [allItems, setAllItems] = useState<LoginItem[] | null>(null)
  const [itemSort, setItemSort] = useState<ItemSort>(() => readItemSort(globalThis.localStorage))
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The phone layout (src/skin/platform.ts: any window ≤ 760px, so every phone) shows one pane at a time:
  // the item list, the item, the sidebar as a Browse page, or Settings, switched by a bottom tab bar.
  const { layout, platform } = usePlatformState()
  const features = featuresFor(platform)
  const isMobileLayout = layout === 'mobile'
  const [mobileTab, setMobileTab] = useState<'browse' | 'items' | 'settings'>('items')
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [vaults, setVaults] = useState<VaultSummary[]>([])
  const [activeVaultId, setActiveVaultId] = useState('personal')
  const [itemListWidth, setItemListWidth] = useState(() => readColumnWidth('itemList', itemListWidthLimits))
  const [sidebarWidth, setSidebarWidth] = useState(() => readColumnWidth('sidebar', sidebarWidthLimits))
  const [activeNavigation, setActiveNavigation] = useState<ActiveNavigation>('vaults')
  const [topSearch, setTopSearch] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const masterPasswordInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [operationMessage, setOperationMessage] = useState<string | null>(null)
  const [onePuxPreview, setOnePuxPreview] = useState<OnePuxPreview | null>(null)
  const [isImporting1pux, setIsImporting1pux] = useState(false)
  const [archivedItems, setArchivedItems] = useState<LoginItem[]>([])
  const [trashedItems, setTrashedItems] = useState<LoginItem[]>([])
  // The item whose permanent delete is being confirmed. There is no native confirm in this webview,
  // so the question is state the window has to render itself.
  const [purgeTarget, setPurgeTarget] = useState<LoginItem | null>(null)
  const [textPreview, setTextPreview] = useState<TextPreviewState | null>(null)
  const textPreviewRequest = useRef(0)
  const closeTextPreview = useCallback(() => {
    textPreviewRequest.current += 1
    setTextPreview(null)
  }, [])
  // A new vault's name. window.prompt() answers null here without showing a box, so the question is
  // drawn in the page with the same modal recipe as the purge confirmation above.
  const [isCreatingVault, setIsCreatingVault] = useState(false)
  const [vaultNameDraft, setVaultNameDraft] = useState('')
  const vaultNameInputRef = useRef<HTMLInputElement>(null)
  const [biometricsAvailable, setBiometricsAvailable] = useState(false)
  const [securityPreferences, setSecurityPreferences] = useState<SecurityPreferences>(() => loadSecurityPreferences())
  const [form, setForm] = useState<LoginFormState>(() => toFormState(emptyLoginItem()))
  // The two sidebar sections fold on their own: neither is a view you select, and a long tag or
  // category list otherwise pushes the rest of the sidebar out of the window.
  const [categoriesCollapsed, setCategoriesCollapsed] = useState(false)
  const [tagsCollapsed, setTagsCollapsed] = useState(false)
  // Archived vaults are the exception rather than the list, so that group starts folded and only
  // appears at all once a vault has been put away.
  const [vaultsCollapsed, setVaultsCollapsed] = useState(false)
  const [archivedVaultsCollapsed, setArchivedVaultsCollapsed] = useState(true)
  // A highlighted row is the one exception to a fold: it stays on screen while the rest of its section is
  // put away. The keys name the kind and the row (`tag:work`, `category:login`) and live in localStorage
  // beside the theme, because which rows you want kept is how the window reads, not what the vault holds.
  const [highlights, setHighlights] = useState<string[]>(() => readHighlightKeys())
  // A new item asks for its type before anything is written, and the category the pick lands in is
  // focused in the sidebar — so the row you just committed to is the row you can see.
  const [itemTypePickerOpen, setItemTypePickerOpen] = useState(false)
  const [categoryToFocus, setCategoryToFocus] = useState<CategoryItemType | null>(null)
  const categoryListRef = useRef<HTMLDivElement>(null)
  const itemTypeFirstOptionRef = useRef<HTMLButtonElement>(null)
  // The New Item dropdown hangs from whichever button opened it; ⌘N anchors it to the toolbar's button.
  const newItemButtonRef = useRef<HTMLButtonElement>(null)
  const itemTypeTriggerRef = useRef<HTMLElement | null>(null)
  const itemTypePanelRef = useRef<HTMLDivElement>(null)
  const { style: itemTypePanelPlaced } = useAnchoredPanel(itemTypePickerOpen, itemTypeTriggerRef, itemTypePanelRef, {
    align: 'end',
    width: itemMenuWidth,
  })
  // Which kind of link the item picker is choosing for, if it is open, and what its search box holds.
  const [relationPicker, setRelationPicker] = useState<RelationKind | null>(null)
  const [relationQuery, setRelationQuery] = useState('')
  const relationSearchRef = useRef<HTMLInputElement>(null)
  // The "Sign in with…" sheet (Add More); it edits the form's provider field and its sign-in link.
  const [signInPickerOpen, setSignInPickerOpen] = useState(false)
  const siteIconsEnabled = useSiteIconsEnabled()
  const signInLabel = useSignInLabel()
  // One panel holds everything that can be done to a stored item, opened either from the header's
  // ellipsis or by right-clicking the row. `move` is the vault list swapped into the same panel rather
  // than a second anchor that could cover the trigger, and the source decides which of the two rows
  // that only make sense in one of the two places are offered — 编辑 where there is no 编辑 button,
  // 分享 where the row is not already the whole subject.
  const [itemMenu, setItemMenu] = useState<'actions' | 'move' | null>(null)
  const [itemMenuSource, setItemMenuSource] = useState<'header' | 'row'>('header')
  const [itemMenuAnchor, setItemMenuAnchor] = useState<MenuAnchor>()
  // The header's ellipsis menu is measured and placed against its trigger (flips above, never leaves the window);
  // a row's right-click menu still opens at the cursor.
  const itemMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const itemMenuPanelRef = useRef<HTMLDivElement>(null)
  const { style: itemMenuPlaced } = useAnchoredPanel(
    itemMenu !== null && itemMenuSource === 'header',
    itemMenuTriggerRef,
    itemMenuPanelRef,
    { align: 'end', width: itemMenuWidth },
  )
  // A tag's spelling and icon live on the storage row, while which rows the sidebar shows — and how many
  // items each names — is read off the live items, so the two are joined per render. All three panels
  // below address a tag by name, because a name is the only handle an item carries.
  const [tagRecords, setTagRecords] = useState<Tag[]>([])
  const [tagMenu, setTagMenu] = useState<TagRow | null>(null)
  const [tagMenuAnchor, setTagMenuAnchor] = useState<MenuAnchor>()
  // A category row carries no storage of its own, so its right-click has the one row to offer. The
  // section title is the only place every highlight in that section can be dropped at once.
  const [categoryMenu, setCategoryMenu] = useState<CategoryItemType | null>(null)
  const [categoryMenuAnchor, setCategoryMenuAnchor] = useState<MenuAnchor>()
  const [sectionHighlightMenu, setSectionHighlightMenu] = useState<HighlightKind | null>(null)
  const [sectionHighlightMenuAnchor, setSectionHighlightMenuAnchor] = useState<MenuAnchor>()
  const [tagEditor, setTagEditor] = useState<{ color: string; from: string; icon: string; name: string } | null>(null)
  const [tagDeleteTarget, setTagDeleteTarget] = useState<TagRow | null>(null)
  // A vault row is now addressed the same way a tag row is: the menu the right-click opens names the
  // row, the editor restyles it, and the dissolve panel asks where its items should go first.
  const [vaultMenu, setVaultMenu] = useState<VaultSummary | null>(null)
  const [vaultMenuAnchor, setVaultMenuAnchor] = useState<MenuAnchor>()
  const [vaultEditor, setVaultEditor] = useState<{ color: string; icon: string; id: string; name: string } | null>(null)
  const [vaultDissolveTarget, setVaultDissolveTarget] = useState<VaultSummary | null>(null)
  const [vaultDissolveInto, setVaultDissolveInto] = useState('')
  const [showAddMore, setShowAddMore] = useState(false)
  const [sectionMenuIndex, setSectionMenuIndex] = useState<number | null>(null)
  const [fieldTotpPreviews, setFieldTotpPreviews] = useState<Record<number, FieldTotpPreview>>({})
  // Which seed input is showing its value. A saved seed is not a display value, so it rests as dots and
  // only the field being typed in reveals itself — see `fieldValueInputProps`.
  const [focusedOtpField, setFocusedOtpField] = useState('')
  const otpInputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const otpFileInputRef = useRef<HTMLInputElement>(null)
  const otpFileTarget = useRef<number | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  // Whether the pane is showing a draft instead of a saved item. Without it, "nothing selected" and
  // "writing a new item" are one state, so trashing the open item dropped into a blank create form.
  const [composing, setComposing] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  // ⌘R reveals every secure field of the open item; leaving the item (or editing it) conceals them again.
  const [revealAllSecure, setRevealAllSecure] = useState(false)
  const itemShortcutRef = useRef<(event: KeyboardEvent) => void>(() => {})
  // What the current form was loaded from. A ref, not state: the switch effect below runs only
  // when the selected item changes, and it has to compare the outgoing form against the baseline
  // that form came from.
  const baselineRef = useRef(form)
  const editLockedRef = useRef(false)
  const draftKeyRef = useRef('')
  const draftsRef = useRef<Record<string, LoginFormState>>({})
  const formRef = useRef(form)
  const [lastActivityAt, setLastActivityAt] = useState(() => Date.now())
  const topSearchInputRef = useRef<HTMLInputElement>(null)
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme(localStorage.getItem('passless-theme')))
  const [, setLanguage] = useState<SupportedLanguage>(() =>
    getInitialLanguage(localStorage.getItem('passless-language')),
  )

  useEffect(() => {
    localStorage.setItem('passless-theme', theme)
    syncWindowTheme(theme, currentPlatformState().platform)
    return applyTheme(theme)
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
    loadTrashedItems().catch((nextError) => setError(String(nextError)))
  }, [mode])

  useEffect(() => {
    if (mode !== 'unlocked') return
    const updateActivity = () => setLastActivityAt(Date.now())
    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    for (const eventName of events) {
      window.addEventListener(eventName, updateActivity, { capture: true, passive: true })
    }
    return () => {
      for (const eventName of events) window.removeEventListener(eventName, updateActivity, { capture: true })
    }
  }, [mode])

  // The lock screen's password field takes focus from an effect rather than `autoFocus`, the same way
  // every other panel in the window focuses its first field.
  useEffect(() => {
    if (mode === 'locked' || mode === 'setup') masterPasswordInputRef.current?.focus()
  }, [mode])

  useEffect(() => {
    if (mode !== 'unlocked') return
    const handleShortcut = (event: KeyboardEvent) => {
      if (!isPrimaryModifier(event, currentPlatformState().platform)) return
      if (editLockedRef.current) {
        if ([',', 'n', 'f', 'k'].includes(event.key.toLowerCase())) event.preventDefault()
        return
      }
      const key = event.key.toLowerCase()
      if (key === ',') {
        event.preventDefault()
        void openSettingsWindow()
      } else if (key === 'n') {
        event.preventDefault()
        openItemTypePicker()
      } else if (key === 'f' && !event.shiftKey) {
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

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? allItems?.find((item) => item.id === selectedId) ?? null,
    [allItems, items, selectedId],
  )

  // An item picked from All (or a tag, a category, Favorites) may live in another vault. The session follows it
  // there quietly, so editing, favouriting and moving keep acting on the vault the item is in, while the sidebar
  // keeps the row the user picked.
  const followingVaultRef = useRef<string | null>(null)
  useEffect(() => {
    if (mode !== 'unlocked' || isEditing || !selectedId) return
    const target = allItems?.find((item) => item.id === selectedId)?.vault_id
    if (!target || target === activeVaultId || followingVaultRef.current === target) return
    followingVaultRef.current = target
    vaultApi
      .switchVault(target)
      .then(async (nextItems) => {
        setActiveVaultId(target)
        setItems(Array.isArray(nextItems) ? nextItems : [])
        await loadArchivedItems()
        await loadTrashedItems()
      })
      .catch((nextError: unknown) => setError(String(nextError)))
      .finally(() => {
        followingVaultRef.current = null
      })
  }, [activeVaultId, allItems, isEditing, mode, selectedId])

  useEffect(() => setRevealAllSecure(false), [selectedId, isEditing])

  useEffect(() => {
    if (mode !== 'unlocked') return
    const handleItemShortcut = (event: KeyboardEvent) => itemShortcutRef.current(event)
    window.addEventListener('keydown', handleItemShortcut)
    return () => window.removeEventListener('keydown', handleItemShortcut)
  }, [mode])

  // The sidebar lists the two kinds of vault separately: what is in use, and what has been put away
  // with everything inside it.
  const openVaults = useMemo(() => vaults.filter((vault) => !vault.archived), [vaults])
  const archivedVaults = useMemo(() => vaults.filter((vault) => vault.archived), [vaults])

  // The move list is the picker minus the vault already open: an item cannot move to where it is. An
  // archived vault is out too — a live item parked inside one would be reachable from neither row.
  const otherVaults = useMemo(
    () => vaults.filter((vault) => !vault.archived && vault.id !== activeVaultId),
    [activeVaultId, vaults],
  )

  const activeTagKey = tagKeyFromNavigation(activeNavigation)

  // The vault row lists the open vault; every other row — All, Favorites, a category, a tag — reads across every
  // open vault (owner 2026-10-18: sidebar rows are exclusive and tags belong to All, not to a vault).
  const scopeItems = activeNavigation === 'vault' ? items : (allItems ?? items)
  const visibleItems = useMemo(() => {
    const pick = () => {
      // Archived and trash each have their own list and their own rows, so neither reads live items.
      if (activeNavigation === 'trash' || activeNavigation === 'archived') return []
      if (activeNavigation === 'favorites') return scopeItems.filter((item) => item.favorite)
      if (activeTagKey) return filterItemsByTag(scopeItems, activeTagKey)
      if (activeNavigation.startsWith('category:')) {
        const itemType = activeNavigation.replace('category:', '')
        return scopeItems.filter((item) => item.item_type === itemType)
      }
      return scopeItems
    }
    return sortItems(pick(), itemSort, i18n.language)
  }, [activeNavigation, activeTagKey, i18n.language, itemSort, scopeItems])

  // Both state views read their own list instead of the live items, and each row's restore means a
  // different return: out of the trash, or back into the vault.
  const stateRows = activeNavigation === 'trash' ? trashedItems : activeNavigation === 'archived' ? archivedItems : null
  const restoreStateItem = activeNavigation === 'trash' ? restoreTrashedItem : restoreArchivedItem

  // Counted from the whole vault rather than `visibleItems`, because a sidebar number has to say how
  // many a click will reveal — not how many the current selection already shows. Search is excluded
  // for the same reason: the list can be filtered while the sidebar keeps its meaning.
  const allScope = allItems ?? items
  const navigationCounts = useMemo(() => {
    const counts: Record<string, number> = {
      // Both state views are separate reads, so both counts come from their own list.
      archived: archivedItems.length,
      favorites: allScope.filter((item) => item.favorite).length,
      trash: trashedItems.length,
      vaults: allScope.length,
    }
    for (const item of allScope) {
      const category = `category:${item.item_type}`
      counts[category] = (counts[category] ?? 0) + 1
    }
    return counts
  }, [allScope, archivedItems, trashedItems])

  // Tags are counted across every open vault and shown whatever row is selected (owner 2026-10-18).
  const tagCounts = useMemo(() => countItemTags(allScope, i18n.language), [allScope, i18n.language])
  const activeTagName = tagCounts.find((entry) => entry.key === activeTagKey)?.name ?? activeTagKey

  // The icon is the one thing about a tag the item list does not carry, so the rows are read back
  // whenever that list changes — which is also when a tag can have appeared or gone away.
  useEffect(() => {
    if (mode !== 'unlocked') return
    let stale = false
    vaultApi
      .allTags()
      .then((nextTags) => {
        if (!stale && Array.isArray(nextTags)) setTagRecords(nextTags)
      })
      .catch((nextError: unknown) => setError(String(nextError)))
    vaultApi
      .allItems()
      .then((nextItems) => {
        if (!stale) setAllItems(Array.isArray(nextItems) ? nextItems : null)
      })
      .catch((nextError: unknown) => setError(String(nextError)))
    return () => {
      stale = true
    }
  }, [items, mode, vaults])

  const sidebarTags = useMemo(() => tagRows(tagCounts, tagRecords), [tagCounts, tagRecords])
  // A folded section still shows the rows the user asked to keep, so a highlight is what survives the
  // collapse rather than a second list that can drift away from the section it belongs to.
  const visibleTags = tagsCollapsed
    ? sidebarTags.filter((tag) => isHighlighted(highlights, 'tag', tag.key))
    : sidebarTags
  const visibleCategories = categoriesCollapsed
    ? categoryItems.filter((category) => isHighlighted(highlights, 'category', category.itemType))
    : categoryItems

  const topSearchResults = useMemo(() => {
    const normalizedQuery = topSearch.trim().toLowerCase()
    if (!normalizedQuery) return []
    return allScope.filter((item) => item.title.toLowerCase().includes(normalizedQuery)).slice(0, 8)
  }, [items, topSearch])

  const topSettingsResults = useMemo(() => {
    const normalizedQuery = topSearch.trim().toLowerCase()
    if (!normalizedQuery) return []
    const seen = new Set<string>()
    return settingsSearchEntries
      .filter((entry) => !entry.requires || features[entry.requires])
      .map((entry) => ({ ...entry, label: t(entry.key), paneLabel: t(settingsTabLabels[entry.tab]) }))
      .filter(({ label, paneLabel }) => `${label} ${paneLabel}`.toLowerCase().includes(normalizedQuery))
      .filter(({ label }) => (seen.has(label) ? false : (seen.add(label), true)))
      .slice(0, 5)
  }, [features, t, topSearch])

  const template = useMemo(() => getItemTemplate(form.item_type), [form.item_type])

  // A type without username / password columns still shows them when an item saved under the old login
  // layout has something in them, so nothing a user typed before the template existed goes missing.
  const showCredentials = Boolean(template.credentials || form.username || form.password)
  const showUsername = Boolean(template.credentials ? template.credentials.username || form.username : true)
  const usernameLabel = t(template.credentials?.usernameLabelKey ?? 'vault.username')
  const passwordLabel = t(template.credentials?.passwordLabelKey ?? 'vault.password')
  const hasSignInField = form.custom_fields.some((field) => field.field_type === 'sign_in_with')
  const showWebsites = template.websites || form.urlsInput.some((itemUrl) => itemUrl.url.trim())

  // Original custom_fields indexes are kept so every mutator still addresses the right row.
  const customFieldEntries = useMemo(
    () =>
      form.custom_fields.flatMap((field, index) =>
        // A passkey's key material is the app's, never a row: the passkey row stands for it.
        field.field_type === passkeyCredentialFieldType ? [] : [{ field, index }],
      ),
    [form.custom_fields],
  )
  // OTP, passkeys and sign-in methods belong to the credential they protect. On a category
  // with no credential block they fall back to the plain custom-field list instead of
  // disappearing with it.
  const inCredentialBlock = (field: CustomField) => showCredentials && loginSectionFieldTypes.includes(field.field_type)
  // Fixed order, no handles (owner 2026-10-18): username, password, sign-in method, passkeys, one-time passwords.
  const loginSectionFields = useMemo(
    () => orderCredentialFields(customFieldEntries.filter(({ field }) => inCredentialBlock(field))),
    [customFieldEntries, showCredentials],
  )
  const detailCustomFields = useMemo(
    () => customFieldEntries.filter(({ field }) => !inCredentialBlock(field)),
    [customFieldEntries, showCredentials],
  )
  // The read-only view shows what is filled in and nothing else.
  const viewLoginFields = loginSectionFields.filter(
    ({ field }) => field.field_type !== 'otp' && (field.field_type === 'passkey' || field.value.trim()),
  )
  const viewWebsites = form.urlsInput.filter((itemUrl) => itemUrl.url.trim())
  const viewSections = detailCustomFields.flatMap(({ field, index }) => {
    if (field.field_type !== 'section') return []
    const children = parseSectionChildren(field.value).filter((child: SectionChild) => child.value.trim())
    if (!children.length) return []
    return [{ children, index, title: sectionDisplayTitle(form.item_type, field, fieldLabels) }]
  })
  const viewOtherFields = detailCustomFields.filter(
    ({ field }) => field.field_type !== 'section' && field.field_type !== 'otp' && field.value.trim(),
  )
  const detailFieldIndexes = useMemo(() => detailCustomFields.map(({ index }) => index), [detailCustomFields])
  // Read straight off the field list rather than the credential block: a secret filed under
  // "more fields" still protects a login, so the two-factor card has to find it there.
  const otpFieldIndexes = useMemo(() => otpSecretFieldIndexes(form.custom_fields), [form.custom_fields])
  const viewOtpIndexes = otpFieldIndexes.filter((index) => form.custom_fields[index]?.value.trim())

  // The links as each mode draws them: read-only reads what the vault returned, editing reads the draft
  // (ids resolved through the live list, or the stored ref for an archived counterpart).
  const selectedHasRelations = hasRelations(selectedItem?.relations)
  const viewRelations = selectedItem?.relations
  const draftRelationRefs = (ids: string[]) =>
    ids.flatMap((id) => {
      const ref = relationRef(id, items, selectedItem?.relations)
      return ref ? [ref] : []
    })
  const editParentRefs = draftRelationRefs(form.relationDraft.parentId ? [form.relationDraft.parentId] : [])
  const editChildRefs = draftRelationRefs(form.relationDraft.childIds)
  const editRelatedRefs = draftRelationRefs(form.relationDraft.relatedIds)
  const relationPickerItems = relationPicker
    ? filterByTitle(
        relationCandidates(items, selectedItem?.id ?? null, relationPicker, form.relationDraft),
        relationQuery,
      )
    : []

  // The category the sidebar is showing is the category a new item belongs to, which is
  // what decides both the layout and the fields an empty item starts out with.
  const newItemCategory = activeNavigation.startsWith('category:')
    ? activeNavigation.slice('category:'.length)
    : 'login'

  // A draft belongs to whatever the form is showing: a saved item, or the category a new
  // item is being built under.
  const draftKey = selectedItem?.id ?? `new:${newItemCategory}`
  const hasUnsavedChanges = isFormDirty(baselineRef.current, form)
  // Editing locks the rest of the window (owner 2026-10-18, first for unsaved edits, then for any open editor —
  // a new item included): until the form is saved or cancelled nothing else — sidebar, list, toolbar, settings,
  // shortcuts — may act, so no edit is ever left behind. The notice only appears once there is something to lose.
  const editLocked = isEditing
  function chooseSort(next: ItemSort) {
    setItemSort(next)
    setSortMenuOpen(false)
    try {
      globalThis.localStorage?.setItem(itemSortStorageKey, JSON.stringify(next))
    } catch {
      // Private mode or a full store: the choice still holds for this session.
    }
  }

  useEffect(() => {
    if (!sortMenuOpen) return
    const close = (event: Event) => {
      if (event.composedPath().some((node) => node instanceof Element && node.hasAttribute('data-sort-menu'))) return
      setSortMenuOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSortMenuOpen(false)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onEscape)
    }
  }, [sortMenuOpen])

  const editBannerHue = `var(--color-icon-accent-${(
    categoryItems.find((entry) => entry.itemType === form.item_type)?.colorClass ?? 'text-accent-icon-gray'
  ).replace('text-accent-icon-', '')})`
  editLockedRef.current = editLocked
  // inert does the work where the webview supports it; the capture guard swallows any click that still gets
  // through (older WebKitGTK, jsdom) before a row's own handler sees it.
  const swallowWhileLocked = (event: SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const lockedRegion = (
    editLocked ? { 'aria-disabled': true, inert: '', onClickCapture: swallowWhileLocked } : {}
  ) as Record<string, unknown>

  const listTitle = useMemo(() => {
    if (activeNavigation === 'favorites') return t('listTitle.favorites')
    if (activeTagKey) return activeTagName ?? t('listTitle.tags')
    if (activeNavigation === 'trash') return t('listTitle.trash')
    if (activeNavigation === 'archived') return t('listTitle.archived')
    if (activeNavigation.startsWith('category:')) {
      const itemType = activeNavigation.replace('category:', '')
      return t(`itemTypes.${itemType}`)
    }
    if (activeNavigation === 'vault')
      return vaults.find((vault) => vault.id === activeVaultId)?.name ?? t('listTitle.vaults')
    return t('listTitle.vaults')
  }, [activeNavigation, activeTagName, activeVaultId, t, vaults])

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
    // A saved item opens read-only unless a draft is waiting on it; an unsaved draft is always
    // editable, but only while the user is actually composing one.
    if (selectedItem) setComposing(false)
    setIsEditing(selectedItem ? Boolean(restored) : composing)
    draftKeyRef.current = draftKey
    setShowPassword(false)
    setFieldTotpPreviews({})
    setFocusedOtpField('')
    setTagDraft('')
  }, [draftKey])

  // The panel opens on the keyboard, so the caret has to be where the typing goes. `autoFocus` would
  // add a third lint error to this file's baseline, and it only fires on mount anyway.
  useEffect(() => {
    if (isCreatingVault) vaultNameInputRef.current?.focus()
  }, [isCreatingVault])

  // The type picker's grid is all buttons, so it opens on the first one — Tab from there walks the
  // rest, and Return picks. Same reason the create-vault panel takes the caret by effect, not by
  // `autoFocus`.
  useEffect(() => {
    if (itemTypePickerOpen) itemTypeFirstOptionRef.current?.focus()
  }, [itemTypePickerOpen])

  // The item picker opens on its search field, so typing narrows the list straight away.
  useEffect(() => {
    if (relationPicker) relationSearchRef.current?.focus()
  }, [relationPicker])

  // Website icons: show what the vault already holds for every listed site, and fetch the missing or
  // stale ones in the background when the setting allows it. A newly saved address arrives here with
  // the re-listed items, which is how an item gets its icon on save.
  useEffect(() => {
    if (mode !== 'unlocked' || !siteIconsEnabled) return
    void loadSiteIcons(uniqueIconDomains([...items, ...archivedItems, ...trashedItems]), { download: true })
  }, [archivedItems, items, mode, siteIconsEnabled, trashedItems])

  // The category a new draft was built under is scrolled into view and focused, which has to happen
  // after the row exists: an unfolded section and its rows arrive in the same commit as this state.
  useEffect(() => {
    if (!categoryToFocus) return
    const row = categoryListRef.current?.querySelector<HTMLButtonElement>(`[data-item-type="${categoryToFocus}"]`)
    setCategoryToFocus(null)
    if (!row) return
    row.scrollIntoView({ block: 'nearest' })
    // The scroll above already chose where the row lands; focus would otherwise scroll it again.
    row.focus({ preventScroll: true })
  }, [categoryToFocus])

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

  // In read-only mode nothing else asks for a code, so a saved secret generates its own as soon as the
  // item is selected. While editing, the secret is half-typed and every keystroke would fail to decode,
  // so the field row keeps its explicit preview button instead.
  useEffect(() => {
    if (isEditing) return
    const pendingIndexes = otpFieldIndexes.filter((index) => !fieldTotpPreviews[index])
    if (!pendingIndexes.length) return
    for (const index of pendingIndexes) {
      const secret = form.custom_fields[index]?.value
      if (secret) void previewFieldTotp(index, secret, true)
    }
  }, [fieldTotpPreviews, form.custom_fields, isEditing, otpFieldIndexes])

  // Listening on the webview rather than on the dropzone, because the event's position is in physical
  // pixels from the webview's corner — deciding which element was under the cursor would mean undoing
  // that scaling by hand. The whole window is therefore the target while an item is open for editing.
  useEffect(() => {
    if (!isEditing) return
    let unlisten: (() => void) | undefined
    let unsubscribed = false
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          setIsDraggingFiles(false)
          void attachDroppedFiles(event.payload.paths)
          return
        }
        setIsDraggingFiles(event.payload.type === 'enter' || event.payload.type === 'over')
      })
      .then((nextUnlisten) => {
        if (unsubscribed) nextUnlisten()
        else unlisten = nextUnlisten
      })
    return () => {
      unsubscribed = true
      unlisten?.()
      setIsDraggingFiles(false)
    }
  }, [isEditing, selectedId])

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
      loadArchivedItems().catch((nextError) => setError(String(nextError)))
      loadTrashedItems().catch((nextError) => setError(String(nextError)))
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
    setComposing(false)
    setIsCreatingVault(false)
    setVaultNameDraft('')
    setIsEditing(false)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const input = toInput(form)
      if (!input.title) {
        // A thrown message reaches the banner as "Error: 标题必填" through String(), so the
        // validation failure is written straight to the banner and the save never starts.
        setError(t('vault.titleRequired'))
        return
      }
      const saved = selectedItem ? await vaultApi.update(selectedItem.id, input) : await vaultApi.create(input)
      // Links are written after the item exists (a new item has no id before this), removals first.
      // A refused link (Rust re-checks cycles) is reported, but the item's own fields stay saved.
      let relationError: unknown = null
      const baselineRelations = selectedItem ? baselineRef.current.relationDraft : emptyRelationDraft
      for (const change of relationChanges(saved.id, baselineRelations, form.relationDraft)) {
        try {
          if (change.kind === 'setParent') await vaultApi.setParent(change.itemId, change.parentId)
          else if (change.kind === 'link') await vaultApi.linkRelated(saved.id, change.otherId)
          else if (change.kind === 'setSignIn') await vaultApi.setSignIn(saved.id, change.accountId)
          else await vaultApi.unlinkRelated(saved.id, change.otherId)
        } catch (nextError) {
          relationError = relationError ?? nextError
        }
      }
      const nextItems = await vaultApi.list()
      const fresh = toFormState(nextItems.find((item) => item.id === saved.id) ?? saved)
      // A save retires the draft and moves the form off its `new:` key, so the switch effect
      // below does not file the just-saved values as unsaved edits on the old key.
      delete draftsRef.current[draftKeyRef.current]
      draftKeyRef.current = saved.id
      baselineRef.current = fresh
      setForm(fresh)
      if (relationError) setError(String(relationError))
      setItems(nextItems)
      setSelectedId(saved.id)
      setComposing(false)
      setIsEditing(false)
    } catch (nextError) {
      setError(String(nextError))
    } finally {
      setSaving(false)
    }
  }

  // Links can change from the other end (another item picking this one as its parent) without this
  // form being reloaded, so editing starts from the stored links rather than from what the form held.
  function beginEdit() {
    closeFieldMenus()
    const stored = relationDraftOf(selectedItem?.relations)
    baselineRef.current = { ...baselineRef.current, relationDraft: stored }
    setForm((current) => ({ ...current, relationDraft: stored }))
    setIsEditing(true)
  }

  function openRelationPicker(kind: RelationKind) {
    closeFieldMenus()
    setRelationQuery('')
    setRelationPicker(kind)
  }

  function pickRelation(id: string) {
    const kind = relationPicker
    setRelationPicker(null)
    if (!kind) return
    setForm((current) => {
      const draft = current.relationDraft
      const next: RelationDraft =
        kind === 'parent'
          ? { ...draft, parentId: id }
          : kind === 'child'
            ? { ...draft, childIds: [...draft.childIds, id] }
            : { ...draft, relatedIds: [...draft.relatedIds, id] }
      return { ...current, relationDraft: next }
    })
  }

  function removeRelation(kind: RelationKind, id: string) {
    setForm((current) => {
      const draft = current.relationDraft
      const next: RelationDraft =
        kind === 'parent'
          ? { ...draft, parentId: null }
          : kind === 'child'
            ? { ...draft, childIds: draft.childIds.filter((childId) => childId !== id) }
            : { ...draft, relatedIds: draft.relatedIds.filter((relatedId) => relatedId !== id) }
      return { ...current, relationDraft: next }
    })
  }

  // A linked item opens in the pane like a list click would; the list's own filter is left alone.
  function openRelatedItem(id: string) {
    closeFieldMenus()
    setOperationMessage(null)
    setSelectedId(id)
  }

  function relationIcon(itemType: string) {
    const category = categoryItems.find((entry) => entry.itemType === itemType)
    return { colorClass: category?.colorClass ?? 'text-accent-icon-gray', icon: category?.icon ?? KeyRound }
  }

  function relationTypeLabel(itemType: string) {
    return t(`itemTypes.${itemType}`)
  }

  function handleCancelEdit() {
    closeFieldMenus()
    delete draftsRef.current[draftKeyRef.current]
    setForm(baselineRef.current)
    setShowPassword(false)
    setFieldTotpPreviews({})
    setFocusedOtpField('')
    setTagDraft('')
    setComposing(false)
    setIsEditing(false)
  }

  // The chip box is a view of `tagsInput`, so committing only rewrites that one string. Leaving the
  // field with a half-typed tag still saves it, because the tag was never in a separate place.
  function commitTagDraft() {
    const pending = tagDraft.trim()
    if (!pending) return
    setForm((current) => ({ ...current, tagsInput: addTag(current.tagsInput, pending) }))
    setTagDraft('')
  }

  function removeLastTag() {
    const tags = tagList(form.tagsInput)
    const last = tags[tags.length - 1]
    if (!last) return
    setForm((current) => ({ ...current, tagsInput: removeTag(current.tagsInput, last) }))
  }

  function buildDraftForm(itemType: string): LoginFormState {
    return toFormState({
      ...emptyLoginItem(),
      // `toFormState` seeds the template's sections into an empty field list.
      custom_fields: [],
      item_type: itemType,
    })
  }

  function openItemTypePicker(trigger?: HTMLElement) {
    if (itemTypePickerOpen) {
      setItemTypePickerOpen(false)
      return
    }
    setError(null)
    setOperationMessage(null)
    closeFieldMenus()
    itemTypeTriggerRef.current = trigger ?? newItemButtonRef.current
    setItemTypePickerOpen(true)
  }

  function handleNewItem(itemType: CategoryItemType) {
    setMobileDetailOpen(true)
    setMobileTab('items')
    setSelectedId(null)
    setForm(buildDraftForm(itemType))
    setShowPassword(false)
    closeFieldMenus()
    setComposing(true)
    setIsEditing(true)
    setItemTypePickerOpen(false)
    // The draft belongs to its category, so the view follows it and the row it came from is unfolded
    // and focused — a pick that left no trace in the sidebar would be indistinguishable from a no-op.
    setCategoriesCollapsed(false)
    setActiveNavigation(`category:${itemType}`)
    setCategoryToFocus(itemType)
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
      setComposing(false)
      await loadArchivedItems()
      await loadTrashedItems()
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  function openCreateVault() {
    setError(null)
    setOperationMessage(null)
    setVaultNameDraft('')
    setIsCreatingVault(true)
  }

  function closeCreateVault() {
    setIsCreatingVault(false)
    setVaultNameDraft('')
  }

  // The name arrives from the panel, not from window.prompt(): wry leaves WKUIDelegate's text-input
  // method unimplemented, so prompt() answered null without showing a box and the button did nothing.
  async function handleCreateVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = vaultNameDraft.trim()
    if (!name) return
    setError(null)
    try {
      const vault = await vaultApi.createVault(name)
      const nextVaults = await vaultApi.listVaults()
      setVaults(nextVaults)
      setActiveVaultId(vault.id)
      setItems([])
      setArchivedItems([])
      setTrashedItems([])
      setSelectedId(null)
      setForm(toFormState(emptyLoginItem()))
      // A new vault has nothing to open, so the first item starts here instead of at an empty list.
      setComposing(true)
      setIsEditing(true)
      closeCreateVault()
      setOperationMessage(t('messages.createdVault', { name: vault.name }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  // The same anchored panel a tag row opens: it hangs off the cursor's height and the row's width so it
  // reads as belonging to that vault without covering it.
  function openVaultMenu(event: ReactMouseEvent<HTMLButtonElement>, vault: VaultSummary) {
    const rect = event.currentTarget.getBoundingClientRect()
    setVaultMenu(vault)
    setVaultMenuAnchor(
      getMenuAnchorStyle({
        menuHeight: vaultMenuHeight,
        rect: { bottom: event.clientY, left: rect.left, top: event.clientY, width: rect.width },
        viewportHeight: window.innerHeight,
      }),
    )
  }

  function openVaultEditor() {
    if (!vaultMenu) return
    setVaultEditor({ color: vaultMenu.color, icon: vaultMenu.icon, id: vaultMenu.id, name: vaultMenu.name })
    closeFieldMenus()
  }

  function closeVaultEditor() {
    setVaultEditor(null)
  }

  async function handleVaultSave(event: FormEvent<HTMLFormElement>) {
    if (!vaultEditor) return
    event.preventDefault()
    const name = vaultEditor.name.trim()
    if (!name) return
    setError(null)
    try {
      await vaultApi.updateVault({ color: vaultEditor.color, icon: vaultEditor.icon, id: vaultEditor.id, name })
      await loadVaults()
      closeVaultEditor()
      // A vault is addressed by id, so renaming it moves nothing — the row is the same row.
      setOperationMessage(t('messages.updatedVault', { name }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  // Archiving a vault archives what is in it as well, so its items reach the 已归档 view rather than
  // hiding behind a row the sidebar folded away. Restoring gives back only what the vault took.
  async function handleVaultArchive() {
    if (!vaultMenu) return
    const vault = vaultMenu
    const archived = !vault.archived
    setError(null)
    try {
      await vaultApi.setVaultArchived(archived, vault.id)
      closeFieldMenus()
      const nextVaults = await vaultApi.listVaults()
      setVaults(nextVaults)
      // Putting away the vault being read leaves the app on a row that is no longer in the list, so it
      // moves to the next one still open — unless none is, which is the one case left parked.
      if (archived && vault.id === activeVaultId) {
        const nextId = nextVaults.find((next) => !next.archived)?.id
        if (nextId) {
          await handleSwitchVault(nextId)
        } else {
          await refreshItems()
          await loadArchivedItems()
          await loadTrashedItems()
        }
      }
      setOperationMessage(t(archived ? 'messages.archivedVault' : 'messages.restoredVault', { name: vault.name }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  // Where a dissolved vault's items can go: another vault still in use.
  function dissolveDestinationsFor(vault: VaultSummary) {
    return vaults.filter((other) => !other.archived && other.id !== vault.id)
  }

  // The last vault in the file cannot be dissolved and a full one needs somewhere to send its items, so
  // the row that meets neither offers no destructive option at all.
  function canDissolveVault(vault: VaultSummary) {
    return vaults.length > 1 && (vault.item_count === 0 || dissolveDestinationsFor(vault).length > 0)
  }

  function askVaultDissolve() {
    if (!vaultMenu) return
    // A vault with nothing in it has nowhere to send anything, so it is opened with no destination
    // chosen and the command is given none — only a full one has to say where its items go.
    setVaultDissolveInto(vaultMenu.item_count > 0 ? (dissolveDestinationsFor(vaultMenu)[0]?.id ?? '') : '')
    setVaultDissolveTarget(vaultMenu)
    closeFieldMenus()
  }

  async function handleVaultDissolve() {
    if (!vaultDissolveTarget) return
    const vault = vaultDissolveTarget
    // An empty vault has nothing to send anywhere, which is the only case the command takes no
    // destination for. With items, a destination is the whole point of the panel.
    const intoId = vaultDissolveInto || null
    if (vault.item_count > 0 && !intoId) return
    setError(null)
    try {
      await vaultApi.dissolveVault(vault.id, intoId)
      setVaultDissolveTarget(null)
      setVaultDissolveInto('')
      const nextVaults = await vaultApi.listVaults()
      setVaults(nextVaults)
      setOperationMessage(t('messages.dissolvedVault', { name: vault.name }))
      // The backend session may have been reading the row just deleted, so the app re-points it by
      // switching — to the vault the items went to, or to whatever is left.
      if (vault.id === activeVaultId) {
        await handleSwitchVault(intoId ?? nextVaults[0]?.id ?? 'personal')
      } else {
        await refreshItems()
        await loadArchivedItems()
        await loadTrashedItems()
      }
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  // The toolbar's previous / next buttons and ⌘↑ / ⌘↓: one step through the list on screen, never wrapping.
  const visibleItemIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems])
  const previousItemId = adjacentItemId(visibleItemIds, selectedId, -1)
  const nextItemId = adjacentItemId(visibleItemIds, selectedId, 1)
  function stepSelectedItem(step: -1 | 1): boolean {
    if (editLocked) return false
    const target = step === -1 ? previousItemId : nextItemId
    if (!target) return false
    closeFieldMenus()
    setSelectedId(target)
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-item-row]')).find(
      (element) => element.dataset.itemRow === target,
    )
    row?.scrollIntoView?.({ block: 'nearest' })
    return true
  }

  function jumpToSearchResult(itemId: string) {
    setActiveNavigation('vaults')
    setSelectedId(itemId)
    setTopSearch('')
    setMobileDetailOpen(true)
  }
  // A gutter drag measures from where the drag began rather than accumulating, so a column stops at
  // its own limits instead of drifting once the cursor has run past them.
  function beginColumnResize(
    event: ReactMouseEvent<HTMLButtonElement>,
    input: {
      key: 'itemList' | 'sidebar'
      limits: { max: number; min: number }
      onWidth: (width: number) => void
      startWidth: number
    },
  ) {
    event.preventDefault()
    const startX = event.clientX
    let width = input.startWidth
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = input.startWidth + (moveEvent.clientX - startX)
      width = Math.min(input.limits.max, Math.max(input.limits.min, nextWidth))
      input.onWidth(width)
    }
    const handleMouseUp = () => {
      storeColumnWidth(input.key, width)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  function beginItemListResize(event: ReactMouseEvent<HTMLButtonElement>) {
    beginColumnResize(event, {
      key: 'itemList',
      limits: itemListWidthLimits,
      onWidth: setItemListWidth,
      startWidth: itemListWidth,
    })
  }

  function beginSidebarResize(event: ReactMouseEvent<HTMLButtonElement>) {
    beginColumnResize(event, {
      key: 'sidebar',
      limits: sidebarWidthLimits,
      onWidth: setSidebarWidth,
      startWidth: sidebarWidth,
    })
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

  // Both Add More menus are one component (addMoreMenu.tsx) that places itself in a portal layer.
  function toggleAddMoreMenu() {
    const next = !showAddMore
    closeFieldMenus()
    setShowAddMore(next)
  }

  function toggleSectionMenu(sectionIndex: number) {
    const next = sectionMenuIndex === sectionIndex ? null : sectionIndex
    closeFieldMenus()
    setSectionMenuIndex(next)
  }

  function closeFieldMenus() {
    setCategoryMenu(null)
    setCategoryMenuAnchor(undefined)
    setItemMenu(null)
    setItemMenuAnchor(undefined)
    setSectionMenuIndex(null)
    setSectionHighlightMenu(null)
    setSectionHighlightMenuAnchor(undefined)
    setShowAddMore(false)
    setTagMenu(null)
    setTagMenuAnchor(undefined)
    setVaultMenu(null)
    setVaultMenuAnchor(undefined)
  }

  // The panel hangs off the cursor's height and the row's width, so it reads as belonging to that tag
  // without covering the row it came from. The native menu is already prevented at the window.
  function openTagMenu(event: ReactMouseEvent<HTMLButtonElement>, tag: TagRow) {
    closeFieldMenus()
    setTagMenu(tag)
    const rect = event.currentTarget.getBoundingClientRect()
    setTagMenuAnchor(
      getMenuAnchorStyle({
        menuHeight: tagMenuHeight,
        rect: { bottom: event.clientY, left: rect.left, top: event.clientY, width: rect.width },
        viewportHeight: window.innerHeight,
      }),
    )
  }

  // A highlight is a display preference rather than vault data, so the only work is the key set and the
  // write that carries it to the next launch.
  function applyHighlights(nextKeys: string[]) {
    setHighlights(nextKeys)
    saveHighlightKeys(nextKeys)
  }

  function toggleRowHighlight(kind: HighlightKind, id: string) {
    applyHighlights(toggleHighlightKeys(highlights, kind, id))
    closeFieldMenus()
  }

  // A category row has no storage of its own to edit, so its right-click opens the same anchored panel
  // a tag row does with the one row it has to offer.
  function openCategoryMenu(event: ReactMouseEvent<HTMLButtonElement>, itemType: CategoryItemType) {
    closeFieldMenus()
    setCategoryMenu(itemType)
    const rect = event.currentTarget.getBoundingClientRect()
    setCategoryMenuAnchor(
      getMenuAnchorStyle({
        menuHeight: highlightMenuHeight,
        rect: { bottom: event.clientY, left: rect.left, top: event.clientY, width: rect.width },
        viewportHeight: window.innerHeight,
      }),
    )
  }

  // The title folds its own section, so its right-click clears only that section's highlights — and a
  // section with none has nothing left for the panel to say, so it does not open at all.
  function openSectionHighlightMenu(event: ReactMouseEvent<HTMLButtonElement>, kind: HighlightKind) {
    // A stored key that names no row would clear nothing, so only rows actually drawn can open this.
    const highlighted =
      kind === 'tag'
        ? sidebarTags.some((tag) => isHighlighted(highlights, 'tag', tag.key))
        : categoryItems.some((category) => isHighlighted(highlights, 'category', category.itemType))
    if (!highlighted) return
    closeFieldMenus()
    setSectionHighlightMenu(kind)
    const rect = event.currentTarget.getBoundingClientRect()
    setSectionHighlightMenuAnchor(
      getMenuAnchorStyle({
        menuHeight: highlightMenuHeight,
        rect: { bottom: rect.bottom, left: rect.left, top: rect.top, width: rect.width },
        viewportHeight: window.innerHeight,
      }),
    )
  }

  function clearSectionHighlights() {
    if (!sectionHighlightMenu) return
    applyHighlights(clearHighlightKeys(highlights, sectionHighlightMenu))
    closeFieldMenus()
  }

  function openTagEditor() {
    if (!tagMenu) return
    setTagEditor({ color: tagMenu.color, from: tagMenu.name, icon: tagMenu.icon, name: tagMenu.name })
    closeFieldMenus()
  }

  function closeTagEditor() {
    setTagEditor(null)
  }

  async function handleTagSave(event: FormEvent<HTMLFormElement>) {
    if (!tagEditor) return
    event.preventDefault()
    const name = tagEditor.name.trim()
    if (!name) return
    const wasFilteredOn = activeNavigation === tagNavigationId(tagKey(tagEditor.from))
    setError(null)
    try {
      await vaultApi.updateTag({
        color: tagEditor.color,
        from: tagEditor.from,
        icon: tagEditor.icon,
        name,
      })
      await refreshItems()
      closeTagEditor()
      // A rename changes the key the view is addressed by, so the filter follows the tag rather than
      // falling back to the whole vault mid-edit.
      if (wasFilteredOn) setActiveNavigation(tagNavigationId(tagKey(name)))
      // The highlight is addressed by that same key, so a rename carries it to the new spelling instead
      // of quietly unpinning the row the user just kept.
      if (tagKey(tagEditor.from) !== tagKey(name)) {
        applyHighlights(renameHighlightKeys(highlights, 'tag', tagKey(tagEditor.from), tagKey(name)))
      }
      // The dialog saves the styling and the name together, so a run of icon clicks is not a rename.
      setOperationMessage(t(name === tagEditor.from ? 'messages.updatedTag' : 'messages.renamedTag', { name }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  function askTagDelete() {
    if (!tagMenu) return
    setTagDeleteTarget(tagMenu)
    closeFieldMenus()
  }

  async function handleTagDelete() {
    if (!tagDeleteTarget) return
    const wasFilteredOn = activeNavigation === tagNavigationId(tagDeleteTarget.key)
    setError(null)
    try {
      await vaultApi.deleteTag(tagDeleteTarget.name)
      await refreshItems()
      setTagDeleteTarget(null)
      // The label is gone, so the view it was reached through is too; the items it named stay.
      if (wasFilteredOn) setActiveNavigation('vaults')
      setOperationMessage(t('messages.deletedTag', { name: tagDeleteTarget.name }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  // Every transient panel here has to dismiss itself. wry implements none of the WKUIDelegate
  // dialog methods, so there is no native sheet to lean on, and all three menus are anchored to
  // the viewport — which lets one cover the very button that opened it.
  useEffect(() => {
    const menuOpen =
      categoryMenu !== null ||
      itemMenu !== null ||
      sectionHighlightMenu !== null ||
      sectionMenuIndex !== null ||
      showAddMore ||
      tagMenu !== null ||
      vaultMenu !== null
    if (
      !menuOpen &&
      !purgeTarget &&
      !isCreatingVault &&
      !tagEditor &&
      !tagDeleteTarget &&
      !itemTypePickerOpen &&
      !relationPicker &&
      !signInPickerOpen &&
      !vaultEditor &&
      !vaultDissolveTarget
    )
      return
    const handleClick = (event: MouseEvent) => {
      if (!menuOpen && !itemTypePickerOpen) return
      // composedPath() is fixed when the click is dispatched, so a click that swaps the menu's contents
      // (移动到 replaces the action list with the vault list) still counts as inside the menu even
      // though its button is no longer in the document when the click reaches window.
      const insideMenu = event
        .composedPath()
        .some((node) => node instanceof Element && node.hasAttribute('data-field-menu'))
      if (insideMenu) return
      closeFieldMenus()
      setItemTypePickerOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (menuOpen) closeFieldMenus()
      setPurgeTarget(null)
      setRelationPicker(null)
      setSignInPickerOpen(false)
      closeCreateVault()
      closeTagEditor()
      setTagDeleteTarget(null)
      setItemTypePickerOpen(false)
      closeVaultEditor()
      setVaultDissolveTarget(null)
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    categoryMenu,
    isCreatingVault,
    itemMenu,
    itemTypePickerOpen,
    purgeTarget,
    relationPicker,
    sectionHighlightMenu,
    sectionMenuIndex,
    showAddMore,
    signInPickerOpen,
    tagDeleteTarget,
    tagEditor,
    tagMenu,
    vaultDissolveTarget,
    vaultEditor,
    vaultMenu,
  ])

  async function addCustomField(fieldType: AddMoreFieldType) {
    // Not a free-text field: it opens the sheet that picks the provider and the account.
    if (fieldType === 'sign_in_with') {
      openSignInPicker()
      return
    }
    const attachmentPath = fieldType === 'file' ? await vaultApi.pickAttachmentFile() : null
    if (fieldType === 'file' && !attachmentPath) {
      setShowAddMore(false)
      return
    }
    const label = t(`vault.customFieldDefaults.${fieldType}`)
    setForm((current) => {
      const value = fieldType === 'section' ? stringifySectionChildren([]) : (attachmentPath ?? '')
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
    if (fieldType !== 'section')
      focusNewLabel(showCredentials && loginSectionFieldTypes.includes(fieldType) ? 'login' : 'top')
  }

  function removeCustomField(index: number) {
    setForm((current) => {
      const removed = current.custom_fields[index]
      // Removing a passkey row deletes the passkey itself: its key for that relying party goes too.
      const customFields = current.custom_fields.filter(
        (field, fieldIndex) =>
          fieldIndex !== index &&
          !(
            removed?.field_type === 'passkey' &&
            field.field_type === passkeyCredentialFieldType &&
            field.label.toLowerCase() === removed.label.toLowerCase()
          ),
      )
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
        // The provider and the account it signs in with go together.
        relationDraft:
          removed?.field_type === 'sign_in_with' ? { ...current.relationDraft, signInId: null } : current.relationDraft,
      }
    })
  }

  function openSignInPicker() {
    closeFieldMenus()
    setSignInPickerOpen(true)
  }

  function applySignIn(provider: Parameters<typeof withSignInField>[1], accountId: string | null) {
    setSignInPickerOpen(false)
    setForm((current) => {
      const customFields = withSignInField(current.custom_fields, provider)
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
        relationDraft: { ...current.relationDraft, signInId: accountId },
      }
    })
  }

  // The list's second line: "Sign in with Google" for an item that has no password of its own to
  // speak of, otherwise the username, the site or the type, as before.
  function itemSubtitle(item: LoginItem) {
    const provider = itemSignInProvider(item)
    if (provider) return signInLabel(provider)
    return item.username || item.website || t(`itemTypes.${item.item_type}`)
  }

  async function handleRefreshIcon() {
    if (!selectedItem) return
    closeFieldMenus()
    const domain = siteIconDomain(selectedItem)
    if (!domain) return
    try {
      if (selectedItem.icon_mode === 'letter') await vaultApi.setIconMode(selectedItem.id, 'auto')
      const icon = await refreshSiteIcon(domain)
      setItems(await vaultApi.list())
      setOperationMessage(t(icon ? 'messages.iconRefreshed' : 'messages.iconNotFound'))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  // The detail header's tile when no website icon shows: the item type's colour art (the list keeps its letter).
  const headerArtUrl = itemTypeArtFor(form.item_type)
  const headerArt = headerArtUrl ? (
    <span className="large-icon is-art">
      <img alt="" draggable={false} src={headerArtUrl} />
    </span>
  ) : undefined
  // The edit header's icon badge: what the app can do with this item's icon. These act on the stored item, like
  // the same rows in the item menu, so they are offered only once it is saved and has a website.
  const iconChoices: ItemIconChoice[] =
    selectedItem && siteIconDomain(selectedItem)
      ? [
          selectedItem.icon_mode === 'letter'
            ? {
                icon: Globe,
                id: 'website',
                label: t('vault.siteIcon.useWebsite'),
                onSelect: () => void handleIconMode('auto'),
              }
            : {
                icon: Shapes,
                id: 'type',
                label: t('vault.siteIcon.hideWebsite'),
                onSelect: () => void handleIconMode('letter'),
              },
          ...(siteIconsEnabled
            ? [
                {
                  icon: RefreshCw,
                  id: 'refresh',
                  label: t('vault.siteIcon.refresh'),
                  onSelect: () => void handleRefreshIcon(),
                },
              ]
            : []),
        ]
      : []

  async function handleIconMode(mode: 'auto' | 'letter') {
    if (!selectedItem) return
    closeFieldMenus()
    try {
      await vaultApi.setIconMode(selectedItem.id, mode)
      setItems(await vaultApi.list())
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function previewFieldTotp(index: number, secret: string, silent = false) {
    if (!secret.trim()) return
    if (!silent) setError(null)
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
      // A secret that no longer decodes should not stop the detail view from opening; the card has no
      // code to show until it is fixed, and opening an item is not an error.
      if (!silent) setError(String(nextError))
    }
  }

  async function copyFieldTotp(index: number) {
    const preview = fieldTotpPreviews[index]
    if (!preview) return
    // A code is a secret for its 30 seconds; it follows the same clipboard clear as a password.
    await copySecretText(preview.code)
    setOperationMessage(t('messages.copiedOtp'))
  }

  async function copyTotpSecret(index: number) {
    const secret = form.custom_fields[index]?.value
    if (!secret) return
    await copySecretText(normalizeTotpSecret(secret))
    setOperationMessage(t('messages.copiedSecret'))
  }

  async function copyTotpSetupLink(index: number) {
    const secret = form.custom_fields[index]?.value
    if (!secret) return
    await copySecretText(buildOtpAuthUri({ account: form.username, issuer: form.title, secret }))
    setOperationMessage(t('messages.copiedSetupLink'))
  }

  async function importOtpQrImage(index: number, image: Blob) {
    setError(null)
    const seed = await otpSecretFromQrImage(image)
    if (!seed) {
      setError(t('vault.readQrEmpty'))
      return
    }
    updateCustomField(index, { value: seed })
  }

  function handleOtpPaste(index: number, event: ReactClipboardEvent<HTMLInputElement>) {
    const image = clipboardImageFile(event)
    if (!image) return
    event.preventDefault()
    void importOtpQrImage(index, image)
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

  // Tauri intercepts a native file drop before the webview sees it and delivers one window-wide event
  // carrying real paths, so this is the only way a drop can reach the vault. It is accepted while editing
  // only: a drop must not quietly change a saved item the user is reading.
  async function attachDroppedFiles(paths: string[]) {
    let attached = 0
    for (const path of paths) {
      try {
        const attachedField = selectedItem ? await vaultApi.attachFileToItem(selectedItem.id, path) : null
        setForm((current) => {
          const customFields = [
            ...current.custom_fields,
            {
              field_type: 'file',
              label: attachedField?.label ?? fileNameFromPath(path),
              value: attachedField?.value ?? path,
            },
          ]
          return {
            ...current,
            custom_fields: customFields,
            customFieldsInput: customFieldsToInput(customFields),
          }
        })
        attached += 1
      } catch (nextError) {
        setError(String(nextError))
        return
      }
    }
    if (attached === 1) setOperationMessage(t('messages.attachmentAdded'))
    else if (attached > 1) setOperationMessage(t('messages.attachmentsAdded', { files: attached }))
  }

  async function openAttachment(field: CustomField) {
    if (!field.value.startsWith('attachment://')) return
    setError(null)
    try {
      const path = await vaultApi.exportAttachmentToTemp(field.value.replace('attachment://', ''))
      setOperationMessage(t('messages.exportedAttachment', { path }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  // A `.txt` attachment opens in the preview sheet. The latest request wins, so a slow read of one file never
  // replaces a sheet the user has since opened for another (or closed).
  async function openTextPreview(field: CustomField) {
    const id = attachmentId(field.value)
    if (!id) return
    const request = textPreviewRequest.current + 1
    textPreviewRequest.current = request
    const fileName = field.label.trim()
    setTextPreview({ fileName, status: 'loading' })
    try {
      const result = await vaultApi.readAttachmentText(id)
      if (textPreviewRequest.current === request) setTextPreview({ fileName, result, status: 'ready' })
    } catch (nextError) {
      if (textPreviewRequest.current === request)
        setTextPreview({ error: String(nextError), fileName, status: 'error' })
    }
  }

  function updateSectionChild(sectionIndex: number, childIndex: number, patch: Partial<CustomField>) {
    setForm((current) => {
      const customFields = current.custom_fields.map((field, fieldIndex) => {
        if (fieldIndex !== sectionIndex) return field
        const sectionFields = parseSectionChildren(field.value)
        const changed = sectionFields[childIndex]
        const nextSectionFields = sectionFields.map((child, index) =>
          index === childIndex ? { ...child, ...patch } : child,
        )
        // A card number names its network and a public key its type, filled into an empty sibling.
        const derived =
          changed && patch.value !== undefined
            ? applyDerivedValues(current.item_type, sectionFields, nextSectionFields, changed.id)
            : nextSectionFields
        return { ...field, value: stringifySectionChildren(derived) }
      })
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  // A field just added is named first (1Password focuses the new row's label), in whichever list it landed.
  function focusNewLabel(container: string) {
    window.setTimeout(() => {
      const labels = document.querySelectorAll<HTMLInputElement>(
        `[data-reorder-container="${container}"] .field-row-label-input`,
      )
      const label = labels[labels.length - 1]
      label?.focus()
      label?.select()
    }, 0)
  }

  function addSectionChild(sectionIndex: number, fieldType: AddMoreFieldType) {
    setSectionMenuIndex(null)
    focusNewLabel(`section:${sectionIndex}`)
    setForm((current) => {
      const customFields = current.custom_fields.map((field, fieldIndex) => {
        if (fieldIndex !== sectionIndex) return field
        const sectionFields = parseSectionChildren(field.value)
        return {
          ...field,
          value: stringifySectionChildren([
            ...sectionFields,
            newSectionChild(fieldType, t(`vault.customFieldDefaults.${fieldType}`)),
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
        const nextSectionFields = parseSectionChildren(field.value).filter((_, index) => index !== childIndex)
        return { ...field, value: stringifySectionChildren(nextSectionFields) }
      })
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  const fieldLists = useMemo<ContainerLists>(
    () => ({ login: loginSectionFields.map(({ index }) => index), top: detailFieldIndexes }),
    [loginSectionFields, detailFieldIndexes],
  )
  // Loose top-level fields between sections share one card, the way 1Password groups them.
  const editTopRuns = useMemo(() => {
    const runs: Array<
      | { entries: Array<{ field: CustomField; index: number; position: number }>; kind: 'fields' }
      | { entry: { field: CustomField; index: number; position: number }; kind: 'section' }
    > = []
    detailCustomFields.forEach(({ field, index }, position) => {
      if (field.field_type === 'section') {
        runs.push({ entry: { field, index, position }, kind: 'section' })
        return
      }
      const last = runs[runs.length - 1]
      if (last?.kind === 'fields') last.entries.push({ field, index, position })
      else runs.push({ entries: [{ field, index, position }], kind: 'fields' })
    })
    return runs
  }, [detailCustomFields])

  function applyFieldMove(from: Slot, to: Slot) {
    setForm((current) => {
      const lists: ContainerLists = {
        login: current.custom_fields.flatMap((field, index) => (inCredentialBlock(field) ? [index] : [])),
        top: current.custom_fields.flatMap((field, index) => (inCredentialBlock(field) ? [] : [index])),
      }
      const customFields = moveFieldEntry(current.custom_fields, lists, from, to)
      if (!customFields) return current
      return { ...current, custom_fields: customFields, customFieldsInput: customFieldsToInput(customFields) }
    })
  }

  function moveUrl(from: number, to: number) {
    setForm((current) => {
      if (to < 0 || to >= current.urlsInput.length || from === to) return current
      const urlsInput = [...current.urlsInput]
      const [moved] = urlsInput.splice(from, 1)
      urlsInput.splice(to, 0, moved)
      return { ...current, urlsInput }
    })
  }

  // After a keyboard move the row is drawn somewhere else; its handle keeps the focus.
  function focusHandle(container: string, index: number) {
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          `[data-reorder-container="${container}"][data-reorder-index="${index}"] .field-reorder-handle`,
        )
        ?.focus(),
    )
  }

  const fieldDrag = useFieldDrag((source, to) => {
    if (source.container === 'urls') moveUrl(source.index, to.index)
    else applyFieldMove(source as Slot, to as Slot)
  })

  /** Template children stay in their own section: the template finds them there by key. */
  function reorderFor(container: string, index: number, fieldType: string, pinned = false): ReorderControl {
    return {
      container,
      dragging: fieldDrag.dragging?.container === container && fieldDrag.dragging.index === index,
      index,
      onKeyboardMove: (delta) => {
        if (container === 'urls') {
          moveUrl(index, index + delta)
          focusHandle(container, index + delta)
          return
        }
        const from = { container, index } as Slot
        const target = keyboardTarget(form.custom_fields, fieldLists, from, delta)
        if (!target || (pinned && target.container !== container)) return
        applyFieldMove(from, target)
        focusHandle(target.container, target.index)
      },
      onPointerDown: (event) =>
        fieldDrag.begin(event, {
          accepts: (target) =>
            container === 'urls'
              ? target === 'urls'
              : target !== 'urls' &&
                (pinned ? target === container : canEnter(fieldType, container as Container, target as Container)),
          container,
          index,
        }),
    }
  }

  // Reads the QR from a copied image first (the one-click handoff from an enrolment page); with nothing on
  // the clipboard — or a webview that refuses the API — it asks for an image file, which on a phone offers the
  // camera as well as the photo library.
  async function scanOtpQr(index: number) {
    let image: Blob | null = null
    try {
      for (const item of await navigator.clipboard.read()) {
        const kind = item.types.find((type) => type.startsWith('image/'))
        if (!kind) continue
        image = await item.getType(kind)
        break
      }
    } catch {
      image = null
    }
    if (image) {
      await importOtpQrImage(index, image)
      return
    }
    otpFileTarget.current = index
    otpFileInputRef.current?.click()
  }

  function fieldLabelOf(field: CustomField) {
    return field.label.trim() || t(`vault.customFieldDefaults.${field.field_type}`)
  }

  function renderEditField(field: CustomField, index: number, container: 'login' | 'top', position: number) {
    const label = fieldLabelOf(field)
    const labelInput =
      field.field_type === 'sign_in_with'
        ? undefined
        : {
            onChange: (value: string) => updateCustomField(index, { label: value }),
            placeholder: t(`vault.customFieldDefaults.${field.field_type}`),
            value: field.label,
          }
    const key = `field-${container}-${field.field_type}-${index}`
    const common = {
      drop: fieldDrag.dropAt(container, position),
      label,
      labelInput,
      onRemove: () => removeCustomField(index),
      // The credential card's rows sit in a fixed order: nothing there has a handle.
      reorder: container === 'login' ? undefined : reorderFor(container, position, field.field_type),
    }

    if (field.field_type === 'passkey') {
      // Made by the extension, never typed: neither the label nor the value is editable, only removable.
      return (
        <div className="field-slot" key={key}>
          <PasskeyRow
            actions={
              <button
                aria-label={t('vault.removeField')}
                className="field-remove-button"
                onClick={() => removeCustomField(index)}
                title={t('vault.removeField')}
                type="button"
              >
                <CircleMinus aria-hidden="true" size={18} />
              </button>
            }
            createdAt={passkeyCreatedAt(field, form.custom_fields, selectedItem?.created_at)}
            editing
            field={field}
          />
        </div>
      )
    }
    if (field.field_type === 'sign_in_with') {
      return (
        <EditFieldRow
          key={key}
          {...common}
          trailing={
            <button className="field-text-button" onClick={openSignInPicker} type="button">
              {t('vault.signIn.change')}
            </button>
          }
        >
          <SignInRow
            account={
              form.relationDraft.signInId
                ? relationRef(form.relationDraft.signInId, items, selectedItem?.relations)
                : null
            }
            accountDetail={items.find((item) => item.id === form.relationDraft.signInId)?.username}
            provider={parseSignInProvider(field.value)}
          />
        </EditFieldRow>
      )
    }
    if (field.field_type === 'otp') {
      // 1Password's editor: the key itself, in lowercase groups of four while it is being edited. At rest it is
      // dots (AGENTS.md › "The TOTP seed rests masked"); what is stored is the normalized key.
      const focused = focusedOtpField === `otp:${index}`
      return (
        <EditFieldRow
          key={key}
          {...common}
          trailing={<OtpScanButton label={label} onScan={() => void scanOtpQr(index)} />}
        >
          <input
            aria-label={label}
            autoComplete="off"
            className="field-row-input is-mono"
            onBlur={() => setFocusedOtpField('')}
            onChange={(event) => updateCustomField(index, { value: parseOtpSecretInput(event.target.value) })}
            onFocus={() => setFocusedOtpField(`otp:${index}`)}
            onPaste={(event) => handleOtpPaste(index, event)}
            placeholder={t('vault.otpSecretPlaceholder')}
            ref={(node) => {
              otpInputRefs.current[index] = node
            }}
            spellCheck={false}
            type={focused || !field.value ? 'text' : 'password'}
            value={focused ? formatOtpSecret(field.value) : field.value}
          />
        </EditFieldRow>
      )
    }
    if (field.field_type === 'file') {
      return (
        <EditFieldRow
          key={key}
          {...common}
          // An attachment is never replaced once added, only removed (owner, 2026-10-18).
          trailing={
            <AttachmentEditActions
              field={field}
              onChoose={() => void chooseAttachmentForField(index)}
              onExport={() => void openAttachment(field)}
              onPreview={() => void openTextPreview(field)}
            />
          }
        >
          <span className="field-row-value" title={field.value}>
            {field.value ? fileNameFromPath(field.value) : t('vault.chooseAttachment')}
          </span>
        </EditFieldRow>
      )
    }
    if (field.field_type === 'related_item') {
      return (
        <EditFieldRow key={key} {...common}>
          <select
            aria-label={label}
            className="field-select"
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
        </EditFieldRow>
      )
    }
    if (specialFieldTypes.includes(field.field_type)) {
      return (
        <EditFieldRow key={key} {...common}>
          <input
            aria-label={label}
            autoComplete="off"
            className="field-row-input"
            onChange={(event) => updateCustomField(index, { value: event.target.value })}
            placeholder={t(fieldValuePlaceholderKey(field.field_type))}
            spellCheck={false}
            value={field.value}
          />
        </EditFieldRow>
      )
    }
    return (
      <EditFieldRow key={key} {...common}>
        <FieldEditor
          fieldType={field.field_type}
          label={label}
          measureStrength={field.field_type === 'password' ? measurePassword : undefined}
          onChange={(value) => updateCustomField(index, { value })}
          onGenerate={generateFieldPassword}
          placeholder={t(fieldValuePlaceholderKey(field.field_type))}
          value={field.value}
        />
      </EditFieldRow>
    )
  }

  function renderEditSection(field: CustomField, index: number, position: number) {
    const container = `section:${index}`
    const children = parseSectionChildren(field.value)
    // The category's own section: its fields empty out rather than go away, and so does the section.
    const templateSection = children.some((child) => findTemplateField(form.item_type, child.key))
    const title = sectionDisplayTitle(form.item_type, field, fieldLabels)
    const drop = fieldDrag.dropAt('top', position)
    return (
      <div
        className={['field-section', 'is-edit', drop ? `is-drop-${drop}` : ''].filter(Boolean).join(' ')}
        data-reorder-container="top"
        data-reorder-index={position}
        key={`section-${index}`}
      >
        <EditSectionCard
          addMore={
            <AddMoreControl
              attachments={features.attachments}
              context="section"
              dropIndicator={fieldDrag.dropAt(container, children.length)}
              dropZone={{ container, index: children.length }}
              onPick={(entry) => {
                if (entry.kind === 'field') addSectionChild(index, entry.id)
              }}
              onToggle={() => toggleSectionMenu(index)}
              open={sectionMenuIndex === index}
              sheet={isMobileLayout}
            />
          }
        >
          <EditFieldRow
            className="is-section-header"
            label={title || t('vault.sectionName')}
            labelHidden
            onRemove={templateSection ? undefined : () => removeCustomField(index)}
            removeLabel={t('fieldRows.removeSection')}
            reorder={reorderFor('top', position, 'section')}
          >
            <input
              aria-label={t('vault.sectionName')}
              className="field-row-input section-name-input"
              onChange={(event) => updateCustomField(index, { label: event.target.value })}
              placeholder={templateSection ? title : t('vault.sectionName')}
              spellCheck={false}
              value={field.label}
            />
          </EditFieldRow>
          {children.map((child, childIndex) => {
            const templateField = findTemplateField(form.item_type, child.key)
            const childLabel = child.label.trim() || t(`vault.customFieldDefaults.${child.field_type}`)
            return (
              <EditFieldRow
                drop={fieldDrag.dropAt(container, childIndex)}
                key={child.id ?? childIndex}
                label={templateField ? childDisplayLabel(form.item_type, child, fieldLabels) : childLabel}
                labelInput={
                  templateField
                    ? undefined
                    : {
                        onChange: (value) => updateSectionChild(index, childIndex, { label: value }),
                        placeholder: t(`vault.customFieldDefaults.${child.field_type}`),
                        value: child.label,
                      }
                }
                // A template field is part of the category; left empty it is hidden when viewing and not
                // stored, so there is nothing to remove.
                onRemove={templateField ? undefined : () => removeSectionChild(index, childIndex)}
                reorder={reorderFor(container, childIndex, child.field_type, Boolean(templateField))}
              >
                <FieldEditor
                  fieldType={child.field_type}
                  footer={
                    child.key === 'publicKey' && form.item_type === 'ssh_key' ? (
                      <SshFingerprintCaption label={t(sshFingerprintLabelKey)} publicKey={child.value} />
                    ) : null
                  }
                  label={childLabel}
                  measureStrength={child.field_type === 'password' ? measurePassword : undefined}
                  meta={templateFieldMeta(templateField)}
                  onChange={(value) => updateSectionChild(index, childIndex, { value })}
                  onGenerate={generateFieldPassword}
                  placeholder={t(fieldValuePlaceholderKey(child.field_type))}
                  value={child.value}
                />
              </EditFieldRow>
            )
          })}
        </EditSectionCard>
      </div>
    )
  }

  function addOtpField(): number {
    const index = form.custom_fields.length
    setForm((current) => {
      const customFields = [
        ...current.custom_fields,
        { field_type: 'otp', label: t('vault.customFieldDefaults.otp'), value: '' },
      ]
      return { ...current, custom_fields: customFields, customFieldsInput: customFieldsToInput(customFields) }
    })
    return index
  }

  async function handleArchive() {
    if (!selectedItem) return
    await vaultApi.archive(selectedItem.id)
    const nextItems = await vaultApi.list()
    setItems(nextItems)
    setSelectedId(nextItems[0]?.id ?? null)
    await loadArchivedItems()
  }

  async function handleTrash() {
    if (!selectedItem) return
    try {
      await vaultApi.trash(selectedItem.id)
    } catch (nextError) {
      // Rust refuses an item that still has links; the menu row is disabled for that, so this is
      // only reached when the list in hand was stale.
      setError(String(nextError))
      return
    }
    const nextItems = await vaultApi.list()
    setItems(nextItems)
    // Nothing takes the place of the item that just left — the pane goes to its empty state rather
    // than opening a create form nobody asked for.
    setSelectedId(null)
    setComposing(false)
    await loadTrashedItems()
  }

  async function handleFavorite() {
    if (!selectedItem) {
      setForm((current) => ({ ...current, favorite: !current.favorite }))
      return
    }
    const next = !selectedItem.favorite
    await vaultApi.favorite(selectedItem.id, next)
    // The star reads the form, which is only reloaded when the selection changes: carry the new state into it
    // (and its baseline, so favouriting never counts as an unsaved edit or gets undone by a later save).
    baselineRef.current = { ...baselineRef.current, favorite: next }
    setForm((current) => ({ ...current, favorite: next }))
    const nextItems = await vaultApi.list()
    setItems(nextItems)
  }

  // The panel is anchored to the button's right edge rather than its own width, so it lines up with
  // the header's foot instead of hanging off a 32px control.
  function toggleItemMenu(trigger: HTMLElement) {
    if (itemMenu) {
      closeFieldMenus()
      return
    }
    closeFieldMenus()
    trigger.focus()
    setItemMenuSource('header')
    setItemMenu('actions')
  }

  // Right-clicking a row makes it the selected item first, so every row of the panel acts on the thing
  // that was clicked rather than on whatever the pane happened to be showing. The panel then opens at
  // the cursor the way the tag row's does, at the row's left edge. Unlike the header's trigger, this one
  // is reachable while the form is open, so any field menu has to be cleared before the panel is placed.
  function openItemRowMenu(event: ReactMouseEvent<HTMLButtonElement>, item: LoginItem) {
    closeFieldMenus()
    setSelectedId(item.id)
    setItemMenuSource('row')
    setItemMenu('actions')
    const rect = event.currentTarget.getBoundingClientRect()
    setItemMenuAnchor(
      getMenuAnchorStyle({
        menuHeight: itemMenuHeight,
        rect: { bottom: event.clientY, left: rect.left, top: event.clientY, width: itemMenuWidth },
        viewportHeight: window.innerHeight,
      }),
    )
  }

  async function handleMoveToVault(vaultId: string, vaultName: string) {
    if (!selectedItem) return
    closeFieldMenus()
    try {
      await vaultApi.move(selectedItem.id, vaultId)
      // The item leaves the vault this session reads, so the pane goes back to its empty state —
      // reading the target vault stays the picker's job, not a side effect of a move.
      setItems(await vaultApi.list())
      setSelectedId(null)
      setComposing(false)
      setOperationMessage(t('messages.movedItem', { vault: vaultName }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  async function handleDuplicate() {
    if (!selectedItem) return
    closeFieldMenus()
    try {
      const copy = await vaultApi.duplicate(selectedItem.id, t('vault.duplicateTitle', { title: selectedItem.title }))
      setItems(await vaultApi.list())
      setSelectedId(copy.id)
      setOperationMessage(t('messages.duplicatedItem', { title: copy.title }))
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  // There is no transport to hand an item to, so sharing means the clipboard the password field
  // already uses — same value, same 90-second clear preference, nothing written anywhere else.
  async function handleShare() {
    closeFieldMenus()
    await copyPassword()
    setOperationMessage(t('messages.sharedPassword'))
  }

  function handleUseGeneratedPassword(password: string) {
    setForm((current) => ({ ...current, password }))
    setShowPassword(true)
  }

  async function copyPassword() {
    await copySecretText(form.password)
  }

  // A secret honours the 90-second clipboard clear; a plain value (a username, a hostname) does not.
  async function copySecretText(value: string, sensitive = true) {
    await copyText(value, { clearAfter90Seconds: securityPreferences.clearClipboardAfter90Seconds, sensitive })
  }

  async function copyFieldValue(value: string, label: string, sensitive: boolean) {
    setError(null)
    try {
      await copySecretText(value, sensitive)
      setOperationMessage(t('messages.copiedField', { label }))
      if (selectedItem) void vaultApi.recordUse(selectedItem.id).catch(() => {})
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  // Open & Fill: the address opens in the default browser carrying this item's id in its fragment, which the
  // extension's content script turns into a fill of this one item (fieldActions.ts `openAndFillUrl`).
  function openItemWebsite(url: string, fill: boolean) {
    const target = fill && selectedItem ? openAndFillUrl(url, selectedItem.id) : url
    if (!target) return
    openUrlExternally(target)
    if (selectedItem) void vaultApi.recordUse(selectedItem.id).catch(() => {})
    if (fill) setOperationMessage(t('messages.openedToFill', { host: new URL(target).hostname }))
  }

  // 1Password's item shortcuts (support.1password.com/keyboard-shortcuts): ⌘C username, ⇧⌘C password,
  // ⌥⌘C one-time password, ⇧⌘F Open & Fill, ⌘R reveal or conceal every secure field (Ctrl on Windows/Linux).
  // Read through a ref so the one listener always sees the item on screen, never the one it was added with.
  itemShortcutRef.current = (event: KeyboardEvent) => {
    if (!features.keyboardShortcuts || !isPrimaryModifier(event, platform)) return
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
    // ⌘↑ / ⌘↓ step through the list on screen, in view and edit mode alike (an unsaved edit stays a draft).
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.altKey) {
      if (stepSelectedItem(event.key === 'ArrowUp' ? -1 : 1)) event.preventDefault()
      return
    }
    if (!selectedItem || isEditing) return
    const plain = !event.shiftKey && !event.altKey
    if (event.code === 'KeyC' && plain && form.username) {
      void copyFieldValue(form.username, usernameLabel, false)
    } else if (event.code === 'KeyC' && event.shiftKey && !event.altKey && form.password) {
      void copyFieldValue(form.password, passwordLabel, true)
    } else if (event.code === 'KeyC' && event.altKey && !event.shiftKey && viewOtpIndexes.length) {
      void copyFieldTotp(viewOtpIndexes[0])
    } else if (event.code === 'KeyF' && event.shiftKey && !event.altKey && viewWebsites.length) {
      // The first website that may fill; a "never" site only opens.
      const fillable = viewWebsites.find((itemUrl) => itemUrl.match_type !== 'never')
      openItemWebsite((fillable ?? viewWebsites[0]).url, features.browserExtension && Boolean(fillable))
    } else if (event.code === 'KeyR' && plain) {
      setRevealAllSecure((current) => !current)
    } else return
    event.preventDefault()
  }

  async function generateFieldPassword(options: PasswordGeneratorOptions) {
    return vaultApi.generatePassword(options)
  }

  async function measurePassword(value: string) {
    return vaultApi.passwordStrength(value)
  }

  async function refreshItems() {
    const nextItems = await vaultApi.list()
    setItems(nextItems)
    setSelectedId((current) => current ?? nextItems[0]?.id ?? null)
  }

  // The browser extension writes through the app's bridge (a saved login, a new passkey, a use): the list
  // reloads when the bridge says the vault changed, instead of on the next unlock.
  const refreshItemsRef = useRef(refreshItems)
  refreshItemsRef.current = refreshItems
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let unsubscribed = false
    listen('vault:changed', () => {
      refreshItemsRef.current().catch(() => {})
    }).then((nextUnlisten) => {
      if (unsubscribed) nextUnlisten()
      else unlisten = nextUnlisten
    })
    return () => {
      unsubscribed = true
      unlisten?.()
    }
  }, [])

  // File ▸ Import ▸ 1Password (.1pux)… in the macOS menu bar: pick the file, show what it holds, then import.
  const start1puxImportRef = useRef<() => Promise<void>>(async () => {})
  start1puxImportRef.current = async () => {
    if (isImporting1pux) return
    try {
      setError(null)
      const preview = await vaultApi.preview1pux()
      if (preview) setOnePuxPreview(preview)
    } catch (nextError) {
      setError(String(nextError))
    }
  }
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let unsubscribed = false
    listen('menu:import-1pux', () => {
      start1puxImportRef.current().catch(() => {})
    }).then((nextUnlisten) => {
      if (unsubscribed) nextUnlisten()
      else unlisten = nextUnlisten
    })
    return () => {
      unsubscribed = true
      unlisten?.()
    }
  }, [])

  async function confirm1puxImport() {
    if (!onePuxPreview) return
    setIsImporting1pux(true)
    try {
      const summary = await vaultApi.import1pux(onePuxPreview.path)
      setOnePuxPreview(null)
      await loadVaults()
      await refreshItems()
      setOperationMessage(t('messages.imported1pux', { count: summary.item_count }))
    } catch (nextError) {
      setError(String(nextError))
    } finally {
      setIsImporting1pux(false)
    }
  }

  async function loadArchivedItems() {
    setArchivedItems(await vaultApi.archived())
  }

  async function loadTrashedItems() {
    setTrashedItems(await vaultApi.trashed())
  }

  async function restoreTrashedItem(id: string) {
    await vaultApi.restoreFromTrash(id)
    await refreshItems()
    await loadTrashedItems()
  }

  // Purging deletes the row, so it is the one action here that cannot be walked back from
  // anywhere in the app. The panel that asks is what stands between a stray click and lost secrets.
  async function purgeTrashedItem() {
    if (!purgeTarget) return
    try {
      await vaultApi.purge(purgeTarget.id)
    } catch (nextError) {
      setPurgeTarget(null)
      setError(String(nextError))
      return
    }
    setPurgeTarget(null)
    await loadTrashedItems()
  }

  async function restoreArchivedItem(id: string) {
    await vaultApi.restore(id)
    await refreshItems()
    await loadArchivedItems()
  }

  // A window created without a position is centred on tauri's *primary* monitor, so with a second display
  // open the settings landed where the user was not looking. Main's own frame decides where it goes, and
  // `parent` is what puts the two windows on the same macOS Space and keeps them travelling together.
  async function openSettingsWindow(tab?: SettingsTab) {
    setError(null)
    // Phones have one window: Settings is a tab in it.
    if (!featuresFor(currentPlatformState().platform).settingsWindow) {
      setMobileTab('settings')
      if (tab) window.dispatchEvent(new CustomEvent(settingsTabEvent, { detail: tab }))
      return
    }
    try {
      const existing = await WebviewWindow.getByLabel('settings')
      if (existing) {
        if (tab) await emit(settingsTabEvent, tab)
        await existing.show()
        await existing.setFocus()
        return
      }

      const mainWindow = await WebviewWindow.getByLabel('main')
      const position = mainWindow
        ? getTopLeftCenteredOver({
            frame: {
              position: await mainWindow.outerPosition(),
              scaleFactor: await mainWindow.scaleFactor(),
              size: await mainWindow.outerSize(),
            },
            ...settingsWindowSize,
          })
        : null

      const settingsWindow = new WebviewWindow('settings', {
        alwaysOnTop: true,
        // `center` is applied last, so passing it with an explicit position would throw the position away.
        center: position === null,
        height: settingsWindowSize.height,
        minHeight: 560,
        minWidth: 760,
        parent: mainWindow ?? undefined,
        resizable: false,
        shadow: true,
        skipTaskbar: true,
        title: 'Passless Settings',
        url: tab ? `/?view=settings&tab=${tab}` : '/?view=settings',
        width: settingsWindowSize.width,
        // Title bar and window material per platform (macOS: overlay + sidebar vibrancy, as before).
        ...settingsWindowChrome(currentPlatformState().platform),
        x: position?.x,
        y: position?.y,
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
    const biometricLabel =
      features.biometrics === 'touch-id' ? t('lock.unlockWithTouchId') : t('lock.unlockWithBiometrics')
    if (lockVariant === 'compact-unlock') {
      return (
        <main className="lock-screen compact-lock-screen" data-tauri-drag-region>
          <form className="compact-unlock-form" onSubmit={handleUnlock}>
            <h1 className="compact-lock-brand">
              <span aria-hidden="true" className="brand-mark is-artwork">
                <img alt="" src={appIcon} />
              </span>
              <span>{t('lock.appName')}</span>
            </h1>
            <div className="compact-password-control">
              <input
                aria-label={t('lock.masterPassword')}
                minLength={8}
                onChange={(event) => setMasterPassword(event.target.value)}
                placeholder={t('lock.enterPasswordPlaceholder')}
                ref={masterPasswordInputRef}
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
                  aria-label={biometricLabel}
                  className="compact-unlock-icon-button"
                  onClick={handleBiometricUnlock}
                  title={biometricLabel}
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
            <div className="brand-mark is-artwork">
              <img alt="" src={appIcon} />
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
                minLength={8}
                onChange={(event) => setMasterPassword(event.target.value)}
                placeholder={t('lock.masterPasswordPlaceholder')}
                ref={masterPasswordInputRef}
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
                {biometricLabel}
              </button>
            ) : null}
          </form>
        </section>
      </main>
    )
  }

  // One renderer for both halves of the sidebar, because the rows are the same control and only
  // their place differs: what the vault holds on top, and what was taken out of it at the foot.
  function sidebarViewRows(group: NavigationItem['group']) {
    return navigationItems
      .filter((item) => item.group === group)
      .map((item) => {
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
            <span className="nav-count">{navigationCounts[item.id]}</span>
          </button>
        )
      })
  }

  // A vault row is the same row a tag or a category is, and clicking it changes which vault the whole
  // window reads. The right-click carries the rest: styling, parking, and the one way to lose a vault.
  function sidebarVaultRows(list: VaultSummary[]) {
    return list.map((vault) => {
      const Icon = tagIconComponent(vault.icon)
      return (
        <button
          className={activeNavigation === 'vault' && vault.id === activeVaultId ? 'nav-item active' : 'nav-item'}
          key={vault.id}
          onClick={() => {
            setActiveNavigation('vault')
            if (vault.id !== activeVaultId) void handleSwitchVault(vault.id)
          }}
          onContextMenu={(event) => openVaultMenu(event, vault)}
          type="button"
        >
          <Icon className={tagColorClass(vault.color)} size={16} />
          <span>{vault.name}</span>
          <span className="nav-count">{vault.item_count}</span>
        </button>
      )
    })
  }

  // Which single pane the phone layout shows. The item pane only counts as open while there is an item or
  // a draft to show, so deleting or archiving the open item lands back on the list.
  const mobilePane =
    mobileTab === 'items' ? (mobileDetailOpen && (selectedItem || composing) ? 'detail' : 'list') : mobileTab

  return (
    <main
      className={editLocked ? 'app-shell is-edit-locked' : 'app-shell'}
      data-mobile-pane={isMobileLayout ? mobilePane : undefined}
      style={{ '--item-list-width': `${itemListWidth}px`, '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    >
      <h1 className="sr-only">{t('landmarks.vaultItems')}</h1>
      {/* On a phone the sidebar is the Browse tab: picking any row there goes back to the list it filters. */}
      <aside
        {...lockedRegion}
        aria-label={t('landmarks.primaryNavigation')}
        className="sidebar"
        data-tauri-drag-region="deep"
        onClick={(event) => {
          if (isMobileLayout && (event.target as Element).closest('.nav-item')) {
            setMobileDetailOpen(false)
            setMobileTab('items')
          }
        }}
      >
        <div className="brand">
          <div className="brand-mark is-artwork">
            <img alt="" src={appIcon} />
          </div>
          {/* Which vault is open is a row in the list below now, not a control in the brand block — the
              brand is left to name the app and offer the way to make another vault. */}
          <div className="brand-vault">
            <strong>{t('lock.appName')}</strong>
          </div>
          <button
            aria-label={t('vault.createVault')}
            className="icon-button vault-add-button"
            data-tauri-drag-region="false"
            onClick={openCreateVault}
            title={t('vault.createVault')}
            type="button"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* The views above scroll so the two state rows below stay where they belong: at the foot of
            the sidebar, reachable without hunting past a long category list. */}
        <div className="sidebar-scroll">
          <nav className="nav-list">{sidebarViewRows('vault')}</nav>

          {/* Every vault is a row here, so switching is a click on the one you want rather than a control
              that hides the list. Archived vaults fold into their own section because they are parked
              with everything inside them and cannot be read until one row is restored. */}
          <nav aria-label={t('common.vaults')} className="section-nav">
            <SidebarSectionToggle
              collapsed={vaultsCollapsed}
              label={t('common.vaults')}
              onToggle={() => setVaultsCollapsed((next) => !next)}
            />
            {vaultsCollapsed ? null : (
              <div className="nav-list">
                {sidebarVaultRows(openVaults)}
                {openVaults.length === 0 ? <p className="nav-sublist-empty">{t('vault.noOpenVaults')}</p> : null}
              </div>
            )}
          </nav>

          {archivedVaults.length ? (
            <nav aria-label={t('common.archivedVaults')} className="section-nav">
              <SidebarSectionToggle
                collapsed={archivedVaultsCollapsed}
                label={t('common.archivedVaults')}
                onToggle={() => setArchivedVaultsCollapsed((next) => !next)}
              />
              {archivedVaultsCollapsed ? null : <div className="nav-list">{sidebarVaultRows(archivedVaults)}</div>}
            </nav>
          ) : null}

          <nav aria-label={t('common.tags')} className="section-nav">
            <SidebarSectionToggle
              collapsed={tagsCollapsed}
              label={t('common.tags')}
              onContextMenu={(event) => openSectionHighlightMenu(event, 'tag')}
              onToggle={() => setTagsCollapsed((next) => !next)}
            />
            {/* A fold hides the list but never a row the user asked to keep, so a highlighted tag is
                still there to click and still wears the marker that says why it stayed. */}
            {tagsCollapsed && visibleTags.length === 0 ? null : (
              <div className="nav-sublist">
                {visibleTags.map((tag) => {
                  const Icon = tagIconComponent(tag.icon)
                  return (
                    <button
                      className={activeNavigation === tagNavigationId(tag.key) ? 'nav-item active' : 'nav-item'}
                      key={tag.key}
                      onClick={() => setActiveNavigation(tagNavigationId(tag.key))}
                      onContextMenu={(event) => openTagMenu(event, tag)}
                      type="button"
                    >
                      <Icon className={tagColorClass(tag.color)} size={16} />
                      <span>{tag.name}</span>
                      {isHighlighted(highlights, 'tag', tag.key) ? (
                        <Pin aria-hidden="true" className="text-text-subtlest" size={16} />
                      ) : null}
                      <span className="nav-count">{tag.count}</span>
                    </button>
                  )
                })}
                {sidebarTags.length === 0 ? <p className="nav-sublist-empty">{t('vault.noTags')}</p> : null}
              </div>
            )}
          </nav>

          <nav aria-label={t('common.categories')} className="section-nav">
            <SidebarSectionToggle
              collapsed={categoriesCollapsed}
              label={t('common.categories')}
              onContextMenu={(event) => openSectionHighlightMenu(event, 'category')}
              onToggle={() => setCategoriesCollapsed((next) => !next)}
            />
            {categoriesCollapsed && visibleCategories.length === 0 ? null : (
              <div className="nav-list" ref={categoryListRef}>
                {visibleCategories.map((category) => {
                  const id = `category:${category.itemType}` as const
                  const Icon = category.icon
                  return (
                    <button
                      className={activeNavigation === id ? 'nav-item category-item active' : 'nav-item category-item'}
                      data-item-type={category.itemType}
                      key={category.itemType}
                      onClick={() => setActiveNavigation(id)}
                      onContextMenu={(event) => openCategoryMenu(event, category.itemType)}
                      type="button"
                    >
                      <Icon className={category.colorClass} size={16} />
                      <span>{t(`itemTypes.${category.itemType}`)}</span>
                      {isHighlighted(highlights, 'category', category.itemType) ? (
                        <Pin aria-hidden="true" className="text-text-subtlest" size={16} />
                      ) : null}
                      <span className="nav-count">{navigationCounts[id] ?? 0}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </nav>
        </div>

        <div className="sidebar-footer">
          <nav className="nav-list">{sidebarViewRows('footer')}</nav>
        </div>
      </aside>

      <button
        aria-label={t('vault.resizeSidebar')}
        className="column-resize-handle is-sidebar"
        onMouseDown={beginSidebarResize}
        type="button"
      />

      <header {...lockedRegion} className="top-search-bar" data-tauri-drag-region="deep">
        {/* Previous / next item (⌘↑ / ⌘↓), the toolbar's leading control pair; hidden in the phone layout. */}
        <div className="top-item-nav" data-tauri-drag-region="false">
          <button
            aria-label={t('vault.previousItem')}
            className="icon-button"
            disabled={!previousItemId}
            onClick={() => stepSelectedItem(-1)}
            title={`${t('vault.previousItem')} (${shortcutLabel('mod+↑', platform)})`}
            type="button"
          >
            <ArrowUp size={16} />
          </button>
          <button
            aria-label={t('vault.nextItem')}
            className="icon-button"
            disabled={!nextItemId}
            onClick={() => stepSelectedItem(1)}
            title={`${t('vault.nextItem')} (${shortcutLabel('mod+↓', platform)})`}
            type="button"
          >
            <ArrowDown size={16} />
          </button>
        </div>
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
                  <ItemIcon item={item} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{itemSubtitle(item)}</small>
                  </span>
                </button>
              ))}
              {topSettingsResults.map((entry) => (
                <button
                  key={entry.key}
                  onClick={() => {
                    setTopSearch('')
                    void openSettingsWindow(entry.tab)
                  }}
                  type="button"
                >
                  <span aria-hidden="true" className="item-icon top-search-settings-icon">
                    <Settings size={18} />
                  </span>
                  <span>
                    <strong>{entry.label}</strong>
                    <small>{t('vault.searchSettingsIn', { pane: entry.paneLabel })}</small>
                  </span>
                </button>
              ))}
              {topSearchResults.length === 0 && topSettingsResults.length === 0 ? (
                <p>{t('vault.noSearchResults')}</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <button
          aria-expanded={itemTypePickerOpen}
          aria-haspopup="menu"
          className="top-new-item-button"
          data-field-menu=""
          onClick={(event) => openItemTypePicker(event.currentTarget)}
          ref={newItemButtonRef}
          type="button"
        >
          <Plus size={16} />
          {t('vault.newItem')}
        </button>
      </header>

      <section {...lockedRegion} aria-label={t('landmarks.vaultItems')} className="item-list">
        {/* The phone layout's large title (iOS) / top app bar title (Material); the desktop shows none. */}
        <h2 className="mobile-list-title">{listTitle}</h2>
        {/* No standing "database ready" line (owner 2026-10-18); the slot only speaks up for an error. */}
        {error ? (
          <div className="sync-state">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        {/* Sort (owner 2026-10-18, after 1Password 8's "N items sorted by" menu): what to sort by, then which way.
            One choice for every list, remembered across launches. */}
        {stateRows ? null : (
          <div className="list-sort" data-sort-menu="">
            <button
              aria-expanded={sortMenuOpen}
              aria-haspopup="menu"
              className="list-sort-trigger"
              onClick={() => setSortMenuOpen((open) => !open)}
              type="button"
            >
              <span>{t(sortKeyLabel[itemSort.key])}</span>
              <ChevronDown aria-hidden="true" size={13} />
            </button>
            {sortMenuOpen ? (
              <div className="add-more-menu list-sort-menu" role="menu">
                <p className="list-sort-heading">{t('vault.sortHeading', { count: visibleItems.length })}</p>
                {itemSortKeys.map((key) => (
                  <button
                    aria-checked={itemSort.key === key}
                    className="menu-option list-sort-option"
                    key={key}
                    onClick={() => chooseSort({ direction: defaultDirectionFor(key), key })}
                    role="menuitemradio"
                    type="button"
                  >
                    <span>{t(sortKeyLabel[key])}</span>
                    {itemSort.key === key ? <Check aria-hidden="true" size={15} /> : null}
                  </button>
                ))}
                {sortDirections(itemSort.key).map(([direction, label], index) => (
                  <button
                    aria-checked={itemSort.direction === direction}
                    className={index === 0 ? 'menu-option list-sort-option separated' : 'menu-option list-sort-option'}
                    key={direction}
                    onClick={() => chooseSort({ ...itemSort, direction })}
                    role="menuitemradio"
                    type="button"
                  >
                    <span>{t(label)}</span>
                    {itemSort.direction === direction ? <Check aria-hidden="true" size={15} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <div className="rows">
          {stateRows
            ? stateRows.map((item) => (
                // A state row is not selectable: the detail pane only ever edits live items, so the
                // row carries its own way back, and the trash carries the way out as well.
                <div className="item-row state-row" key={item.id}>
                  <ItemIcon item={item} />
                  <span className="item-row-text">
                    <strong>{item.title}</strong>
                    <small>
                      <span className="row-subtitle">{itemSubtitle(item)}</span>
                    </small>
                    <span className="state-row-actions">
                      <button
                        aria-label={t('vault.restore', { title: item.title })}
                        className="state-row-button"
                        onClick={() => restoreStateItem(item.id)}
                        title={t('vault.restore', { title: item.title })}
                        type="button"
                      >
                        {t('vault.restoreAction')}
                      </button>
                      {activeNavigation === 'trash' ? (
                        <button
                          aria-label={t('vault.purgeItem', { title: item.title })}
                          className="state-row-button danger"
                          onClick={() => setPurgeTarget(item)}
                          title={t('vault.purgeItem', { title: item.title })}
                          type="button"
                        >
                          {t('vault.purge')}
                        </button>
                      ) : null}
                    </span>
                  </span>
                </div>
              ))
            : visibleItems.map((item) => (
                <button
                  className={item.id === selectedId ? 'item-row active' : 'item-row'}
                  data-item-row={item.id}
                  key={item.id}
                  onClick={() => {
                    setSelectedId(item.id)
                    setMobileDetailOpen(true)
                  }}
                  onContextMenu={(event) => openItemRowMenu(event, item)}
                  type="button"
                >
                  <ItemIcon item={item} />
                  <span className="item-row-text">
                    <strong>{item.title}</strong>
                    <small>
                      <span className="row-subtitle">{itemSubtitle(item)}</span>
                    </small>
                  </span>
                  {item.favorite ? <Star className="row-star" fill="currentColor" size={14} /> : null}
                </button>
              ))}
          {(stateRows ? stateRows.length === 0 : visibleItems.length === 0) ? (
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
        {/* Everything the pane can do to the item lives in its top-right corner: the type is the only
            thing named on the left, and the row under the fields went with it. */}
        {/* Editing turns the top bar into a banner in the item category's hue and texture (owner 2026-10-18,
            after 1Password 8): every category has its own SVG tile, so the mode and the kind read at once. */}
        <div
          className={isEditing ? 'detail-topbar is-editing' : 'detail-topbar'}
          data-tauri-drag-region="deep"
          style={isEditing ? ({ '--edit-hue': editBannerHue } as CSSProperties) : undefined}
        >
          {isEditing ? (
            <>
              <EditBannerPattern itemType={form.item_type} />
              <span className="edit-banner-label">{t('vault.editingBanner')}</span>
            </>
          ) : null}
          {isMobileLayout ? (
            <button
              aria-label={t('mobile.back')}
              className="mobile-back-button"
              onClick={() => {
                if (isEditing) handleCancelEdit()
                setMobileDetailOpen(false)
              }}
              type="button"
            >
              {platform === 'ios' || platform === 'macos' ? <ChevronLeft size={22} /> : <ArrowLeft size={20} />}
              <span>{listTitle}</span>
            </button>
          ) : null}
          <div className="detail-topbar-actions">
            {editLocked && hasUnsavedChanges ? (
              <span className="unsaved-hint" role="status">
                {t('vault.unsavedChanges')}
              </span>
            ) : null}
            {isEditing ? (
              <>
                <button className="secondary-button" onClick={handleCancelEdit} type="button">
                  <X size={15} />
                  {t('vault.cancelEditing')}
                </button>
                {/* The submit button sits outside the form it submits, so it has to name it. */}
                <button className="primary-button" disabled={saving} form="item-detail-form" type="submit">
                  <Check size={15} />
                  {saving ? t('vault.saving') : selectedItem ? t('vault.saveChanges') : t('vault.createItem')}
                </button>
              </>
            ) : selectedItem ? (
              <>
                <button className="top-edit-button" onClick={beginEdit} type="button">
                  <Pencil size={15} />
                  {t('vault.edit')}
                </button>
                {/* Everything the pane can do to a stored item sits behind one ellipsis, and only in
                    the read-only state: each row acts on what is already saved, not on unsaved typing. */}
                {/* data-field-menu: the window's outside-click closer is registered by the effect this very
                    click's state change runs, React 18 flushes it before the click reaches window, so without the
                    marker the opening click also closed the menu (owner bug report 2026-10-18). */}
                <button
                  aria-expanded={itemMenu !== null && itemMenuSource === 'header'}
                  aria-haspopup="menu"
                  aria-label={t('vault.itemActions')}
                  className="icon-button"
                  data-field-menu=""
                  onClick={(event) => toggleItemMenu(event.currentTarget)}
                  ref={itemMenuTriggerRef}
                  title={t('vault.itemActions')}
                  type="button"
                >
                  <Ellipsis size={16} />
                </button>
              </>
            ) : null}
          </div>
        </div>
        {selectedItem || composing ? (
          isEditing ? (
            <form className="detail-form" id="item-detail-form" onSubmit={handleSave}>
              <fieldset className="detail-fieldset" disabled={!isEditing} onScroll={closeFieldMenus}>
                {/* 1Password 8's edit header (owner 2026-10-18): a 60pt icon with a chevron badge for the icon
                    choices, the title in a filled field beside it. */}
                <div className="detail-header is-edit">
                  <div className="item-icon-well">
                    <ItemIcon
                      className="large-icon"
                      fallback={headerArt}
                      item={{
                        icon_mode: selectedItem?.icon_mode,
                        title: form.title,
                        urls: selectedItem?.urls ?? [],
                        website: selectedItem?.website ?? '',
                      }}
                      placeholder="+"
                    />
                    <ItemIconMenuButton choices={iconChoices} label={t('vault.siteIcon.menu')} />
                  </div>
                  <input
                    aria-label={t('vault.loginTitle')}
                    className="title-input is-filled"
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder={selectedItem ? t('vault.loginTitle') : t('vault.newLoginItem')}
                    value={form.title}
                  />
                  <button
                    aria-label={t('vault.favorite')}
                    className={form.favorite ? 'icon-button active' : 'icon-button'}
                    onClick={handleFavorite}
                    title={t('vault.favorite')}
                    type="button"
                  >
                    <Star fill={form.favorite ? 'currentColor' : 'none'} size={16} />
                  </button>
                </div>

                <div className="form-grid onepassword-form">
                  {showCredentials ? (
                    <div className="wide field-group is-edit">
                      {showUsername ? (
                        <EditFieldRow label={usernameLabel}>
                          <input
                            aria-label={usernameLabel}
                            autoComplete="off"
                            className="field-row-input"
                            onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                            spellCheck={false}
                            value={form.username}
                          />
                        </EditFieldRow>
                      ) : null}
                      {/* A "Sign in with…" login has no password of its own; the row comes back as soon as
                          one is typed somewhere (or the sign-in method is removed). */}
                      {!hasSignInField || form.password ? (
                        <EditFieldRow
                          label={passwordLabel}
                          trailing={
                            <>
                              <button
                                aria-label={t('vault.showPassword')}
                                aria-pressed={showPassword}
                                className="field-type-button"
                                onClick={() => setShowPassword((value) => !value)}
                                title={t('vault.showPassword')}
                                type="button"
                              >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                              </button>
                              <PasswordGeneratorButton
                                className="field-type-button"
                                generate={generateFieldPassword}
                                iconSize={18}
                                label={t('vault.generatePassword')}
                                measure={measurePassword}
                                onUse={handleUseGeneratedPassword}
                              />
                            </>
                          }
                        >
                          <input
                            aria-label={passwordLabel}
                            className="field-row-input"
                            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                            placeholder={t('vault.passwordPlaceholder')}
                            type={showPassword ? 'text' : 'password'}
                            value={form.password}
                          />
                        </EditFieldRow>
                      ) : null}
                      {loginSectionFields.map(({ field, index }, position) =>
                        renderEditField(field, index, 'login', position),
                      )}
                      {template.otp && !loginSectionFields.some(({ field }) => field.field_type === 'otp') ? (
                        // The template's one-time password slot. Nothing is stored until a secret is typed,
                        // pasted or read from a QR code, at which point it becomes an ordinary OTP field.
                        <EditFieldRow
                          label={t('vault.customFieldDefaults.otp')}
                          trailing={
                            <OtpScanButton
                              label={t('vault.customFieldDefaults.otp')}
                              onScan={() => void scanOtpQr(addOtpField())}
                            />
                          }
                        >
                          <input
                            aria-label={t('vault.customFieldDefaults.otp')}
                            autoComplete="off"
                            className="field-row-input is-mono"
                            onChange={(event) => {
                              const value = parseOtpSecretInput(event.target.value)
                              const index = addOtpField()
                              updateCustomField(index, { value })
                              setFocusedOtpField(`otp:${index}`)
                              window.requestAnimationFrame(() => otpInputRefs.current[index]?.focus())
                            }}
                            placeholder={t('vault.otpSecretPlaceholder')}
                            spellCheck={false}
                            type="text"
                            value=""
                          />
                        </EditFieldRow>
                      ) : null}
                    </div>
                  ) : null}
                  {showWebsites ? (
                    <div className="wide field-group is-edit">
                      {form.urlsInput.map((itemUrl, index) => {
                        const label = itemUrl.label === defaultWebsiteLabel ? t('vault.website') : itemUrl.label
                        return (
                          <EditFieldRow
                            drop={fieldDrag.dropAt('urls', index)}
                            key={itemUrl.id}
                            label={label}
                            labelInput={{
                              onChange: (value) =>
                                updateUrl(index, { label: value.trim() ? value : defaultWebsiteLabel }),
                              placeholder: t('vault.website'),
                              value: itemUrl.label === defaultWebsiteLabel ? '' : itemUrl.label,
                            }}
                            onRemove={() => removeWebsite(index)}
                            removeLabel={t('vault.removeWebsite')}
                            reorder={form.urlsInput.length > 1 ? reorderFor('urls', index, 'url') : undefined}
                            trailing={
                              <AutofillBehaviorButton
                                label={label}
                                mode={itemUrl.match_type}
                                onChange={(match_type) => updateUrl(index, { match_type })}
                                url={itemUrl.url}
                              />
                            }
                          >
                            <input
                              aria-label={label}
                              autoComplete="off"
                              className="field-row-input"
                              inputMode="url"
                              onChange={(event) => updateUrl(index, { url: event.target.value })}
                              placeholder="https://example.com"
                              spellCheck={false}
                              value={itemUrl.url}
                            />
                          </EditFieldRow>
                        )
                      })}
                      <AddRowButton onClick={addWebsite}>
                        <Plus aria-hidden="true" size={16} />
                        {t('vault.addAnotherWebsite')}
                      </AddRowButton>
                    </div>
                  ) : null}
                  <div className="wide custom-fields-section">
                    {editTopRuns.map((run) =>
                      run.kind === 'fields' ? (
                        <div className="field-group is-edit" key={`run-${run.entries[0]?.index}`}>
                          {run.entries.map(({ field, index, position }) =>
                            renderEditField(field, index, 'top', position),
                          )}
                        </div>
                      ) : (
                        renderEditSection(run.entry.field, run.entry.index, run.entry.position)
                      ),
                    )}
                    <AddMoreControl
                      attachments={features.attachments}
                      context="item"
                      onPick={(entry) => {
                        if (entry.kind === 'relation') openRelationPicker(entry.id)
                        else void addCustomField(entry.id)
                      }}
                      onToggle={toggleAddMoreMenu}
                      open={showAddMore}
                      sheet={isMobileLayout}
                    />
                    {/* No standing drop hint (owner 2026-10-18: removed); the target appears only while files are dragged over. */}
                    {isEditing && features.attachments && isDraggingFiles ? (
                      <div className="attachment-dropzone is-active">
                        <Paperclip aria-hidden="true" size={15} />
                        <span>{t('vault.dropToAttachHere')}</span>
                      </div>
                    ) : null}
                  </div>
                  {editParentRefs.length || editChildRefs.length || editRelatedRefs.length ? (
                    <div className="relation-editor">
                      {(
                        [
                          ['parent', 'vault.relations.parent', editParentRefs],
                          ['child', 'vault.relations.children', editChildRefs],
                          ['related', 'vault.relations.related', editRelatedRefs],
                        ] as const
                      ).map(([kind, headingKey, refs]) => (
                        <RelationSection
                          archivedLabel={t('vault.relations.archived')}
                          heading={t(headingKey)}
                          iconFor={relationIcon}
                          key={kind}
                          onRemove={(ref) => removeRelation(kind, ref.id)}
                          refs={refs}
                          removeLabel={(title) => t('vault.relations.remove', { title })}
                          typeLabel={relationTypeLabel}
                        />
                      ))}
                    </div>
                  ) : null}
                  <div className="wide field-group is-edit">
                    <EditFieldRow label={t('vault.tags')}>
                      <div className="tag-chip-box">
                        {tagList(form.tagsInput).map((tag) => (
                          <span className="tag-chip" key={tag}>
                            <span>{tag}</span>
                            <button
                              aria-label={t('vault.removeTag', { tag })}
                              className="tag-chip-remove"
                              onClick={() =>
                                setForm((current) => ({ ...current, tagsInput: removeTag(current.tagsInput, tag) }))
                              }
                              type="button"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                        <input
                          aria-label={t('vault.addTag')}
                          className="tag-input"
                          onBlur={commitTagDraft}
                          onChange={(event) => {
                            const next = event.target.value
                            // A comma means a finished tag, whether it was typed or pasted, so it
                            // commits instead of sitting in the box as loose text.
                            if (next.includes(',')) {
                              setForm((current) => ({ ...current, tagsInput: addTag(current.tagsInput, next) }))
                              setTagDraft('')
                              return
                            }
                            setTagDraft(next)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              commitTagDraft()
                              return
                            }
                            if (event.key === 'Backspace' && !tagDraft) removeLastTag()
                          }}
                          placeholder={t('vault.addTag')}
                          value={tagDraft}
                        />
                      </div>
                    </EditFieldRow>
                  </div>
                  <div className="wide field-group is-edit">
                    <EditFieldRow label={t('vault.notes')}>
                      <textarea
                        aria-label={t('vault.notes')}
                        className="field-row-input field-textarea"
                        onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                        placeholder={t('vault.notePlaceholder')}
                        rows={3}
                        value={form.notes}
                      />
                    </EditFieldRow>
                  </div>
                </div>
                <input
                  accept="image/*"
                  aria-hidden="true"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file && otpFileTarget.current !== null) void importOtpQrImage(otpFileTarget.current, file)
                  }}
                  ref={otpFileInputRef}
                  tabIndex={-1}
                  type="file"
                />
              </fieldset>
            </form>
          ) : (
            <div className="detail-view">
              <div className="detail-header">
                <ItemIcon
                  className="large-icon"
                  fallback={headerArt}
                  item={{
                    icon_mode: selectedItem?.icon_mode,
                    title: form.title,
                    urls: selectedItem?.urls ?? [],
                    website: selectedItem?.website ?? '',
                  }}
                  placeholder="+"
                />
                <h2 className="detail-title">{form.title}</h2>
                <button
                  aria-label={t('vault.favorite')}
                  aria-pressed={form.favorite}
                  className={form.favorite ? 'icon-button active' : 'icon-button'}
                  onClick={handleFavorite}
                  title={t('vault.favorite')}
                  type="button"
                >
                  <Star fill={form.favorite ? 'currentColor' : 'none'} size={16} />
                </button>
              </div>
              <div className="detail-view-body">
                {(showUsername && form.username) || form.password || viewLoginFields.length || viewOtpIndexes.length ? (
                  <div className="field-group">
                    {showUsername && form.username ? (
                      <FieldView fieldType="text" label={usernameLabel} onCopy={copyFieldValue} value={form.username} />
                    ) : null}
                    {form.password ? (
                      <FieldView
                        fieldType="password"
                        label={passwordLabel}
                        onCopy={copyFieldValue}
                        revealAll={revealAllSecure}
                        value={form.password}
                      />
                    ) : null}
                    {viewLoginFields.map(({ field, index }) =>
                      field.field_type === 'passkey' ? (
                        <PasskeyRow
                          createdAt={passkeyCreatedAt(field, form.custom_fields, selectedItem?.created_at)}
                          field={field}
                          key={`login-view-${index}`}
                        />
                      ) : field.field_type === 'sign_in_with' ? (
                        <SignInRow
                          account={viewRelations?.sign_in_with ?? null}
                          accountDetail={items.find((item) => item.id === viewRelations?.sign_in_with?.id)?.username}
                          key={`login-view-${index}`}
                          onOpen={(ref) => openRelatedItem(ref.id)}
                          provider={parseSignInProvider(field.value)}
                        />
                      ) : (
                        <FieldView
                          fieldType="text"
                          key={`login-view-${index}`}
                          label={field.label.trim() || t(`vault.customFieldDefaults.${field.field_type}`)}
                          onCopy={copyFieldValue}
                          value={field.value}
                        />
                      ),
                    )}
                    {viewOtpIndexes.map((index) => {
                      const field = form.custom_fields[index]
                      if (!field) return null
                      return (
                        <OtpFieldView
                          key={`otp-view-${index}`}
                          label={field.label.trim() || t('vault.customFieldDefaults.otp')}
                          onCopy={() => void copyFieldTotp(index)}
                          onCopySecret={() => void copyTotpSecret(index)}
                          onCopySetupLink={() => void copyTotpSetupLink(index)}
                          preview={fieldTotpPreviews[index]}
                        />
                      )
                    })}
                  </div>
                ) : null}
                {viewWebsites.length ? (
                  <div className="field-group">
                    {viewWebsites.map((itemUrl) => {
                      const note = autofillViewNote(t, itemUrl.match_type, itemUrl.url)
                      return (
                        <FieldView
                          canFill={features.browserExtension}
                          fieldType="url"
                          footer={note ? <span className="field-row-note">{note}</span> : null}
                          key={itemUrl.id}
                          label={itemUrl.label === defaultWebsiteLabel ? t('vault.website') : itemUrl.label}
                          onCopy={copyFieldValue}
                          onOpenUrl={openItemWebsite}
                          value={itemUrl.url}
                          // "Never fill on this website" drops Open & Fill too (1Password 8.10.80); it still opens.
                          website={itemUrl.match_type !== 'never'}
                        />
                      )
                    })}
                  </div>
                ) : null}
                {viewSections.map(({ children, index, title }) => (
                  <section aria-label={title} className="field-section" key={`section-view-${index}`}>
                    <h3 className="field-group-title">{title}</h3>
                    <div className="field-group">
                      {children.map((child) => {
                        const templateField = findTemplateField(form.item_type, child.key)
                        const label = childDisplayLabel(form.item_type, child, fieldLabels)
                        return (
                          <div className="contents" key={child.id}>
                            <FieldView
                              fieldType={child.field_type}
                              label={label}
                              meta={templateFieldMeta(templateField)}
                              onCopy={copyFieldValue}
                              revealAll={revealAllSecure}
                              // The network already has its own row once it is filled in.
                              showBrand={!children.some((sibling) => sibling.key === 'brand')}
                              value={child.value}
                            />
                            {child.key === 'publicKey' && form.item_type === 'ssh_key' ? (
                              <SshFingerprintView
                                label={t(sshFingerprintLabelKey)}
                                onCopy={copyFieldValue}
                                publicKey={child.value}
                              />
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ))}
                {viewOtherFields.length ? (
                  <div className="field-group">
                    {viewOtherFields.map(({ field, index }) => (
                      <FieldView
                        actions={
                          field.field_type === 'file' && field.value.startsWith('attachment://') ? (
                            <button className="secondary-button" onClick={() => openAttachment(field)} type="button">
                              {t('vault.exportAttachment')}
                            </button>
                          ) : undefined
                        }
                        activate={
                          isTextPreviewable(field)
                            ? { label: t('attachments.preview'), run: () => void openTextPreview(field) }
                            : undefined
                        }
                        display={
                          field.field_type === 'related_item'
                            ? itemTitleById(items, field.value)
                            : field.field_type === 'sign_in_with'
                              ? signInLabel(parseSignInProvider(field.value))
                              : field.field_type === 'file'
                                ? fileNameFromPath(field.value)
                                : undefined
                        }
                        fieldType={specialFieldTypes.includes(field.field_type) ? 'text' : field.field_type}
                        key={`field-view-${index}`}
                        label={field.label.trim() || t(`vault.customFieldDefaults.${field.field_type}`)}
                        onCopy={copyFieldValue}
                        revealAll={revealAllSecure}
                        value={field.value}
                      />
                    ))}
                  </div>
                ) : null}
                {(
                  [
                    ['parent', 'vault.relations.parent', viewRelations?.parent ? [viewRelations.parent] : []],
                    ['child', 'vault.relations.children', viewRelations?.children ?? []],
                    ['related', 'vault.relations.related', viewRelations?.related ?? []],
                    ['signsInTo', 'vault.signIn.usedBy', viewRelations?.signs_in_to ?? []],
                  ] as const
                ).map(([kind, headingKey, refs]) => (
                  <RelationSection
                    archivedLabel={t('vault.relations.archived')}
                    heading={t(headingKey)}
                    iconFor={relationIcon}
                    key={kind}
                    onOpen={(ref) => openRelatedItem(ref.id)}
                    openLabel={(title) => t('vault.relations.open', { title })}
                    refs={refs}
                    typeLabel={relationTypeLabel}
                  />
                ))}
                {tagList(form.tagsInput).length ? (
                  <div className="field-group">
                    <div className="field-row">
                      <div className="field-row-main">
                        <span className="field-row-label">{t('vault.tags')}</span>
                        <span className="tag-chip-box">
                          {tagList(form.tagsInput).map((tag) => (
                            <span className="tag-chip" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}
                {form.notes.trim() ? (
                  <div className="field-group">
                    <FieldView
                      fieldType="multiline"
                      label={t('vault.notes')}
                      onCopy={copyFieldValue}
                      value={form.notes}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          )
        ) : (
          /* Nothing is open and no draft is being written, so the pane says so instead of showing a
             blank create form — the state the list lands in after the open item is trashed. */
          <div className="detail-empty">
            <Inbox aria-hidden="true" className="detail-empty-icon" size={28} />
            <h2>{t('vault.noItemSelected')}</h2>
            <p>{t('vault.noItemSelectedHint')}</p>
            <button
              aria-expanded={itemTypePickerOpen}
              aria-haspopup="menu"
              className="secondary-button"
              data-field-menu=""
              onClick={(event) => openItemTypePicker(event.currentTarget)}
              type="button"
            >
              <Plus size={15} />
              {t('vault.newItem')}
            </button>
          </div>
        )}

        {/* Outside the two branches, because the action that most needs to say it just moved the item
            out of the pane. A toast that clears itself, placed where Appearance says. */}
        <Toast message={operationMessage} onDismiss={() => setOperationMessage(null)} />
      </section>

      {/* Phone layout only: Settings as a tab of the one window, and the tab bar that switches panes
          (iOS tab bar / Material navigation bar — the shapes are in src/skin/mobile.css). */}
      {isMobileLayout ? (
        <>
          {mobileTab === 'settings' ? (
            <section aria-label={t('settings.title')} className="mobile-settings">
              <SettingsWindow embedded />
            </section>
          ) : null}
          <nav aria-label={t('mobile.tabs')} className="mobile-tabbar">
            {(
              [
                ['items', KeyRound, 'mobile.items'],
                ['browse', LayoutGrid, 'mobile.browse'],
                ['settings', Cog, 'settings.title'],
              ] as const
            ).map(([tab, Icon, labelKey]) => (
              <button
                aria-current={mobileTab === tab ? 'page' : undefined}
                className={mobileTab === tab ? 'mobile-tab active' : 'mobile-tab'}
                key={tab}
                onClick={() => {
                  // Tapping the tab you are on goes back to its root, as both platforms do.
                  if (tab === 'items' && mobileTab === 'items') setMobileDetailOpen(false)
                  setMobileTab(tab)
                }}
                type="button"
              >
                <span className="mobile-tab-icon">
                  <Icon size={22} />
                </span>
                <span className="mobile-tab-label">{t(labelKey)}</span>
              </button>
            ))}
          </nav>
        </>
      ) : null}
      {/* Every item type is created from here, because the type decides which fields the draft opens
          with. A dropdown hung from the New Item button (owner 2026-10-18), in the sidebar's own category
          order, with the same icon size and type as every other menu. */}
      {itemTypePickerOpen ? (
        <div
          aria-label={t('vault.chooseItemType')}
          className="add-more-menu item-type-menu"
          data-field-menu=""
          ref={itemTypePanelRef}
          role="menu"
          style={{ ...itemTypePanelPlaced, overflowY: 'auto' }}
        >
          {categoryItems.map((category, index) => {
            const Icon = category.icon
            const art = itemTypeArtFor(category.itemType)
            return (
              <button
                className="menu-option with-icon"
                key={category.itemType}
                onClick={() => handleNewItem(category.itemType)}
                ref={index === 0 ? itemTypeFirstOptionRef : undefined}
                role="menuitem"
                type="button"
              >
                {art ? (
                  <img alt="" className="menu-option-art" draggable={false} height={15} src={art} width={15} />
                ) : (
                  <Icon aria-hidden="true" className={category.colorClass} size={15} />
                )}
                <span>{t(`itemTypes.${category.itemType}`)}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {/* The item picker for a link: a sheet with a search field over the vault's live items, minus
          the item itself, what it is already linked to, and anything that would close a loop. */}
      {relationPicker ? (
        <div className="confirm-layer">
          <button
            aria-label={t('common.close')}
            className="confirm-backdrop"
            onClick={() => setRelationPicker(null)}
            type="button"
          />
          <div
            aria-labelledby="relation-picker-title"
            aria-modal="true"
            className="confirm-dialog relation-picker"
            role="dialog"
          >
            <h2 id="relation-picker-title">{t(`vault.relations.pickerTitle.${relationPicker}`)}</h2>
            <p className="relation-picker-hint">{t(`vault.relations.pickerHint.${relationPicker}`)}</p>
            <div className="relation-picker-search">
              <Search aria-hidden="true" size={15} />
              <input
                aria-controls="relation-picker-list"
                aria-label={t('vault.relations.search')}
                onChange={(event) => setRelationQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    document.querySelector<HTMLButtonElement>('#relation-picker-list button')?.focus()
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (relationPickerItems.length === 1) pickRelation(relationPickerItems[0].id)
                  }
                }}
                placeholder={t('vault.relations.search')}
                ref={relationSearchRef}
                type="search"
                value={relationQuery}
              />
            </div>
            {relationPickerItems.length ? (
              <ul
                aria-label={t(`vault.relations.pickerTitle.${relationPicker}`)}
                className="relation-picker-list"
                id="relation-picker-list"
              >
                {relationPickerItems.map((candidate) => {
                  const { colorClass, icon: Icon } = relationIcon(candidate.item_type)
                  return (
                    <li key={candidate.id}>
                      <button
                        className="relation-picker-option"
                        onClick={() => pickRelation(candidate.id)}
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                          event.preventDefault()
                          const row = event.currentTarget.closest('li')
                          const next = event.key === 'ArrowDown' ? row?.nextElementSibling : row?.previousElementSibling
                          if (next) next.querySelector('button')?.focus()
                          else if (event.key === 'ArrowUp') relationSearchRef.current?.focus()
                        }}
                        type="button"
                      >
                        <ItemIcon
                          className="picker-icon"
                          fallback={<Icon aria-hidden="true" className={colorClass} size={16} />}
                          item={candidate}
                        />
                        <span className="relation-row-text">
                          <span className="relation-row-title">{candidate.title}</span>
                          <span className="relation-row-caption">{relationTypeLabel(candidate.item_type)}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="relation-picker-empty">
                {relationQuery.trim() ? t('vault.relations.noMatches') : t('vault.relations.noCandidates')}
              </p>
            )}
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setRelationPicker(null)} type="button">
                {t('vault.cancelEditing')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {signInPickerOpen ? (
        <SignInPicker
          initialAccountId={form.relationDraft.signInId}
          initialProvider={itemSignInProvider(form)}
          items={items}
          onCancel={() => setSignInPickerOpen(false)}
          onDone={applySignIn}
          selfId={selectedItem?.id ?? null}
        />
      ) : null}
      {/* The header's ellipsis. Two sections share one anchor: the vault list swaps in place rather
          than flying out beside a panel that already sits at the right edge of the window. */}
      {itemMenu ? (
        <div
          className="add-more-menu item-actions-menu"
          data-field-menu=""
          ref={itemMenuPanelRef}
          role="menu"
          style={itemMenuSource === 'header' ? { ...itemMenuPlaced, overflowY: 'auto' } : itemMenuAnchor?.style}
        >
          {itemMenu === 'move' ? (
            <>
              <button className="menu-option with-icon" onClick={() => setItemMenu('actions')} type="button">
                <ChevronLeft aria-hidden="true" size={15} />
                <span className="menu-option-label">
                  <span>{t('vault.moveTo')}</span>
                </span>
              </button>
              {otherVaults.map((vault) => (
                <button
                  className="menu-option with-icon"
                  key={vault.id}
                  onClick={() => void handleMoveToVault(vault.id, vault.name)}
                  type="button"
                >
                  <Vault aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{vault.name}</span>
                  </span>
                </button>
              ))}
            </>
          ) : (
            <>
              {/* Where the panel opened decides what it offers: a row has no 编辑 button next to it, and
                  the header has no need of one; 分享 copies the password, which is the header's business
                  on the item already on screen. */}
              {itemMenuSource === 'row' ? (
                <button className="menu-option with-icon" onClick={beginEdit} type="button">
                  <Pencil aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{t('vault.edit')}</span>
                  </span>
                </button>
              ) : null}
              <button
                className="menu-option with-icon"
                onClick={() => {
                  closeFieldMenus()
                  void handleFavorite()
                }}
                type="button"
              >
                <Star aria-hidden="true" size={15} />
                <span className="menu-option-label">
                  <span>{selectedItem?.favorite ? t('vault.unfavorite') : t('vault.favorite')}</span>
                </span>
              </button>
              {otherVaults.length ? (
                // Links never cross a vault, so a linked item stays put until its links are removed.
                <button
                  className="menu-option with-icon"
                  disabled={selectedHasRelations}
                  onClick={() => setItemMenu('move')}
                  type="button"
                >
                  <FolderInput aria-hidden="true" size={15} />
                  <span className={selectedHasRelations ? 'menu-option-label' : 'menu-option-label trailing'}>
                    <span>{t('vault.moveTo')}</span>
                    {selectedHasRelations ? (
                      <small>{t('vault.relations.moveBlocked')}</small>
                    ) : (
                      <ChevronRight aria-hidden="true" size={15} />
                    )}
                  </span>
                </button>
              ) : null}
              <button className="menu-option with-icon" onClick={() => void handleDuplicate()} type="button">
                <Copy aria-hidden="true" size={15} />
                <span className="menu-option-label">
                  <span>{t('vault.duplicateItem')}</span>
                </span>
              </button>
              {selectedItem && siteIconDomain(selectedItem) ? (
                <>
                  {siteIconsEnabled ? (
                    <button className="menu-option with-icon" onClick={() => void handleRefreshIcon()} type="button">
                      <RefreshCw aria-hidden="true" size={15} />
                      <span className="menu-option-label">
                        <span>{t('vault.siteIcon.refresh')}</span>
                      </span>
                    </button>
                  ) : null}
                  {selectedItem.icon_mode === 'letter' ? (
                    <button className="menu-option with-icon" onClick={() => void handleIconMode('auto')} type="button">
                      <Globe aria-hidden="true" size={15} />
                      <span className="menu-option-label">
                        <span>{t('vault.siteIcon.useWebsite')}</span>
                      </span>
                    </button>
                  ) : (
                    <button
                      className="menu-option with-icon"
                      onClick={() => void handleIconMode('letter')}
                      type="button"
                    >
                      <CaseUpper aria-hidden="true" size={15} />
                      <span className="menu-option-label">
                        <span>{t('vault.siteIcon.useLetter')}</span>
                      </span>
                    </button>
                  )}
                </>
              ) : null}
              {itemMenuSource === 'header' ? (
                <button className="menu-option with-icon" onClick={() => void handleShare()} type="button">
                  <Share aria-hidden="true" size={15} />
                  <span className="menu-option-label">
                    <span>{t('vault.shareAction')}</span>
                    <small>{t('vault.shareHint')}</small>
                  </span>
                </button>
              ) : null}
              <button
                className="menu-option with-icon separated"
                onClick={() => {
                  closeFieldMenus()
                  void handleArchive()
                }}
                type="button"
              >
                <Archive aria-hidden="true" size={15} />
                <span className="menu-option-label">
                  <span>{t('vault.archiveAction')}</span>
                </span>
              </button>
              {/* An item with a parent, children or peers cannot be deleted (Rust refuses it too); the row
                  stays visible but unavailable and says why, with Archive right above it. */}
              <button
                aria-describedby={selectedHasRelations ? 'delete-blocked-hint' : undefined}
                className="menu-option with-icon is-danger"
                disabled={selectedHasRelations}
                onClick={() => {
                  closeFieldMenus()
                  void handleTrash()
                }}
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
                <span className="menu-option-label">
                  <span>{t('common.delete')}</span>
                  {selectedHasRelations ? (
                    <small id="delete-blocked-hint">{t('vault.relations.deleteBlocked')}</small>
                  ) : null}
                </span>
              </button>
            </>
          )}
        </div>
      ) : null}
      {/* A tag row is the only place its icon and name can be changed, and a right-click is how you get
          there. The panel is the same anchored menu the field buttons use, so it clears the sidebar's
          clip and flips above the cursor when the row sits near the foot of the window. */}
      {tagMenu ? (
        <div className="add-more-menu" data-field-menu="" style={tagMenuAnchor?.style}>
          <button className="menu-option with-icon" onClick={openTagEditor} type="button">
            <Pencil aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>{t('vault.editTag')}</span>
            </span>
          </button>
          <button
            className="menu-option with-icon"
            onClick={() => toggleRowHighlight('tag', tagMenu.key)}
            type="button"
          >
            <Pin aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>{t(isHighlighted(highlights, 'tag', tagMenu.key) ? 'vault.unhighlight' : 'vault.highlight')}</span>
            </span>
          </button>
          <button className="menu-option with-icon is-danger" onClick={askTagDelete} type="button">
            <Trash2 aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>{t('vault.deleteTag')}</span>
            </span>
          </button>
        </div>
      ) : null}
      {/* A category is a fixed type rather than a stored row, so keeping it on screen is the only thing a
          right-click can do to it — and the row names which way the toggle will go. */}
      {categoryMenu ? (
        <div className="add-more-menu" data-field-menu="" style={categoryMenuAnchor?.style}>
          <button
            className="menu-option with-icon"
            onClick={() => toggleRowHighlight('category', categoryMenu)}
            type="button"
          >
            <Pin aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>
                {t(isHighlighted(highlights, 'category', categoryMenu) ? 'vault.unhighlight' : 'vault.highlight')}
              </span>
            </span>
          </button>
        </div>
      ) : null}
      {/* The title speaks for its own section only, because folding is a per-section act too — and it only
          opens when that section has a row to take back. */}
      {sectionHighlightMenu ? (
        <div className="add-more-menu" data-field-menu="" style={sectionHighlightMenuAnchor?.style}>
          <button className="menu-option with-icon" onClick={clearSectionHighlights} type="button">
            <PinOff aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>{t('vault.clearHighlights')}</span>
            </span>
          </button>
        </div>
      ) : null}
      {/* Renaming a tag is one row, not every item that names it, so this panel changes the row and the
          items read the new spelling on their own. */}
      {tagEditor ? (
        <StyleEditorDialog
          draft={tagEditor}
          nameLabel={t('vault.tagName')}
          onCancel={closeTagEditor}
          onDraftChange={(patch) => setTagEditor((current) => (current ? { ...current, ...patch } : current))}
          onSubmit={handleTagSave}
          title={t('vault.editTag')}
          titleId="tag-editor-title"
        />
      ) : null}
      {/* Deleting a label is not deleting what it labels, and the panel has to say that in the same
          breath it asks — the count is how many items lose their way to this tag. */}
      {tagDeleteTarget ? (
        <div className="confirm-layer">
          <button
            aria-label={t('common.close')}
            className="confirm-backdrop"
            onClick={() => setTagDeleteTarget(null)}
            type="button"
          />
          <div aria-labelledby="tag-delete-title" aria-modal="true" className="confirm-dialog" role="alertdialog">
            <h2 id="tag-delete-title">{t('vault.deleteTag')}</h2>
            <p>{t('vault.confirmDeleteTag', { count: tagDeleteTarget.count, name: tagDeleteTarget.name })}</p>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setTagDeleteTarget(null)} type="button">
                {t('vault.cancelEditing')}
              </button>
              <button className="danger-button" onClick={handleTagDelete} type="button">
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* A vault row governs the whole window, so its right-click is the only place it can be renamed,
          put away, or taken apart. Dissolve is the one option that destroys something, so it is the
          separated danger row — and it does not appear at all on a row that has nowhere to send its items. */}
      {vaultMenu ? (
        <div className="add-more-menu" data-field-menu="" style={vaultMenuAnchor?.style}>
          <button className="menu-option with-icon" onClick={openVaultEditor} type="button">
            <Pencil aria-hidden="true" size={15} />
            <span className="menu-option-label">
              <span>{t('vault.editVault')}</span>
            </span>
          </button>
          <button className="menu-option with-icon" onClick={handleVaultArchive} type="button">
            {vaultMenu.archived ? (
              <ArchiveRestore aria-hidden="true" size={15} />
            ) : (
              <Archive aria-hidden="true" size={15} />
            )}
            <span className="menu-option-label">
              <span>{t(vaultMenu.archived ? 'vault.restoreVault' : 'vault.archiveVault')}</span>
            </span>
          </button>
          {canDissolveVault(vaultMenu) ? (
            <button className="menu-option with-icon is-danger separated" onClick={askVaultDissolve} type="button">
              <Trash2 aria-hidden="true" size={15} />
              <span className="menu-option-label">
                <span>{t('vault.dissolveVault')}</span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
      {vaultEditor ? (
        <StyleEditorDialog
          draft={vaultEditor}
          nameLabel={t('vault.vaultName')}
          onCancel={closeVaultEditor}
          onDraftChange={(patch) => setVaultEditor((current) => (current ? { ...current, ...patch } : current))}
          onSubmit={handleVaultSave}
          title={t('vault.editVault')}
          titleId="vault-editor-title"
        />
      ) : null}
      {/* Dissolving moves everything out — archived and trashed rows included, since there is no export
          and no undo — and then deletes the row. An empty vault is asked differently, because the count
          that makes a destination necessary is zero there. */}
      {vaultDissolveTarget ? (
        <div className="confirm-layer">
          <button
            aria-label={t('common.close')}
            className="confirm-backdrop"
            onClick={() => setVaultDissolveTarget(null)}
            type="button"
          />
          <div aria-labelledby="vault-dissolve-title" aria-modal="true" className="confirm-dialog" role="alertdialog">
            <h2 id="vault-dissolve-title">{t('vault.dissolveVault')}</h2>
            <p>
              {vaultDissolveTarget.item_count > 0
                ? t('vault.confirmDissolveVault', {
                    count: vaultDissolveTarget.item_count,
                    name: vaultDissolveTarget.name,
                  })
                : t('vault.confirmDissolveEmpty', { name: vaultDissolveTarget.name })}
            </p>
            {vaultDissolveTarget.item_count > 0 ? (
              <label>
                {t('vault.dissolveInto')}
                <select onChange={(event) => setVaultDissolveInto(event.target.value)} value={vaultDissolveInto}>
                  {dissolveDestinationsFor(vaultDissolveTarget).map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setVaultDissolveTarget(null)} type="button">
                {t('vault.cancelEditing')}
              </button>
              <button
                className="danger-button"
                disabled={vaultDissolveTarget.item_count > 0 && !vaultDissolveInto}
                onClick={handleVaultDissolve}
                type="button"
              >
                {t('vault.dissolveVault')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* The only way to end a trashed row is here, and window.confirm() answers false without ever
          showing anything, so the question is drawn in the page. Its dismiss is a real button behind
          the card, not a click handler on a div: it stays keyboard reachable, and a click inside the
          card cannot reach it. */}
      {textPreview ? (
        <TextPreviewDialog
          onClose={closeTextPreview}
          onCopy={async (text) => {
            try {
              // An attachment in a password vault may well hold a secret: it honours the 90-second clear.
              await copySecretText(text, true)
              return true
            } catch (nextError) {
              setError(String(nextError))
              return false
            }
          }}
          state={textPreview}
        />
      ) : null}
      {purgeTarget ? (
        <div className="confirm-layer">
          <button
            aria-label={t('vault.cancelEditing')}
            className="confirm-backdrop"
            onClick={() => setPurgeTarget(null)}
            type="button"
          />
          <div aria-labelledby="purge-confirm-title" aria-modal="true" className="confirm-dialog" role="alertdialog">
            <h2 id="purge-confirm-title">{t('vault.purgeHeading')}</h2>
            <p>{t('vault.confirmPurge', { title: purgeTarget.title })}</p>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setPurgeTarget(null)} type="button">
                {t('vault.cancelEditing')}
              </button>
              <button className="danger-button" onClick={purgeTrashedItem} type="button">
                {t('vault.purge')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {onePuxPreview ? (
        <div className="confirm-layer">
          <button
            aria-label={t('vault.cancelEditing')}
            className="confirm-backdrop"
            disabled={isImporting1pux}
            onClick={() => setOnePuxPreview(null)}
            type="button"
          />
          <div aria-labelledby="import-1pux-title" aria-modal="true" className="confirm-dialog" role="dialog">
            <h2 id="import-1pux-title">{t('vault.import1pux.heading')}</h2>
            <p>
              {t('vault.import1pux.summary', {
                attachments: onePuxPreview.attachment_count,
                count: onePuxPreview.item_count,
                file: onePuxPreview.path.split(/[\\/]/).pop(),
              })}
            </p>
            <ul className="import-vault-list">
              {onePuxPreview.vaults.map((vault) => (
                <li key={vault.name}>
                  <span className="import-vault-name">{vault.name}</span>
                  <span className="import-vault-meta">
                    {t('vault.import1pux.items', { count: vault.item_count })} ·{' '}
                    {t(vault.exists ? 'vault.import1pux.intoExisting' : 'vault.import1pux.intoNew')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="import-vault-note">{t('vault.import1pux.note')}</p>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                disabled={isImporting1pux}
                onClick={() => setOnePuxPreview(null)}
                type="button"
              >
                {t('vault.cancelEditing')}
              </button>
              <button
                className="primary-button"
                disabled={isImporting1pux || !onePuxPreview.item_count}
                onClick={() => void confirm1puxImport()}
                type="button"
              >
                {isImporting1pux ? t('vault.import1pux.importing') : t('vault.import1pux.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* A new vault needs a name before anything can go in it. prompt() is as dead here as confirm()
          was, so the same small modal recipe collects it with a labelled field. */}
      {isCreatingVault ? (
        <div className="confirm-layer">
          <button
            aria-label={t('common.close')}
            className="confirm-backdrop"
            onClick={closeCreateVault}
            type="button"
          />
          <div aria-labelledby="create-vault-title" aria-modal="true" className="confirm-dialog" role="dialog">
            <h2 id="create-vault-title">{t('vault.createVault')}</h2>
            <form onSubmit={handleCreateVault}>
              <label>
                {t('vault.vaultName')}
                <input
                  onChange={(event) => setVaultNameDraft(event.target.value)}
                  ref={vaultNameInputRef}
                  type="text"
                  value={vaultNameDraft}
                />
              </label>
              <div className="confirm-actions">
                <button className="secondary-button" onClick={closeCreateVault} type="button">
                  {t('vault.cancelEditing')}
                </button>
                <button className="primary-button" disabled={!vaultNameDraft.trim()} type="submit">
                  {t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  )
}

type SettingsTab = 'general' | 'appearance' | 'browser' | 'watchtower' | 'security' | 'shortcuts'

const settingsTabs: SettingsTab[] = ['general', 'appearance', 'browser', 'watchtower', 'security', 'shortcuts']

/**
 * Settings: its own window on desktop, a tab of the one window on phones (`embedded`). What a pane offers
 * follows `featuresFor(platform)` — no extension pairing, launch-at-login or keyboard shortcuts on a phone, no
 * Touch ID rows off the Mac.
 */
function SettingsWindow({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation()
  const { platform } = usePlatformState()
  const features = featuresFor(platform)
  const visibleSettingsTabs = settingsTabs.filter(
    (id) => (id !== 'browser' || features.browserExtension) && (id !== 'shortcuts' || features.keyboardShortcuts),
  )
  const quickAccess = quickAccessKeys(platform)
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    return isSettingsTab(requested) ? requested : 'general'
  })
  // The toolbar search in the main window can ask an open Settings for another pane.
  useEffect(() => {
    const onLocal = (event: Event) => {
      const tab = (event as CustomEvent<unknown>).detail
      if (isSettingsTab(tab)) setActiveTab(tab)
    }
    window.addEventListener(settingsTabEvent, onLocal)
    if (embedded) return () => window.removeEventListener(settingsTabEvent, onLocal)
    let unlisten: (() => void) | null = null
    let disposed = false
    listen<unknown>(settingsTabEvent, (event) => {
      if (isSettingsTab(event.payload)) setActiveTab(event.payload)
    })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => {})
    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener(settingsTabEvent, onLocal)
    }
  }, [embedded])
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [operationMessage, setOperationMessage] = useState<string | null>(null)
  const [siteIconsOn, setSiteIconsOn] = useState(() => readSiteIconsEnabled())
  const toastPosition = useToastPosition()
  const [watchtower, setWatchtower] = useState<WatchtowerReport | null>(null)
  const [breachResult, setBreachResult] = useState<BreachCheckResult | null>(null)
  const [browserToken, setBrowserToken] = useState('')
  const [tokenCopied, setTokenCopied] = useState(false)
  const [securityPreferences, setSecurityPreferences] = useState<SecurityPreferences>(() => loadSecurityPreferences())
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme(localStorage.getItem('passless-theme')))
  const [language, setLanguage] = useState<SupportedLanguage>(() =>
    getInitialLanguage(localStorage.getItem('passless-language')),
  )

  useEffect(() => {
    localStorage.setItem('passless-theme', theme)
    syncWindowTheme(theme, currentPlatformState().platform)
    return applyTheme(theme)
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
    vaultApi
      .isAutostartEnabled()
      .then(setAutostartEnabled)
      .catch(() => setAutostartEnabled(false))
  }, [])

  async function updateSiteIcons(enabled: boolean) {
    setError(null)
    writeSiteIconsEnabled(enabled)
    setSiteIconsOn(enabled)
    if (enabled) return
    // Off means off: the icons already saved go too, not just future downloads.
    forgetSiteIcons()
    try {
      await vaultApi.clearSiteIcons()
    } catch {
      // Locked: nothing can be read without the key anyway, and the next unlock with the setting
      // off neither shows nor fetches any icon.
    }
  }

  async function updateAutostart(enabled: boolean) {
    setError(null)
    try {
      await vaultApi.setAutostart(enabled)
      setAutostartEnabled(enabled)
    } catch (nextError) {
      setError(String(nextError))
    }
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

  async function copyPairingToken() {
    // The token unlocks the bridge, so it follows the same 90-second clipboard clear as a password.
    const copied = await copyText(browserToken, {
      clearAfter90Seconds: loadSecurityPreferences().clearClipboardAfter90Seconds,
      sensitive: true,
    }).catch(() => false)
    if (!copied) return
    setTokenCopied(true)
    window.setTimeout(() => setTokenCopied(false), 1500)
  }

  async function generatePairingToken() {
    setTokenCopied(false)
    setBrowserToken(await vaultApi.generateBrowserPairingToken())
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
  // Linux windows have no title bar (Hyprland), so the settings window offers its own way out: a close
  // button and Escape.
  const ownCloseButton = features.undecoratedWindows && !embedded

  useEffect(() => {
    if (!ownCloseButton) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void getCurrentWebviewWindow().close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ownCloseButton])

  const Shell = embedded ? 'div' : 'main'

  return (
    <Shell className="settings-shell" data-tauri-drag-region>
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
          {visibleSettingsTabs.map((id) => (
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
          {ownCloseButton ? (
            <button
              aria-label={t('common.close')}
              className="icon-button settings-close-button"
              onClick={() => void getCurrentWebviewWindow().close()}
              title={t('common.close')}
              type="button"
            >
              <X size={16} />
            </button>
          ) : null}
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        <Toast message={operationMessage} onDismiss={() => setOperationMessage(null)} />

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
              <h2>{t('settings.siteIcons')}</h2>
              <p>{t('settings.siteIconsDescription')}</p>
              <label className="checkbox-row">
                <input
                  checked={siteIconsOn}
                  onChange={(event) => void updateSiteIcons(event.target.checked)}
                  type="checkbox"
                />
                {t('settings.downloadSiteIcons')}
              </label>
            </div>
            {features.autostart ? (
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
            ) : null}
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
              <div className="segmented-control">
                {themeOptions.map((option) => (
                  <button
                    aria-pressed={theme === option}
                    className="segment-button secondary-button"
                    key={option}
                    onClick={() => updateTheme(option)}
                    type="button"
                  >
                    {t(`settings.${option}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="integration-card">
              <h2>{t('settings.toastPosition')}</h2>
              <p>{t('settings.toastPositionDescription')}</p>
              <div className="segmented-control">
                {toastPositions.map((option) => (
                  <button
                    aria-pressed={toastPosition === option}
                    className="segment-button secondary-button"
                    key={option}
                    onClick={() => writeToastPosition(option)}
                    type="button"
                  >
                    {t(`settings.toastPositions.${option}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'browser' && features.browserExtension ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('integrations.browserExtension')}</h2>
              <p>{t('integrations.browserDescription')}</p>
              <code>http://127.0.0.1:17891</code>
              <button className="secondary-button" disabled={locked} onClick={generatePairingToken} type="button">
                {t('integrations.generatePairingToken')}
              </button>
              {browserToken ? (
                <div className="pairing-token-row">
                  <code>{browserToken}</code>
                  <button
                    aria-label={tokenCopied ? t('fieldActions.copied') : t('fieldActions.copy')}
                    className="icon-button pairing-token-copy"
                    onClick={copyPairingToken}
                    title={tokenCopied ? t('fieldActions.copied') : t('fieldActions.copy')}
                    type="button"
                  >
                    {tokenCopied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
                  </button>
                </div>
              ) : null}
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
              {/* The phones keep the same preference key: it means "biometric unlock" wherever it exists. */}
              {features.biometrics ? (
                <label className="security-check-row">
                  <input
                    checked={securityPreferences.unlockUsingTouchId}
                    onChange={(event) => updateSecurityPreference('unlockUsingTouchId', event.target.checked)}
                    type="checkbox"
                  />
                  {features.biometrics === 'touch-id'
                    ? t('security.unlockUsingTouchId')
                    : t('security.unlockUsingBiometrics')}
                </label>
              ) : null}
              {features.biometrics === 'touch-id' ? (
                <label className="security-check-row">
                  <input
                    checked={securityPreferences.unlockWithMacPassword}
                    onChange={(event) => updateSecurityPreference('unlockWithMacPassword', event.target.checked)}
                    type="checkbox"
                  />
                  {t('security.unlockWithMacPassword')}
                </label>
              ) : null}
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
          </div>
        ) : null}

        {activeTab === 'shortcuts' ? (
          <div className="settings-section">
            <div className="integration-card">
              <h2>{t('shortcuts.title')}</h2>
              <p>{t('shortcuts.description')}</p>
              <div className="shortcut-list">
                {[
                  [shortcutLabel('mod+,', platform), 'shortcuts.openSettings'],
                  [shortcutLabel('mod+n', platform), 'shortcuts.newItem'],
                  [shortcutLabel('mod+f', platform), 'shortcuts.focusSearch'],
                  [shortcutLabel('mod+↑', platform), 'shortcuts.previousItem'],
                  [shortcutLabel('mod+↓', platform), 'shortcuts.nextItem'],
                  [shortcutLabel('mod+k', platform), 'shortcuts.lockVault'],
                  [shortcutLabel('mod+c', platform), 'shortcuts.copyUsername'],
                  [shortcutLabel('mod+shift+c', platform), 'shortcuts.copyPassword'],
                  [shortcutLabel('mod+alt+c', platform), 'shortcuts.copyOtp'],
                  [shortcutLabel('mod+shift+f', platform), 'shortcuts.openAndFill'],
                  [shortcutLabel('mod+r', platform), 'shortcuts.revealSecure'],
                  // Linux: the compositor owns global keys, so the row names the command to bind.
                  ...(quickAccess ? [[quickAccess, 'shortcuts.quickAccess']] : []),
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
    </Shell>
  )
}

function QuickAccessWindow() {
  const { t } = useTranslation()
  const { platform } = usePlatformState()
  const [items, setItems] = useState<LoginItem[]>([])
  const [query, setQuery] = useState('')
  const [locked, setLocked] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme(localStorage.getItem('passless-theme')))
  const [language, setLanguage] = useState<SupportedLanguage>(() =>
    getInitialLanguage(localStorage.getItem('passless-language')),
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | null>(null)

  const signInLabel = useSignInLabel()
  const siteIconsEnabled = useSiteIconsEnabled()
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

  // The panel only reads icons the main window already fetched; it never starts a download itself.
  useEffect(() => {
    if (siteIconsEnabled && results.length) void loadSiteIcons(uniqueIconDomains(results), { download: false })
  }, [results, siteIconsEnabled])

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

  // Same clipboard rules as the main window: a password or code is cleared after 90 seconds when the
  // Security setting asks for it (read fresh, since Settings may have changed it while the panel was hidden).
  async function copyFromItem(item: LoginItem, kind: 'otp' | 'password' | 'username') {
    let value = kind === 'username' ? item.username : kind === 'password' ? item.password : ''
    if (kind === 'otp') {
      const index = otpSecretFieldIndexes(item.custom_fields)[0]
      const secret = index === undefined ? '' : (item.custom_fields[index]?.value ?? '')
      if (secret.trim()) value = (await vaultApi.generateTotp(secret).catch(() => null))?.code ?? ''
    }
    const copied = await copyText(value, {
      clearAfter90Seconds: loadSecurityPreferences().clearClipboardAfter90Seconds,
      sensitive: kind !== 'username',
    })
    if (!copied) return
    setCopiedId(item.id)
    hideTimerRef.current = window.setTimeout(() => void vaultApi.hideQuickAccess(), quickAccessCloseDelayMs)
  }

  async function copyPassword(item: LoginItem) {
    await copyFromItem(item, 'password')
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
      return
    }
    // 1Password's Quick Access keys: ⌘C username, ⇧⌘C password, ⌥⌘C one-time password (Ctrl elsewhere).
    // Text selected in the search field keeps ⌘C as a plain copy.
    if (event.code !== 'KeyC' || !isPrimaryModifier(event, platform)) return
    const input = event.target instanceof HTMLInputElement ? event.target : null
    if (input && input.selectionStart !== input.selectionEnd) return
    const item = results[selectedIndex]
    if (!item) return
    event.preventDefault()
    void copyFromItem(item, event.altKey ? 'otp' : event.shiftKey ? 'password' : 'username')
  }

  useEffect(() => applyTheme(theme), [theme])

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
              <ItemIcon item={item} />
              <strong>{item.title}</strong>
              <small>{item.username || (itemSignInProvider(item) ? signInLabel(itemSignInProvider(item)) : '')}</small>
              {copiedId === item.id ? <span className="quick-access-badge">{t('quickAccess.copied')}</span> : null}
            </button>
          ))}
          {results.length === 0 ? <p className="quick-access-message">{t('quickAccess.empty')}</p> : null}
        </div>
      )}

      <footer className="quick-access-footer" data-tauri-drag-region>
        <span>{t('quickAccess.copyHint')}</span>
        <span>
          {t('quickAccess.copyKeysHint', {
            otp: shortcutLabel('mod+alt+c', platform),
            password: shortcutLabel('mod+shift+c', platform),
            username: shortcutLabel('mod+c', platform),
          })}
        </span>
      </footer>
    </main>
  )
}
