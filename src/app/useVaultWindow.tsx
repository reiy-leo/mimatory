import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Globe, KeyRound, RefreshCw, Shapes } from 'lucide-react'
import {
  type FormEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { currentPlatformState, usePlatformState } from '../skin/runtime'
import type { AddMoreFieldType } from './addMoreOptions'
import { useAnchoredPanel } from './anchoredPanel'
import { attachmentId, type TextPreviewState } from './attachmentControls'
import { orderCredentialFields } from './fieldReorder'
import i18n from './i18n'
import { isFormDirty } from './itemDrafts'
import { parseSectionChildren, type SectionChild, sectionDisplayTitle, stringifySectionChildren } from './itemFields'
import type { ItemIconChoice } from './itemIconMenu'
import { adjacentItemId } from './itemNavigation'
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
} from './itemRelations'
import { sortItems } from './itemSort'
import {
  countItemTags,
  filterItemsByTag,
  type TagRow,
  tagKey,
  tagKeyFromNavigation,
  tagNavigationId,
  tagRows,
} from './itemTags'
import { getItemTemplate } from './itemTemplates'
import { itemTypeArtFor } from './itemTypeArt'
import { getMenuAnchorStyle, type MenuAnchor } from './menuPlacement'
import { clipboardImageFile, otpSecretFromQrImage } from './otpQrImport'
import { featuresFor, isPrimaryModifier } from './platformFeatures'
import { type SettingsTab, settingsSearchEntries, settingsTabEvent, settingsTabLabels } from './settingsTabs'
import {
  clearHighlightKeys,
  type HighlightKind,
  isHighlighted,
  readHighlightKeys,
  renameHighlightKeys,
  saveHighlightKeys,
  toggleHighlightKeys,
} from './sidebarHighlights'
import { useSignInLabel } from './signInControls'
import { summarySignInProvider, withSignInField } from './signInProviders'
import { loadSiteIcons, siteIconDomain, uniqueIconDomains, useSiteIconsEnabled } from './siteIcons'
import { buildOtpAuthUri, normalizeTotpSecret, otpSecretFieldIndexes } from './totpDisplay'
import { useColumnWidths } from './useColumnWidths'
import { useItemActions } from './useItemActions'
import { useItemDetail } from './useItemDetail'
import { useItemFormFields } from './useItemFormFields'
import { useItemSort } from './useItemSort'
import { useTotpPreviews } from './useTotpPreviews'
import { useVaultItems } from './useVaultItems'
import { useVaultSession } from './useVaultSession'
import { useWindowAppearance } from './useWindowAppearance'
import {
  type CustomField,
  customFieldsToInput,
  emptyLoginItem,
  type LoginItemSummary,
  type OnePuxPreview,
  type PasswordGeneratorOptions,
  type VaultSummary,
  vaultApi,
} from './vaultApi'
import {
  type ActiveNavigation,
  type CategoryItemType,
  categoryItems,
  fieldLabels,
  fileNameFromPath,
  highlightMenuHeight,
  itemMenuHeight,
  itemMenuWidth,
  type LoginFormState,
  loginSectionFieldTypes,
  passkeyCredentialFieldType,
  settingsWindowSize,
  tagMenuHeight,
  toFormState,
  toInput,
  vaultMenuHeight,
} from './vaultModel'
import { settingsWindowChrome } from './windowChrome'
import { getTopLeftCenteredOver } from './windowPlacement'

/**
 * VaultWindow's state and behaviour (moved verbatim out of App.tsx, owner 2026-10-23: "拆分 6000 行的 App.tsx"). The
 * window's components read what they need off the returned model.
 */
export function useVaultWindow() {
  const { t } = useTranslation()
  const {
    items,
    setItems,
    allItems,
    setAllItems,
    selectedId,
    setSelectedId,
    vaults,
    setVaults,
    activeVaultId,
    setActiveVaultId,
    archivedItems,
    setArchivedItems,
    trashedItems,
    setTrashedItems,
    tagRecords,
    setTagRecords,
    loadVaults,
    refreshItems,
    loadArchivedItems,
    loadTrashedItems,
  } = useVaultItems()
  const { itemSort, setItemSort, sortMenuOpen, setSortMenuOpen, chooseSort } = useItemSort()
  // The phone layout (src/skin/platform.ts: any window ≤ 760px, so every phone) shows one pane at a time:
  // the item list, the item, the sidebar as a Browse page, or Settings, switched by a bottom tab bar.
  const { layout, platform } = usePlatformState()
  const features = featuresFor(platform)
  const isMobileLayout = layout === 'mobile'
  const [mobileTab, setMobileTab] = useState<'browse' | 'items' | 'settings'>('items')
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const {
    itemListWidth,
    setItemListWidth,
    sidebarWidth,
    setSidebarWidth,
    beginColumnResize,
    beginItemListResize,
    beginSidebarResize,
  } = useColumnWidths()
  const [activeNavigation, setActiveNavigation] = useState<ActiveNavigation>('vaults')
  const [topSearch, setTopSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [operationMessage, setOperationMessage] = useState<string | null>(null)
  const [onePuxPreview, setOnePuxPreview] = useState<OnePuxPreview | null>(null)
  const [isImporting1pux, setIsImporting1pux] = useState(false)
  // The item whose permanent delete is being confirmed. There is no native confirm in this webview,
  // so the question is state the window has to render itself.
  const [purgeTarget, setPurgeTarget] = useState<LoginItemSummary | null>(null)
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
  const { securityPreferences, setSecurityPreferences, setLanguage } = useWindowAppearance()
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
  const topSearchInputRef = useRef<HTMLInputElement>(null)
  const {
    status,
    setStatus,
    mode,
    setMode,
    masterPassword,
    setMasterPassword,
    masterPasswordInputRef,
    isUnlocking,
    setIsUnlocking,
    biometricsAvailable,
    setBiometricsAvailable,
    lastActivityRef,
    handleUnlock,
    handleBiometricUnlock,
  } = useVaultSession({
    handleLock,
    loadArchivedItems,
    loadTrashedItems,
    loadVaults,
    securityPreferences,
    setError,
    setItems,
    setSelectedId,
  })

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

  // The list holds summaries; the selected row is read in full on demand (useItemDetail), and only that one.
  const selectedSummary = useMemo(
    () => items.find((item) => item.id === selectedId) ?? allItems?.find((item) => item.id === selectedId) ?? null,
    [allItems, items, selectedId],
  )
  const itemDetail = useItemDetail(selectedSummary, mode === 'unlocked')
  const selectedItem = itemDetail.item
  const detailLoading = itemDetail.loading

  // An item picked from All (or a tag, a category, Favorites) may live in another vault. The session follows it
  // there quietly, so editing, favouriting and moving keep acting on the vault the item is in, while the sidebar
  // keeps the row the user picked.
  const followingVaultRef = useRef<string | null>(null)
  useEffect(() => {
    if (mode !== 'unlocked' || isEditing || !selectedId) return
    const target = allItems?.find((item) => item.id === selectedId)?.vault_id
    if (!target || target === activeVaultId || followingVaultRef.current === target) return
    followingVaultRef.current = target
    // Only the session moves: the items are already here in `allItems`, so nothing is decrypted again
    // before the click shows. Archive and trash belong to the vault and refresh behind it.
    vaultApi
      .focusVault(target)
      .then(() => {
        setActiveVaultId(target)
        setItems(allItems?.filter((item) => item.vault_id === target) ?? [])
        loadArchivedItems().catch((nextError) => setError(String(nextError)))
        loadTrashedItems().catch((nextError) => setError(String(nextError)))
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
  // The summary answers while the detail is still on its way, so Delete and Move To never flash enabled.
  const selectedHasRelations = selectedItem
    ? hasRelations(selectedItem.relations)
    : Boolean(selectedSummary?.has_relations)
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
  // `null` while the selected row's detail is still being read: the form stays as it is until it arrives.
  const draftKey = selectedItem ? selectedItem.id : detailLoading ? null : `new:${newItemCategory}`
  const hasUnsavedChanges = isFormDirty(baselineRef.current, form)
  // Editing locks the rest of the window (owner 2026-10-18, first for unsaved edits, then for any open editor —
  // a new item included): until the form is saved or cancelled nothing else — sidebar, list, toolbar, settings,
  // shortcuts — may act, so no edit is ever left behind. The notice only appears once there is something to lose.
  const editLocked = isEditing

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
    if (draftKey === null) return
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
  const { fieldTotpPreviews, setFieldTotpPreviews, previewFieldTotp } = useTotpPreviews({
    form,
    isEditing,
    otpFieldIndexes,
    setError,
  })

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
      // The links were written after the item, so the item is read once more to carry them resolved.
      const full = await vaultApi.getItem(saved.id, saved.vault_id).catch(() => saved)
      const nextItems = await vaultApi.list()
      const fresh = toFormState(full)
      // A save retires the draft and moves the form off its `new:` key, so the switch effect
      // below does not file the just-saved values as unsaved edits on the old key.
      delete draftsRef.current[draftKeyRef.current]
      draftKeyRef.current = saved.id
      baselineRef.current = fresh
      setForm(fresh)
      if (relationError) setError(String(relationError))
      itemDetail.prime(full)
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
  const {
    commitTagDraft,
    removeLastTag,
    updateUrl,
    addWebsite,
    removeWebsite,
    updateCustomField,
    updateSectionChild,
    focusNewLabel,
    addSectionChild,
    removeSectionChild,
    fieldLists,
    editTopRuns,
    applyFieldMove,
    moveUrl,
    focusHandle,
    fieldDrag,
    reorderFor,
  } = useItemFormFields({
    detailCustomFields,
    detailFieldIndexes,
    form,
    inCredentialBlock,
    loginSectionFields,
    setForm,
    setSectionMenuIndex,
    setTagDraft,
    t,
    tagDraft,
  })

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

  async function handleSwitchVault(vaultId: string) {
    setError(null)
    try {
      const nextItems = await vaultApi.switchVault(vaultId)
      setActiveVaultId(vaultId)
      setItems(nextItems)
      setSelectedId(nextItems[0]?.id ?? null)
      setForm(toFormState(emptyLoginItem()))
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
  const listScrollToItemRef = useRef<((id: string) => void) | null>(null)
  const visibleItemIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems])
  const previousItemId = adjacentItemId(visibleItemIds, selectedId, -1)
  const nextItemId = adjacentItemId(visibleItemIds, selectedId, 1)
  function stepSelectedItem(step: -1 | 1): boolean {
    if (editLocked) return false
    const target = step === -1 ? previousItemId : nextItemId
    if (!target) return false
    closeFieldMenus()
    setSelectedId(target)
    // The list is virtualized: the target row may not exist yet, so the list scrolls to it by index.
    listScrollToItemRef.current?.(target)
    return true
  }

  function jumpToSearchResult(itemId: string) {
    setActiveNavigation('vaults')
    setSelectedId(itemId)
    setTopSearch('')
    setMobileDetailOpen(true)
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
  function itemSubtitle(item: LoginItemSummary) {
    const provider = summarySignInProvider(item)
    if (provider) return signInLabel(provider)
    return item.username || item.website || t(`itemTypes.${item.item_type}`)
  }
  const {
    handleRefreshIcon,
    handleIconMode,
    handleArchive,
    handleTrash,
    handleFavorite,
    handleMoveToVault,
    handleDuplicate,
    handleShare,
    copyPassword,
    copySecretText,
    copyFieldValue,
    openItemWebsite,
  } = useItemActions({
    baselineRef,
    closeFieldMenus,
    form,
    loadArchivedItems,
    loadTrashedItems,
    securityPreferences,
    selectedItem,
    setComposing,
    setError,
    setForm,
    setItems,
    setOperationMessage,
    setSelectedId,
    t,
  })

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
  // Stable for the memoised rows; the ref always calls this render's handlers.
  const itemRowHandlersRef = useRef({
    menu: (_event: ReactMouseEvent<HTMLButtonElement>, _item: LoginItemSummary) => {},
    select: (_id: string) => {},
  })
  itemRowHandlersRef.current = {
    menu: (event, item) => openItemRowMenu(event, item),
    select: (id) => {
      setSelectedId(id)
      setMobileDetailOpen(true)
    },
  }
  const handleItemRowSelect = useCallback((id: string) => itemRowHandlersRef.current.select(id), [])
  const handleItemRowContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, item: LoginItemSummary) => itemRowHandlersRef.current.menu(event, item),
    [],
  )

  function openItemRowMenu(event: ReactMouseEvent<HTMLButtonElement>, item: LoginItemSummary) {
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

  function handleUseGeneratedPassword(password: string) {
    setForm((current) => ({ ...current, password }))
    setShowPassword(true)
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

  // While an import runs nothing else may happen: the sheet covers the window, and every key (shortcuts,
  // Escape, Tab out of the sheet) is swallowed until it finishes.
  useEffect(() => {
    if (!isImporting1pux) return
    const swallow = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', swallow, true)
    return () => window.removeEventListener('keydown', swallow, true)
  }, [isImporting1pux])

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

  return {
    activeNavigation,
    activeTagKey,
    activeTagName,
    activeVaultId,
    addCustomField,
    addOtpField,
    addSectionChild,
    addWebsite,
    allItems,
    allScope,
    applyFieldMove,
    applyHighlights,
    applySignIn,
    archivedItems,
    archivedVaults,
    archivedVaultsCollapsed,
    askTagDelete,
    askVaultDissolve,
    attachDroppedFiles,
    baselineRef,
    beginColumnResize,
    beginEdit,
    beginItemListResize,
    beginSidebarResize,
    biometricsAvailable,
    buildDraftForm,
    canDissolveVault,
    categoriesCollapsed,
    categoryListRef,
    categoryMenu,
    categoryMenuAnchor,
    categoryToFocus,
    chooseAttachmentForField,
    chooseSort,
    clearSectionHighlights,
    closeCreateVault,
    closeFieldMenus,
    closeTagEditor,
    closeTextPreview,
    closeVaultEditor,
    commitTagDraft,
    composing,
    confirm1puxImport,
    copyFieldTotp,
    copyFieldValue,
    copyPassword,
    copySecretText,
    copyTotpSecret,
    copyTotpSetupLink,
    customFieldEntries,
    detailCustomFields,
    detailFieldIndexes,
    detailLoading,
    dissolveDestinationsFor,
    draftKey,
    draftKeyRef,
    draftRelationRefs,
    draftsRef,
    editBannerHue,
    editChildRefs,
    editLocked,
    editLockedRef,
    editParentRefs,
    editRelatedRefs,
    editTopRuns,
    error,
    features,
    fieldDrag,
    fieldLists,
    fieldTotpPreviews,
    focusedOtpField,
    focusHandle,
    focusNewLabel,
    followingVaultRef,
    form,
    formRef,
    generateFieldPassword,
    handleArchive,
    handleBiometricUnlock,
    handleCancelEdit,
    handleCreateVault,
    handleDuplicate,
    handleFavorite,
    handleIconMode,
    handleItemRowContextMenu,
    handleItemRowSelect,
    handleLock,
    handleMoveToVault,
    handleNewItem,
    handleOtpPaste,
    handleRefreshIcon,
    handleSave,
    handleShare,
    handleSwitchVault,
    handleTagDelete,
    handleTagSave,
    handleTrash,
    handleUnlock,
    handleUseGeneratedPassword,
    handleVaultArchive,
    handleVaultDissolve,
    handleVaultSave,
    hasSignInField,
    hasUnsavedChanges,
    headerArt,
    headerArtUrl,
    highlights,
    iconChoices,
    importOtpQrImage,
    inCredentialBlock,
    isCreatingVault,
    isDraggingFiles,
    isEditing,
    isImporting1pux,
    isMobileLayout,
    isUnlocking,
    itemDetail,
    itemListWidth,
    itemMenu,
    itemMenuAnchor,
    itemMenuPanelRef,
    itemMenuPlaced,
    itemMenuSource,
    itemMenuTriggerRef,
    itemRowHandlersRef,
    itemShortcutRef,
    itemSort,
    itemSubtitle,
    items,
    itemTypeFirstOptionRef,
    itemTypePanelPlaced,
    itemTypePanelRef,
    itemTypePickerOpen,
    itemTypeTriggerRef,
    jumpToSearchResult,
    lastActivityRef,
    layout,
    listScrollToItemRef,
    listTitle,
    loadArchivedItems,
    loadTrashedItems,
    loadVaults,
    lockedRegion,
    loginSectionFields,
    masterPassword,
    masterPasswordInputRef,
    measurePassword,
    mobileDetailOpen,
    mobileTab,
    mode,
    moveUrl,
    navigationCounts,
    newItemButtonRef,
    newItemCategory,
    nextItemId,
    onePuxPreview,
    openAttachment,
    openCategoryMenu,
    openCreateVault,
    openItemRowMenu,
    openItemTypePicker,
    openItemWebsite,
    openRelatedItem,
    openRelationPicker,
    openSectionHighlightMenu,
    openSettingsWindow,
    openSignInPicker,
    openTagEditor,
    openTagMenu,
    openTextPreview,
    openVaultEditor,
    openVaultMenu,
    openVaults,
    operationMessage,
    otherVaults,
    otpFieldIndexes,
    otpFileInputRef,
    otpFileTarget,
    otpInputRefs,
    passwordLabel,
    pickRelation,
    platform,
    previewFieldTotp,
    previousItemId,
    purgeTarget,
    purgeTrashedItem,
    refreshItems,
    refreshItemsRef,
    relationIcon,
    relationPicker,
    relationPickerItems,
    relationQuery,
    relationSearchRef,
    relationTypeLabel,
    removeCustomField,
    removeLastTag,
    removeRelation,
    removeSectionChild,
    removeWebsite,
    reorderFor,
    restoreArchivedItem,
    restoreStateItem,
    restoreTrashedItem,
    revealAllSecure,
    saving,
    scanOtpQr,
    scopeItems,
    sectionHighlightMenu,
    sectionHighlightMenuAnchor,
    sectionMenuIndex,
    securityPreferences,
    selectedHasRelations,
    selectedId,
    selectedItem,
    selectedSummary,
    setActiveNavigation,
    setActiveVaultId,
    setAllItems,
    setArchivedItems,
    setArchivedVaultsCollapsed,
    setBiometricsAvailable,
    setCategoriesCollapsed,
    setCategoryMenu,
    setCategoryMenuAnchor,
    setCategoryToFocus,
    setComposing,
    setError,
    setFieldTotpPreviews,
    setFocusedOtpField,
    setForm,
    setHighlights,
    setIsCreatingVault,
    setIsDraggingFiles,
    setIsEditing,
    setIsImporting1pux,
    setIsUnlocking,
    setItemListWidth,
    setItemMenu,
    setItemMenuAnchor,
    setItemMenuSource,
    setItemSort,
    setItems,
    setItemTypePickerOpen,
    setLanguage,
    setMasterPassword,
    setMobileDetailOpen,
    setMobileTab,
    setMode,
    setOnePuxPreview,
    setOperationMessage,
    setPurgeTarget,
    setRelationPicker,
    setRelationQuery,
    setRevealAllSecure,
    setSaving,
    setSectionHighlightMenu,
    setSectionHighlightMenuAnchor,
    setSectionMenuIndex,
    setSecurityPreferences,
    setSelectedId,
    setShowAddMore,
    setShowPassword,
    setSidebarWidth,
    setSignInPickerOpen,
    setSortMenuOpen,
    setStatus,
    setTagDeleteTarget,
    setTagDraft,
    setTagEditor,
    setTagMenu,
    setTagMenuAnchor,
    setTagRecords,
    setTagsCollapsed,
    setTextPreview,
    setTopSearch,
    setTrashedItems,
    setVaultDissolveInto,
    setVaultDissolveTarget,
    setVaultEditor,
    setVaultMenu,
    setVaultMenuAnchor,
    setVaultNameDraft,
    setVaults,
    setVaultsCollapsed,
    showAddMore,
    showCredentials,
    showPassword,
    showUsername,
    showWebsites,
    sidebarTags,
    sidebarWidth,
    signInLabel,
    signInPickerOpen,
    siteIconsEnabled,
    sortMenuOpen,
    start1puxImportRef,
    stateRows,
    status,
    stepSelectedItem,
    swallowWhileLocked,
    t,
    tagCounts,
    tagDeleteTarget,
    tagDraft,
    tagEditor,
    tagMenu,
    tagMenuAnchor,
    tagRecords,
    tagsCollapsed,
    template,
    textPreview,
    textPreviewRequest,
    toggleAddMoreMenu,
    toggleItemMenu,
    toggleRowHighlight,
    toggleSectionMenu,
    topSearch,
    topSearchInputRef,
    topSearchResults,
    topSettingsResults,
    trashedItems,
    updateCustomField,
    updateSectionChild,
    updateUrl,
    usernameLabel,
    vaultDissolveInto,
    vaultDissolveTarget,
    vaultEditor,
    vaultMenu,
    vaultMenuAnchor,
    vaultNameDraft,
    vaultNameInputRef,
    vaults,
    vaultsCollapsed,
    viewLoginFields,
    viewOtherFields,
    viewOtpIndexes,
    viewRelations,
    viewSections,
    viewWebsites,
    visibleCategories,
    visibleItemIds,
    visibleItems,
    visibleTags,
  }
}

export type VaultWindowModel = ReturnType<typeof useVaultWindow>
