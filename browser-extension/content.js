/* Every call to the Passless app goes through the extension's service worker (background.js), which adds the
   pairing token and the page's real origin. */
async function bridge(path, body = {}) {
  const answer = await chrome.runtime.sendMessage({ body, path, type: 'PASSLESS_BRIDGE' })
  if (!answer) throw new Error('0')
  return answer
}

const visible = (element) => Boolean(element) && element.getClientRects().length > 0 && !element.disabled

const USERNAME_SELECTOR = [
  'input[autocomplete~="username"]',
  'input[autocomplete~="webauthn"]',
  'input[autocomplete~="email"]',
  'input[type="email"]',
  'input[name*="user" i]',
  'input[name*="login" i]',
  'input[name*="email" i]',
  'input[id*="user" i]',
  'input[id*="email" i]',
  'input[id*="login" i]',
].join(', ')

/* The sign-in on screen: a visible password field with the username field before it, or — on an
   identifier-first page (Google, Microsoft, Apple…) — the username field on its own, whose "Next" brings the
   password step. */
function findLoginForm() {
  const password = [...document.querySelectorAll('input[type="password"]')].find(visible) || null
  const scope = password?.closest('form') || document
  const username =
    [...scope.querySelectorAll(USERNAME_SELECTOR)].find((input) => visible(input) && input.type !== 'password') ||
    (password ? [...scope.querySelectorAll('input[type="text"]')].find(visible) : null) ||
    null
  if (!password && !username) return null
  return { form: (password || username).closest('form') || document, password, username }
}

/* Frameworks (React, Vue, Angular) track an input's value through its own setter; writing through the native
   prototype setter and firing input + change is what makes them see a filled value as typed. */
function setFieldValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  input.focus({ preventScroll: true })
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const SUBMIT_WORDS =
  /^(sign\s*in|log\s*in|login|next|continue|submit|go|ok|下一步|继续|登录|登入|確認|确认|提交|次へ|ログイン|サインイン|続行)$/i

/* The page's own "Next" / "Sign in": the form's submit button, else a visible button whose words say so. */
function findSubmitButton(field) {
  const form = field?.closest('form')
  const label = (element) =>
    [element.getAttribute('aria-label'), element.value, element.textContent]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  if (form) {
    const submit = [...form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])')].find(
      visible,
    )
    if (submit) return submit
  }
  const scope = form || document
  return [...scope.querySelectorAll('button, [role="button"], input[type="button"]')]
    .filter(visible)
    .find((element) => SUBMIT_WORDS.test(label(element)))
}

function submitLogin(field) {
  const button = findSubmitButton(field)
  if (button) {
    button.click()
    return
  }
  const form = field?.closest('form')
  if (form?.requestSubmit) {
    form.requestSubmit()
    return
  }
  for (const type of ['keydown', 'keypress', 'keyup']) {
    field?.dispatchEvent(new KeyboardEvent(type, { bubbles: true, code: 'Enter', key: 'Enter', keyCode: 13 }))
  }
}

async function fetchMatches() {
  const answer = await bridge('/fill')
  return answer.ok && Array.isArray(answer.data) ? answer.data : []
}

/* The words a provider's button carries on most sites ("Sign in with Google", "Continue with Apple",
   "Log in with GitHub", or just the provider's name inside a social-login row). Known ids map to the
   names sites print; anything else is the name the user typed in the app. */
const PROVIDER_NAMES = {
  apple: ['Apple'],
  facebook: ['Facebook'],
  github: ['GitHub'],
  google: ['Google'],
  microsoft: ['Microsoft', 'Outlook'],
  x: ['X', 'Twitter'],
}

function providerNames(provider) {
  return PROVIDER_NAMES[provider] || [provider]
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* The visible button, link or role=button whose text or accessible name names the provider. A phrase
   ("… with Google") beats a bare name, so a "Google Play" footer link does not win over the real button. */
function findProviderButton(provider) {
  const names = providerNames(provider).map(escapeRegExp).join('|')
  const phrase = new RegExp(`\\b(with|via|using)\\s+(${names})\\b`, 'i')
  const bare = new RegExp(`^\\s*(${names})\\s*$`, 'i')
  const candidates = [
    ...document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'),
  ]
  const visible = candidates.filter((element) => element.getClientRects().length > 0)
  const label = (element) =>
    [element.getAttribute('aria-label'), element.getAttribute('title'), element.value, element.textContent]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
  return visible.find((element) => phrase.test(label(element))) || visible.find((element) => bare.test(label(element)))
}

/* Never clicked for the user: signing in through a provider can create an account or share profile
   data, so the page's own button is only brought into view, outlined and focused — Return finishes it. */
function highlightProviderButton(button) {
  button.scrollIntoView({ behavior: 'smooth', block: 'center' })
  button.style.outline = '3px solid #0a84ff'
  button.style.outlineOffset = '2px'
  button.focus({ preventScroll: true })
  window.setTimeout(() => {
    button.style.outline = ''
    button.style.outlineOffset = ''
  }, 6000)
}

async function fillFromPassless(itemId) {
  const items = await fetchMatches()
  // Open & Fill names its item; the popup's Fill takes the best match for the page.
  const item = itemId ? items.find((match) => match.id === itemId) : items[0]
  if (!item) return { kind: 'noMatch' }
  // A "Sign in with…" item has no password to fill; point at the provider's button instead.
  if (item.sign_in_with) {
    const button = findProviderButton(item.sign_in_with)
    if (button) highlightProviderButton(button)
    return { found: Boolean(button), kind: 'signInWith', provider: item.sign_in_with }
  }
  return fillLogin(item, { submit: false }) ? { kind: 'filled' } : { kind: 'noLoginForm' }
}

/* Fills what the page shows of the sign-in. With `submit`, it then presses the page's own Next / Sign in;
   on an identifier-first page that leaves the item pending for a minute, so the password step that follows
   (same page or the next one on this origin) is filled and submitted too. */
function fillLogin(item, { submit }) {
  const login = findLoginForm()
  if (!login) return false
  // Filling moves focus through the fields; that is not the user asking for the menu again.
  suppressMenuUntil = Date.now() + 1500
  if (login.username && item.username) setFieldValue(login.username, item.username)
  if (login.password) setFieldValue(login.password, item.password || '')
  lastFilled = { password: item.password || '', username: item.username || '' }
  if (!submit) return true
  if (login.password) clearPendingStep()
  else {
    rememberPendingStep(item.id)
    watchPendingStep()
  }
  window.setTimeout(() => submitLogin(login.password || login.username), 60)
  return true
}

let suppressMenuUntil = 0

// What Passless itself just filled: submitting it unchanged is not a new login to offer saving.
let lastFilled = null

async function saveToPassless() {
  const login = findLoginForm()
  if (!login?.password?.value) return
  if (
    lastFilled &&
    lastFilled.password === login.password.value &&
    lastFilled.username === (login.username?.value || '')
  ) {
    return
  }
  await bridge('/save', {
    password: login.password.value,
    title: document.title || location.hostname,
    username: login.username?.value || '',
    website: location.origin,
  }).catch(() => {})
}

// Any sign-in form, including one rendered after load, offers its new login to Passless on submit.
document.addEventListener(
  'submit',
  (event) => {
    if (event.target instanceof HTMLFormElement && event.target.querySelector('input[type="password"]')) {
      saveToPassless()
    }
  },
  true,
)

/* Open & Fill from the Passless app: the app opens the item's website with `#passless-fill=<item id>` in the
   fragment (never sent to the server). The marker is removed from the address bar at once, then this one item
   is filled through the ordinary origin-scoped /fill — an id for another site's item simply finds no match.
   Sign-in forms that render late get a few seconds to appear. */
function pendingFillItemId() {
  const match = /^#passless-fill=([^&]+)$/.exec(location.hash)
  if (!match) return null
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

async function openAndFill(itemId, attemptsLeft = 10) {
  const result = await fillFromPassless(itemId).catch(() => ({ kind: 'error' }))
  if (result.kind === 'noLoginForm' && attemptsLeft > 0) {
    window.setTimeout(() => openAndFill(itemId, attemptsLeft - 1), 500)
  }
}

const openAndFillItemId = pendingFillItemId()
if (openAndFillItemId) openAndFill(openAndFillItemId)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PASSLESS_FILL') {
    fillFromPassless()
      .then(sendResponse)
      .catch(() => sendResponse({ kind: 'error' }))
    // Keeps the channel open for the asynchronous answer.
    return true
  }
  return false
})

const msg = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key

/* The popup's tokens (popup.tailwind.css), value for value: a page cannot load the extension's stylesheet into
   a closed shadow root without web_accessible_resources, so the prompt carries its own copy. */
const PROMPT_STYLE = `
  :host { all: initial; }
  .card {
    --text: #000000d9; --text-subtle: #00000099; --surface: #f6f6f6; --border: #0000001a;
    --control: #ffffff; --control-pressed: #f0f0f0; --brand: #0063e1; --brand-hovered: #0058cc;
    --accent: #007aff; --hover: #0000000d; --danger: #d70015;
    --shadow-control: 0 0 0 0.5px #0000001f, 0 1px 1px #0000001a;
    position: fixed; top: 12px; right: 12px; z-index: 2147483647; box-sizing: border-box;
    width: 320px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); overflow: auto;
    display: grid; gap: 10px; padding: 14px;
    font: 13px/16px -apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", sans-serif;
    color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    box-shadow: 0 8px 24px #00000026, 0 0 0 0.5px #0000001f; -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) {
    .card {
      --text: #ffffffd9; --text-subtle: #ffffff8c; --surface: #323234; --border: #ffffff1a;
      --control: #ffffff26; --control-pressed: #ffffff38; --brand: #0059d1; --brand-hovered: #0a64de;
      --accent: #0a84ff; --hover: #ffffff14; --danger: #ff6961;
      --shadow-control: 0 0 0 0.5px #ffffff1a, 0 1px 1px #00000040;
      box-shadow: 0 8px 24px #00000066, 0 0 0 0.5px #ffffff1a;
    }
  }
  .head { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 10px; align-items: center; }
  .mark { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center;
    background: var(--accent); color: #ffffff; }
  h2 { margin: 0; font-size: 13px; font-weight: 600; line-height: 16px; }
  .detail { margin: 2px 0 0; color: var(--text-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .choices { display: grid; gap: 2px; margin: 0; padding: 0; border: 0; }
  label { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; align-items: center;
    padding: 6px 8px; border-radius: 6px; cursor: default; }
  label:hover { background: var(--hover); }
  input { margin: 0; accent-color: var(--accent); }
  .choice-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .choice-sub { display: block; color: var(--text-subtle); font-size: 12px; line-height: 15px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .note { margin: 0; color: var(--text-subtle); font-size: 12px; line-height: 15px; }
  .note.is-error { color: var(--danger); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  button { font: inherit; min-height: 28px; padding: 0 12px; border-radius: 6px; border: 0; color: var(--text);
    background: var(--control); box-shadow: var(--shadow-control); }
  button:active { background: var(--control-pressed); }
  button.primary { color: #ffffff; background: var(--brand); }
  button.primary:hover { background: var(--brand-hovered); }
  button:focus-visible, input:focus-visible { outline: 3px solid var(--accent); outline-offset: 0; }
`

function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'text') node.textContent = value
    else node.setAttribute(key, value)
  }
  for (const child of children) node.append(child)
  return node
}

/* ── Inline fill menu (owner, 2026-10-18: "like 1Password") ──────────────────────────────────────────────
   Focusing or clicking a sign-in field on a site Passless has logins for opens a small menu under the field
   with those logins. Picking one fills the username and password and presses the page's own Next / Sign in.
   On an identifier-first page the item stays pending for a minute, so the password step that follows is
   filled and submitted as well. A "Sign in with…" login only points at the provider's button, as before.
   The menu lives in a closed shadow root: the site's CSS cannot restyle it and its scripts cannot read it. */

const PENDING_KEY = 'passless-pending-step'
const PENDING_TTL_MS = 60 * 1000

function rememberPendingStep(itemId) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ at: Date.now(), itemId }))
  } catch {}
}

function clearPendingStep() {
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {}
}

function pendingStepItemId() {
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null')
    if (pending && Date.now() - pending.at < PENDING_TTL_MS) return pending.itemId
  } catch {}
  clearPendingStep()
  return null
}

const MENU_STYLE = `
  :host { all: initial; }
  .menu {
    --text: #000000d9; --text-subtle: #00000099; --surface: #f6f6f6; --border: #0000001a;
    --accent: #007aff; --hover: #0000000d; --selected: #007aff; --on-selected: #ffffff;
    position: fixed; z-index: 2147483647; box-sizing: border-box; min-width: 240px; max-width: 360px;
    max-height: 280px; overflow: auto; margin: 0; padding: 4px; list-style: none;
    font: 13px/16px -apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", sans-serif;
    color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 8px 24px #00000026, 0 0 0 0.5px #0000001f; -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) {
    .menu {
      --text: #ffffffd9; --text-subtle: #ffffff8c; --surface: #323234; --border: #ffffff1a;
      --accent: #0a84ff; --hover: #ffffff14; --selected: #0a84ff;
      box-shadow: 0 8px 24px #00000066, 0 0 0 0.5px #ffffff1a;
    }
  }
  .heading { padding: 4px 8px 6px; color: var(--text-subtle); font-size: 11px; line-height: 14px; font-weight: 600; }
  .option { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; align-items: center;
    padding: 6px 8px; border-radius: 6px; cursor: default; }
  .option:hover { background: var(--hover); }
  .option[aria-selected="true"] { background: var(--selected); color: var(--on-selected); }
  .option[aria-selected="true"] .sub { color: inherit; opacity: 0.85; }
  .badge { width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center;
    background: var(--accent); color: #ffffff; font-weight: 600; font-size: 12px; }
  .title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .sub { display: block; color: var(--text-subtle); font-size: 12px; line-height: 15px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

let menuHost = null
let menuState = null
let matchesCache = null

/* One /fill per page view while the menu is used; a failure (app locked, not paired) shows no menu. */
async function cachedMatches() {
  if (!matchesCache) {
    matchesCache = fetchMatches()
      .then((items) => (Array.isArray(items) ? items : []))
      .catch(() => [])
    window.setTimeout(() => {
      matchesCache = null
    }, 30 * 1000)
  }
  return matchesCache
}

function isLoginField(target) {
  if (!(target instanceof HTMLInputElement) || !visible(target)) return false
  if (target.type === 'password') return true
  const login = findLoginForm()
  return Boolean(login && login.username === target)
}

function closeMenu() {
  menuHost?.remove()
  menuHost = null
  menuState = null
}

function placeMenu() {
  if (!menuState) return
  const rect = menuState.field.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    closeMenu()
    return
  }
  const { menu } = menuState
  const below = window.innerHeight - rect.bottom
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`
  menu.style.minWidth = `${Math.max(240, Math.min(rect.width, 360))}px`
  if (below < menu.offsetHeight + 12 && rect.top > below) {
    menu.style.top = `${Math.max(8, rect.top - menu.offsetHeight - 4)}px`
  } else {
    menu.style.top = `${rect.bottom + 4}px`
  }
}

function selectOption(index) {
  if (!menuState) return
  const options = [...menuState.menu.querySelectorAll('.option')]
  menuState.selected = (index + options.length) % options.length
  options.forEach((option, i) => {
    option.setAttribute('aria-selected', String(i === menuState.selected))
  })
  options[menuState.selected]?.scrollIntoView({ block: 'nearest' })
}

function pickItem(item) {
  closeMenu()
  if (item.passkeyChoice) {
    answerConditional(item)
    return
  }
  if (item.sign_in_with) {
    const button = findProviderButton(item.sign_in_with)
    if (button) highlightProviderButton(button)
    return
  }
  fillLogin(item, { submit: true })
}

async function openMenu(field) {
  if (menuState?.field === field || Date.now() < suppressMenuUntil) return
  const logins = (await cachedMatches()).filter((item) => item.sign_in_with || item.password || item.username)
  // A site waiting on passkey autofill (mediation "conditional") gets Passless's passkeys first.
  const passkeys = conditionalRequest
    ? conditionalRequest.choices.map((choice) => ({ ...choice, passkeyChoice: true }))
    : []
  const items = [...passkeys, ...logins]
  // The field may have lost focus while the bridge answered.
  if (!items.length || document.activeElement !== field) return
  closeMenu()

  const host = el('div', { 'data-passless-menu': '' })
  const root = host.attachShadow({ mode: 'closed' })
  root.append(el('style', { text: MENU_STYLE }))
  const menu = el('ul', { 'aria-label': msg('inlineMenuLabel'), class: 'menu', role: 'listbox' })
  menu.append(el('li', { 'aria-hidden': 'true', class: 'heading', role: 'presentation', text: msg('inlineMenuLabel') }))
  for (const item of items) {
    const title = item.title || location.hostname
    const sub = item.passkeyChoice
      ? `${msg('passkeyMenuSub')} · ${item.user_name || ''}`
      : item.sign_in_with
        ? msg('signInWithProvider', [PROVIDER_NAMES[item.sign_in_with]?.[0] || item.sign_in_with])
        : item.username || ''
    const option = el('li', { 'aria-selected': 'false', class: 'option', role: 'option' }, [
      item.passkeyChoice
        ? passkeyBadge()
        : el('span', { 'aria-hidden': 'true', class: 'badge', text: title.trim().charAt(0).toUpperCase() || '•' }),
      el('span', {}, [el('span', { class: 'title', text: title }), el('span', { class: 'sub', text: sub })]),
    ])
    // mousedown, not click: the field keeps focus, so the page never sees a blur between focus and fill.
    option.addEventListener('mousedown', (event) => {
      event.preventDefault()
      if (!event.isTrusted) return
      pickItem(item)
    })
    menu.append(option)
  }
  root.append(menu)
  document.documentElement.append(host)
  menuHost = host
  menuState = { field, items, menu, selected: -1 }
  placeMenu()
}

document.addEventListener(
  'focusin',
  (event) => {
    if (event.target === menuHost) return
    if (isLoginField(event.target)) openMenu(event.target)
    else closeMenu()
  },
  true,
)

document.addEventListener(
  'mousedown',
  (event) => {
    if (event.target === menuHost) return
    if (isLoginField(event.target)) {
      // Clicking a field that already has focus reopens a menu Escape closed.
      if (!menuState) openMenu(event.target)
      return
    }
    closeMenu()
  },
  true,
)

// Arrow keys move through the logins, Return fills the highlighted one, Escape closes; typing closes it too.
document.addEventListener(
  'keydown',
  (event) => {
    if (!event.isTrusted || !menuState || event.target !== menuState.field) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      selectOption(menuState.selected + (event.key === 'ArrowDown' ? 1 : -1))
    } else if (event.key === 'Enter' && menuState.selected >= 0) {
      event.preventDefault()
      event.stopPropagation()
      pickItem(menuState.items[menuState.selected])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
    } else if (event.key.length === 1) {
      closeMenu()
    }
  },
  true,
)

window.addEventListener('scroll', placeMenu, true)
window.addEventListener('resize', placeMenu)

/* The password step of an identifier-first sign-in: when the item picked on the username step is still
   pending and a password field shows up (in place, or after the page moved on within this origin), it is
   filled and submitted. Watching stops once the step is done or the minute runs out. */
let continuing = false
let pendingObserver = null

async function continuePendingStep() {
  if (continuing) return
  const itemId = pendingStepItemId()
  if (!itemId) {
    pendingObserver?.disconnect()
    return
  }
  const login = findLoginForm()
  if (!login?.password) return
  continuing = true
  try {
    const item = (await cachedMatches()).find((match) => match.id === itemId)
    clearPendingStep()
    pendingObserver?.disconnect()
    if (item) fillLogin(item, { submit: true })
  } finally {
    continuing = false
  }
}

function watchPendingStep() {
  pendingObserver?.disconnect()
  pendingObserver = new MutationObserver(() => continuePendingStep())
  pendingObserver.observe(document.documentElement, { attributes: true, childList: true, subtree: true })
  const observer = pendingObserver
  window.setTimeout(() => observer.disconnect(), PENDING_TTL_MS)
}

if (pendingStepItemId()) {
  watchPendingStep()
  continuePendingStep()
}

// A sign-in field the page focused on load gets its menu too.
if (isLoginField(document.activeElement)) openMenu(document.activeElement)

/* ── Passkeys (owner 2026-10-18: "完整passkey支持") ───────────────────────────────────────────────────────
   passkey-provider.js hands the page's navigator.credentials.create() / .get() here. Passless answers only
   after the user chose it in a prompt the page cannot read or click (closed shadow root, trusted events
   only); the bridge holds the private key and returns signatures. "Use another device", or a site Passless
   has nothing for, sends the call on to the browser's own WebAuthn untouched. */

const KEY_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m10.85 12.15 8.65-8.65"/><path d="m18 5 2 2"/><path d="m15 8 2 2"/></svg>'

function passkeyBadge() {
  const badge = el('span', { 'aria-hidden': 'true', class: 'badge' })
  badge.innerHTML = KEY_ICON
  return badge
}

const CARD_EXTRA_STYLE = `
  .accounts { display: grid; gap: 2px; }
  .account { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; align-items: center;
    min-height: 40px; padding: 6px 8px; text-align: left; background: transparent; box-shadow: none; }
  .account:hover { background: var(--hover); }
  .badge { width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center;
    background: var(--accent); color: #ffffff; }
  .actions.spread { justify-content: space-between; }
`

function respondToPage(id, answer) {
  window.postMessage({ __passless: 'webauthn-response', id, ...answer }, location.origin)
}

const notAllowed = { message: 'The operation either timed out or was not allowed.', name: 'NotAllowedError' }
const openCards = new Map()
let conditionalRequest = null

/* The card every passkey prompt uses: top-right, Escape cancels. `onCancel` runs once, for Escape or a
   page abort; the caller's own buttons close it with `done`. */
function passkeyCard(id, { title, detail, onCancel }) {
  openCards.get(id)?.close()
  const host = el('div', { 'data-passless-prompt': '' })
  const root = host.attachShadow({ mode: 'closed' })
  root.append(el('style', { text: PROMPT_STYLE + CARD_EXTRA_STYLE }))
  const card = el('div', { 'aria-label': title, class: 'card', role: 'dialog' })
  const mark = el('div', { 'aria-hidden': 'true', class: 'mark' })
  mark.innerHTML = KEY_ICON
  card.append(
    el('div', { class: 'head' }, [
      mark,
      el('div', {}, [el('h2', { text: title }), el('p', { class: 'detail', text: detail, title: detail })]),
    ]),
  )
  let closed = false
  const done = () => {
    if (closed) return
    closed = true
    host.remove()
    openCards.delete(id)
  }
  const cancel = () => {
    if (closed) return
    done()
    onCancel?.()
  }
  card.addEventListener('keydown', (event) => {
    if (event.isTrusted && event.key === 'Escape') cancel()
  })
  root.append(card)
  document.documentElement.append(host)
  openCards.set(id, { cancel, close: done })
  return { card, done }
}

// Buttons that only answer real clicks: a page can dispatch events, but not trusted ones.
function trustedButton(text, className, onClick) {
  const button = el('button', className ? { class: className, text, type: 'button' } : { text, type: 'button' })
  button.addEventListener('click', (event) => {
    if (event.isTrusted) onClick(button)
  })
  return button
}

function bridgeFailure(answer) {
  if (answer?.status === 409)
    return { message: 'The authenticator already holds a passkey for this account.', name: 'InvalidStateError' }
  if (answer?.status === 400)
    return { message: answer.data?.error || 'This page cannot use that passkey.', name: 'SecurityError' }
  return null
}

async function passlessAvailable(request) {
  const answer = await bridge('/passkey/list', {
    allow_credentials: request.allow_credentials || [],
    rp_id: request.rp_id,
  }).catch(() => null)
  return answer?.ok ? answer.data || [] : null
}

async function handleCreate(id, request) {
  // Not paired, locked or not running: the browser's own passkey flow, as if Passless were absent.
  if ((await passlessAvailable({ rp_id: request.rp_id })) === null) {
    respondToPage(id, { fallback: true })
    return
  }
  const logins = (await cachedMatches()).filter((item) => !item.sign_in_with)
  const account = request.user_name || request.user_display_name || msg('passkeyUnknownAccount')
  const { card, done } = passkeyCard(id, {
    detail: msg('passkeySaveDetail', [account, request.rp_id]),
    onCancel: () => respondToPage(id, { error: notAllowed }),
    title: msg('passkeySaveTitle'),
  })
  const choices = el('fieldset', { class: 'choices' })
  const option = (value, title, sub, checked) => {
    const input = el('input', { name: 'passless-target', type: 'radio', value })
    input.checked = checked
    const text = el('span', {}, [el('span', { class: 'choice-title', text: title })])
    if (sub) text.append(el('span', { class: 'choice-sub', text: sub }))
    choices.append(el('label', {}, [input, text]))
  }
  const preferred = logins.findIndex((item) => item.username && item.username === request.user_name)
  logins.forEach((item, index) => {
    option(
      `item:${item.id}`,
      msg('passkeyAddToItem', [item.title || request.rp_id]),
      item.username || '',
      index === Math.max(preferred, 0),
    )
  })
  option('new', msg('passkeyNewItem'), logins.length ? '' : request.rp_id, logins.length === 0)
  card.append(choices)
  const note = el('p', { class: 'note', text: msg('passkeyNote') })
  card.append(note)

  const other = trustedButton(msg('passkeyUseOther'), '', () => {
    done()
    respondToPage(id, { fallback: true })
  })
  const save = trustedButton(msg('passkeySave'), 'primary', async (button) => {
    const picked = choices.querySelector('input:checked')?.value || 'new'
    button.disabled = true
    const answer = await bridge('/passkey/create', {
      ...request,
      item_id: picked.startsWith('item:') ? picked.slice(5) : null,
      new_item: picked === 'new',
    }).catch(() => null)
    if (answer?.ok) {
      done()
      matchesCache = null
      respondToPage(id, { result: answer.data })
      return
    }
    const failure = bridgeFailure(answer)
    if (failure) {
      done()
      respondToPage(id, { error: failure })
      return
    }
    button.disabled = false
    note.classList.add('is-error')
    note.textContent = msg('passkeySaveFailed')
  })
  card.append(el('div', { class: 'actions spread' }, [other, save]))
  save.focus({ preventScroll: true })
}

async function signIn(id, request, choice) {
  const answer = await bridge('/passkey/get', {
    challenge: request.challenge,
    credential_id: choice.credential_id,
    rp_id: request.rp_id,
  }).catch(() => null)
  if (answer?.ok) respondToPage(id, { result: answer.data })
  else respondToPage(id, { error: bridgeFailure(answer) || notAllowed })
}

function answerConditional(choice) {
  const waiting = conditionalRequest
  conditionalRequest = null
  if (waiting) signIn(waiting.id, waiting.request, choice)
}

async function handleGet(id, request) {
  const choices = await passlessAvailable(request)
  if (!choices?.length) {
    respondToPage(id, { fallback: true })
    return
  }
  // Passkey autofill: the site waits until an account is picked from the sign-in field's menu.
  if (request.conditional) {
    conditionalRequest = { choices, id, request }
    if (isLoginField(document.activeElement)) {
      closeMenu()
      openMenu(document.activeElement)
    }
    return
  }
  const { card, done } = passkeyCard(id, {
    detail: request.rp_id,
    onCancel: () => respondToPage(id, { error: notAllowed }),
    title: msg('passkeySignInTitle'),
  })
  const list = el('div', { class: 'accounts' })
  for (const choice of choices) {
    const row = trustedButton('', 'account', () => {
      done()
      signIn(id, request, choice)
    })
    row.append(
      passkeyBadge(),
      el('span', {}, [
        el('span', { class: 'choice-title', text: choice.user_name || choice.title }),
        el('span', { class: 'choice-sub', text: choice.title }),
      ]),
    )
    list.append(row)
  }
  card.append(list)
  const other = trustedButton(msg('passkeyUseOther'), '', () => {
    done()
    respondToPage(id, { fallback: true })
  })
  const cancel = trustedButton(msg('passkeyCancel'), '', () => {
    done()
    respondToPage(id, { error: notAllowed })
  })
  card.append(el('div', { class: 'actions spread' }, [other, cancel]))
  list.querySelector('button')?.focus({ preventScroll: true })
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return
  const data = event.data
  if (data?.__passless === 'webauthn-abort') {
    openCards.get(data.id)?.close()
    if (conditionalRequest?.id === data.id) conditionalRequest = null
    return
  }
  if (data?.__passless !== 'webauthn-request' || typeof data.id !== 'string') return
  const request = { ...data.request }
  const run = data.kind === 'create' ? handleCreate : data.kind === 'get' ? handleGet : null
  if (!run) return
  run(data.id, request).catch(() => respondToPage(data.id, { fallback: true }))
})
