/* Every call to the Mimatory app goes through the extension's service worker (background.js), which adds the
   pairing token and the page's real origin. */
async function bridge(path, body = {}) {
  const answer = await chrome.runtime.sendMessage({ body, path, type: 'MIMATORY_BRIDGE' })
  if (!answer) throw new Error('0')
  return answer
}

// Loaded in every frame (all_frames) so an embedded sign-in form is found; only the top frame shows the
// one-click float, the popup's Fill and Open & Fill.
const IS_TOP = window.top === window

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

/* The page's logins without anything secret (/match: id, title, username, sign_in_with, has_password, last use,
   cached icon), most recently used first. The password is asked for with `fetchItem` only once the user picked an
   item. */
async function fetchSummaries() {
  const answer = await bridge('/match')
  return { items: answer.ok && Array.isArray(answer.data) ? answer.data : [], status: answer.status }
}

// The one item the user picked, password included. /fill still applies the page's origin rules.
async function fetchItem(itemId) {
  return (await fetchPicked(itemId)).item
}

/* The same, with why it failed: `{ item, status }` — 423 locked, 503 app not running, 0 no answer within
   PICK_TIMEOUT_MS (the worker's own native timeout is longer). Never throws. */
const PICK_TIMEOUT_MS = 10000
async function fetchPicked(itemId) {
  let timer = 0
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(() => resolve({ data: null, ok: false, status: 0 }), PICK_TIMEOUT_MS)
  })
  const answer = await Promise.race([
    bridge('/fill', { item_id: itemId }).catch(() => ({ data: null, ok: false, status: 0 })),
    timeout,
  ])
  window.clearTimeout(timer)
  matchesCache = null
  const item = answer.ok && Array.isArray(answer.data) ? answer.data.find((match) => match.id === itemId) || null : null
  return { item, status: item ? 200 : answer.ok ? 404 : answer.status }
}

/* Asks the worker to have the native host running and connected to the app before the user picks — starting
   the host (the app's own binary) and the app's caller checks happen once per connection, not on the pick. */
let warmedAt = 0
function warmBridge() {
  if (Date.now() - warmedAt < 20000) return
  warmedAt = Date.now()
  chrome.runtime.sendMessage({ type: 'MIMATORY_WARM' }).catch(() => {})
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

async function fillFromMimatory(itemId) {
  // Open & Fill names its item; the popup's Fill takes the best match for the page.
  const item = itemId ? await fetchItem(itemId) : (await fetchMatches())[0]
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

// What Mimatory itself just filled: submitting it unchanged is not a new login to offer saving.
let lastFilled = null

async function saveToMimatory() {
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

// Any sign-in form, including one rendered after load, offers its new login to Mimatory on submit.
document.addEventListener(
  'submit',
  (event) => {
    if (event.target instanceof HTMLFormElement && event.target.querySelector('input[type="password"]')) {
      saveToMimatory()
    }
  },
  true,
)

/* Open & Fill from the Mimatory app: the app opens the item's website with `#mimatory-fill=<item id>` in the
   fragment (never sent to the server). The marker is removed from the address bar at once, then this one item
   is filled through the ordinary origin-scoped /fill — an id for another site's item simply finds no match.
   Sign-in forms that render late get a few seconds to appear. */
function pendingFillItemId() {
  const match = /^#mimatory-fill=([^&]+)$/.exec(location.hash)
  if (!match) return null
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

async function openAndFill(itemId, attemptsLeft = 10) {
  const result = await fillFromMimatory(itemId).catch(() => ({ kind: 'error' }))
  if (result.kind === 'noLoginForm' && attemptsLeft > 0) {
    window.setTimeout(() => openAndFill(itemId, attemptsLeft - 1), 500)
  }
}

const openAndFillItemId = IS_TOP ? pendingFillItemId() : null
if (openAndFillItemId) openAndFill(openAndFillItemId)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // The popup's Fill reaches every frame of the tab; the top one answers, as before frames had the script.
  if (message?.type === 'MIMATORY_FILL' && IS_TOP) {
    fillFromMimatory()
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
   Focusing or clicking a sign-in field on a site Mimatory has logins for opens a small menu under the field
   with those logins. Picking one fills — and, like 1Password's field menu, never submits (2026-10-24; submitting
   is the one-click float's job). The username is known from the summary and filled at once; the password field
   shows a spinner while the password crosses, and an inline note says why if it cannot (locked, no answer).
   On an identifier-first page the username is filled and the item stays pending for a minute: when the password
   step's field gets focus it is filled, still without submitting. A "Sign in with…" login only points at the
   provider's button, as before.
   The menu lives in a closed shadow root: the site's CSS cannot restyle it and its scripts cannot read it. */

const PENDING_KEY = 'mimatory-pending-step'
const PENDING_TTL_MS = 60 * 1000

/* `mode` 'submit' (the float's 登录: the password step is filled and submitted as soon as it shows) or 'fill'
   (the field menu: the password step is filled when its field gets focus, and never submitted). */
function rememberPendingStep(itemId, mode = 'submit') {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ at: Date.now(), itemId, mode }))
  } catch {}
}

function pendingStepMode() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null')?.mode || 'submit'
  } catch {
    return 'submit'
  }
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

/* The inline menu's tokens, shared by the one-click float so both read as one surface. */
const MENU_TOKENS = `
    --text: #000000d9; --text-subtle: #00000099; --surface: #f6f6f6; --border: #0000001a;
    --accent: #007aff; --hover: #0000000d; --selected: #007aff; --on-selected: #ffffff;
    --shadow: 0 8px 24px #00000026, 0 0 0 0.5px #0000001f;`
const MENU_TOKENS_DARK = `
      --text: #ffffffd9; --text-subtle: #ffffff8c; --surface: #323234; --border: #ffffff1a;
      --accent: #0a84ff; --hover: #ffffff14; --selected: #0a84ff;
      --shadow: 0 8px 24px #00000066, 0 0 0 0.5px #ffffff1a;`

const MENU_STYLE = `
  :host { all: initial; }
  .menu {${MENU_TOKENS}
    position: fixed; z-index: 2147483647; box-sizing: border-box; min-width: 240px; max-width: 360px;
    max-height: 280px; overflow: auto; margin: 0; padding: 4px; list-style: none;
    font: 13px/16px -apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", sans-serif;
    color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: var(--shadow); -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) {
    .menu {${MENU_TOKENS_DARK}
    }
  }
  .heading { padding: 4px 8px 6px; color: var(--text-subtle); font-size: 11px; line-height: 14px; font-weight: 600; }
  .option { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; align-items: center;
    padding: 6px 8px; border-radius: 6px; cursor: default; }
  .option:hover { background: var(--hover); }
  .option[aria-selected="true"] { background: var(--selected); color: var(--on-selected); }
  .option[aria-selected="true"] .sub { color: inherit; opacity: 0.85; }
  .badge { width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center;
    background: var(--accent); color: #ffffff; font-weight: 600; font-size: 12px; overflow: hidden; }
  .badge img { width: 100%; height: 100%; object-fit: contain; }
  .title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .sub { display: block; color: var(--text-subtle); font-size: 12px; line-height: 15px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

let menuHost = null
let menuState = null
let matchesCache = null

/* One /match per 30 seconds while the menu is used — summaries only; a failure (app locked, not paired) shows no
   menu. */
async function cachedMatches() {
  if (!matchesCache) {
    matchesCache = fetchSummaries()
      .then(({ items }) => items)
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

async function pickItem(item) {
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
  const login = findLoginForm()
  if (!login) return
  // Known already: the username goes in now, before the password is even asked for.
  suppressMenuUntil = Date.now() + 1500
  if (login.username && item.username) setFieldValue(login.username, item.username)
  if (!item.has_password) return
  if (!login.password) {
    // Identifier-first: the password step comes after the page's own Next, which the user presses.
    rememberPendingStep(item.id, 'fill')
    return
  }
  await fillPasswordField(login.password, item.id)
}

/* The password crosses only now, for the one login picked, with a spinner on its field meanwhile. A value the
   user typed in the meantime is left alone. */
async function fillPasswordField(field, itemId) {
  const before = field.value
  const busy = fieldSpinner(field)
  const { item, status } = await fetchPicked(itemId)
  busy.stop()
  if (!item) {
    fillToast(field, fillErrorText(status))
    return false
  }
  if (!field.isConnected || field.value !== before) return false
  suppressMenuUntil = Date.now() + 1500
  setFieldValue(field, item.password || '')
  const username = findLoginForm()?.username?.value || item.username || ''
  lastFilled = { password: item.password || '', username }
  return true
}

/* The menu's pending identifier-first step: focus on the password step's field fills it (no submit). */
function fillPendingPassword(field) {
  if (field.type !== 'password' || field.value) return false
  const itemId = pendingStepItemId()
  if (!itemId || pendingStepMode() !== 'fill') return false
  clearPendingStep()
  closeMenu()
  fillPasswordField(field, itemId)
  return true
}

function fillErrorText(status) {
  if (status === 423) return msg('fillErrorLocked')
  if (status === 503) return msg('statusAppNotRunning')
  if (status === 0) return msg('fillErrorTimeout')
  return msg('fillErrorFailed')
}

/* ── Fill feedback: a spinner at the trailing edge of the field being filled, and a short note under it when
   the fill failed. Closed shadow roots on zero-size fixed hosts, like the menu: the page cannot read, restyle or
   click them, and nothing reflows. */
const FEEDBACK_STYLE = `
  :host { all: initial; }
  .chip, .toast {${MENU_TOKENS}
    position: fixed; z-index: 2147483647; box-sizing: border-box;
    font: 12px/15px -apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", sans-serif;
    color: var(--text); -webkit-font-smoothing: antialiased; pointer-events: none;
  }
  @media (prefers-color-scheme: dark) {
    .chip, .toast {${MENU_TOKENS_DARK}
    }
  }
  .chip { width: 22px; height: 22px; border-radius: 11px; display: grid; place-items: center;
    background: var(--surface); box-shadow: 0 0 0 0.5px var(--border), 0 1px 3px #0000001f; }
  .spinner { width: 12px; height: 12px; border-radius: 50%; box-sizing: border-box;
    border: 2px solid var(--border); border-top-color: var(--accent); animation: spin 700ms linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: pulse 1.4s ease-in-out infinite alternate; border-color: var(--accent); }
    @keyframes pulse { from { opacity: 0.35; } }
  }
  .toast { display: flex; gap: 6px; align-items: center; max-width: 320px; padding: 6px 10px; border-radius: 8px;
    background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow);
    animation: toast-in 160ms cubic-bezier(0.25, 0.1, 0.25, 1); }
  .toast svg { flex: none; width: 14px; height: 14px; color: var(--danger); }
  .toast { --danger: #d70015; }
  @media (prefers-color-scheme: dark) { .toast { --danger: #ff6961; } }
  @keyframes toast-in { from { opacity: 0; translate: 0 -4px; } }
  @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
`

function feedbackHost(child) {
  const host = el('div', { 'data-mimatory-feedback': '' })
  const root = host.attachShadow({ mode: 'closed' })
  root.append(el('style', { text: FEEDBACK_STYLE }), child)
  document.documentElement.append(host)
  return host
}

// Follows the field while it scrolls; returns `stop()`.
function fieldSpinner(field) {
  const chip = el('div', { 'aria-label': msg('fillLoading'), class: 'chip', role: 'status' }, [
    el('span', { 'aria-hidden': 'true', class: 'spinner' }),
  ])
  const host = feedbackHost(chip)
  const place = () => {
    const rect = field.getBoundingClientRect()
    chip.style.left = `${Math.round(rect.right - 22 - Math.min(8, rect.width / 8))}px`
    chip.style.top = `${Math.round(rect.top + (rect.height - 22) / 2)}px`
  }
  place()
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  return {
    stop() {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      host.remove()
    },
  }
}

const ICON_ALERT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>'

let toastHost = null
// Under the field (or `rect`), for a few seconds.
function fillToast(anchor, text) {
  toastHost?.remove()
  const toast = el('div', { class: 'toast', role: 'alert' })
  toast.innerHTML = ICON_ALERT
  toast.append(el('span', { text }))
  const host = feedbackHost(toast)
  toastHost = host
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor
  toast.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - toast.offsetWidth - 8))}px`
  toast.style.top = `${Math.round(rect.bottom + 6)}px`
  window.setTimeout(() => {
    host.remove()
    if (toastHost === host) toastHost = null
  }, 4000)
}

async function openMenu(field) {
  if (menuState?.field === field || Date.now() < suppressMenuUntil) return
  const logins = (await cachedMatches()).filter((item) => item.sign_in_with || item.has_password || item.username)
  // A site waiting on passkey autofill (mediation "conditional") gets Mimatory's passkeys first.
  const passkeys = conditionalRequest
    ? conditionalRequest.choices.map((choice) => ({ ...choice, passkeyChoice: true }))
    : []
  const items = [...passkeys, ...logins]
  // The field may have lost focus while the bridge answered.
  if (!items.length || document.activeElement !== field) return
  closeMenu()

  const host = el('div', { 'data-mimatory-menu': '' })
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
      item.passkeyChoice ? passkeyBadge() : siteBadge(item, title),
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
    if (event.target === menuHost || event.target === floatHost) return
    if (isLoginField(event.target)) {
      // The user is signing in by hand: the float steps aside for the field menu. (Not when the focus is the
      // float's own sign-in filling the username: its spinner stays until the password is in.)
      if (!floatPicking) hideFloat()
      reportFrameLogin(false)
      warmBridge()
      if (fillPendingPassword(event.target)) return
      openMenu(event.target)
    } else closeMenu()
  },
  true,
)

document.addEventListener(
  'mousedown',
  (event) => {
    if (event.target === menuHost || event.target === floatHost) return
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
  // The field menu's pending step waits for the user to focus the password field (focusin below).
  if (pendingStepMode() !== 'submit') return
  const login = findLoginForm()
  if (!login?.password) return
  continuing = true
  try {
    const item = await fetchItem(itemId).catch(() => null)
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

// A sign-in field the page focused on load gets its menu too (or, on a pending password step, its password).
if (isLoginField(document.activeElement) && !fillPendingPassword(document.activeElement)) {
  openMenu(document.activeElement)
}

/* ── Passkeys (owner 2026-10-18: "完整passkey支持") ───────────────────────────────────────────────────────
   passkey-provider.js hands the page's navigator.credentials.create() / .get() here. Mimatory answers only
   after the user chose it in a prompt the page cannot read or click (closed shadow root, trusted events
   only); the bridge holds the private key and returns signatures. "Use another device", or a site Mimatory
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
  window.postMessage({ __mimatory: 'webauthn-response', id, ...answer }, location.origin)
}

const notAllowed = { message: 'The operation either timed out or was not allowed.', name: 'NotAllowedError' }
const openCards = new Map()
let conditionalRequest = null

/* The card every passkey prompt uses: top-right, Escape cancels. `onCancel` runs once, for Escape or a
   page abort; the caller's own buttons close it with `done`. */
function passkeyCard(id, { title, detail, onCancel }) {
  openCards.get(id)?.close()
  const host = el('div', { 'data-mimatory-prompt': '' })
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

async function mimatoryAvailable(request) {
  const answer = await bridge('/passkey/list', {
    allow_credentials: request.allow_credentials || [],
    rp_id: request.rp_id,
  }).catch(() => null)
  return answer?.ok ? answer.data || [] : null
}

async function handleCreate(id, request) {
  // Not paired, locked or not running: the browser's own passkey flow, as if Mimatory were absent.
  if ((await mimatoryAvailable({ rp_id: request.rp_id })) === null) {
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
    const input = el('input', { name: 'mimatory-target', type: 'radio', value })
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
  const choices = await mimatoryAvailable(request)
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
  // passkey-provider.js runs in the top frame only.
  if (!IS_TOP) return
  if (event.source !== window || event.origin !== location.origin) return
  const data = event.data
  if (data?.__mimatory === 'webauthn-abort') {
    openCards.get(data.id)?.close()
    if (conditionalRequest?.id === data.id) conditionalRequest = null
    return
  }
  if (data?.__mimatory !== 'webauthn-request' || typeof data.id !== 'string') return
  const request = { ...data.request }
  const run = data.kind === 'create' ? handleCreate : data.kind === 'get' ? handleGet : null
  if (!run) return
  run(data.id, request).catch(() => respondToPage(data.id, { fallback: true }))
})

/* ── One-click sign-in float (owner 2026-10-24, 1Password's "sign in" pill) ───────────────────────────────
   On a page with a visible sign-in form and at least one login for the site, a pill at the top centre of the
   viewport offers the most recently used login: 登录 fills it and presses the page's own Sign in (an
   identifier-first page continues on its password step), a "Sign in with…" login clicks the provider's button.
   A chevron lists the other logins below the pill. While the app is locked it offers 解锁密码库存, which brings
   the app's lock screen forward and waits for the unlock. × (or Escape) hides it for this tab and site; the
   ellipsis offers "never on this site"; the popup turns it off everywhere. Only summaries are fetched to show
   it (/match): a password crosses only for the login the user picked, with a trusted click, in a closed shadow
   root the page can neither read nor click. Sign-in forms inside iframes report to the top frame through the
   background worker, so a page shows one float. */

const FLOAT_DISMISSED_KEY = 'mimatory-float-dismissed'
const FLOAT_ENABLED_KEY = 'mimatoryFloatEnabled'
const FLOAT_NEVER_KEY = 'mimatoryFloatNever'
const FLOAT_SCAN_WINDOW_MS = 5000
const UNLOCK_POLL_MS = 2000
const UNLOCK_POLL_LIMIT_MS = 2 * 60 * 1000

const lucide = (paths) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const ICON_X = lucide('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')
const ICON_CHEVRON = lucide('<path d="m6 9 6 6 6-6"/>')
const ICON_ELLIPSIS = lucide(
  '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
)
const ICON_LOCK = lucide(
  '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
)
const ICON_EYE_OFF = lucide(
  '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
)

/* The site's icon from the app's encrypted cache when /match sent one, else the letter tile the menu always drew.
   A page whose CSP refuses data: images gets the letter too. */
function siteBadge(item, title) {
  const letter = (title || '').trim().charAt(0).toUpperCase() || '•'
  const badge = el('span', { 'aria-hidden': 'true', class: 'badge' })
  if (typeof item.icon === 'string' && item.icon.startsWith('data:image/')) {
    const image = el('img', { alt: '', src: item.icon })
    image.addEventListener('error', () => {
      badge.classList.remove('has-icon')
      badge.textContent = letter
    })
    badge.classList.add('has-icon')
    badge.append(image)
  } else {
    badge.textContent = letter
  }
  return badge
}

const FLOAT_STYLE = `
  :host { all: initial; }
  .float {${MENU_TOKENS}
    --pill-height: 52px;
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
    box-sizing: border-box; width: max-content; min-width: 300px; max-width: min(420px, calc(100vw - 24px));
    display: grid; padding: 6px; margin: 0;
    font: 13px/16px -apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", sans-serif;
    color: var(--text); background: var(--material); border: 1px solid var(--border);
    border-radius: calc(var(--pill-height) / 2); box-shadow: var(--shadow); -webkit-font-smoothing: antialiased;
    animation: mimatory-float-in 200ms cubic-bezier(0.25, 0.1, 0.25, 1); color-scheme: light;
    --material: color-mix(in srgb, var(--surface) 86%, transparent);
    --glow: color-mix(in srgb, var(--accent) 16%, transparent);
    --glow-2: color-mix(in srgb, #af52de 9%, transparent);
    --sheen: #ffffff8c;
    -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
    overflow: hidden; isolation: isolate;
  }
  /* The background (owner 2026-10-24: "背景最好有一点动画效果"): a macOS material — translucent, blurred and
     saturated behind — with a soft accent glow drifting across it on a 9s loop and one light sweep as it appears.
     Both live on pseudo-elements behind the content and move by transform/opacity only (composited, no layout);
     paused while the tab is hidden, gone under reduced motion (the material stays, still). */
  .float::before, .float::after { content: ""; position: absolute; z-index: -1; pointer-events: none; }
  .float::before { inset: -60% -30%;
    background: radial-gradient(closest-side at 35% 50%, var(--glow), transparent),
      radial-gradient(closest-side at 70% 55%, var(--glow-2), transparent);
    animation: mimatory-drift 9s ease-in-out infinite alternate; will-change: transform; }
  .float::after { inset: 0; width: 45%;
    background: linear-gradient(100deg, transparent, var(--sheen) 50%, transparent);
    opacity: 0; transform: translateX(-110%);
    animation: mimatory-sweep 1100ms cubic-bezier(0.4, 0, 0.2, 1) 180ms 1 both; }
  .float.is-paused::before, .float.is-paused::after { animation-play-state: paused; }
  @keyframes mimatory-drift {
    from { transform: translate3d(-14%, -4%, 0) scale(1); }
    to { transform: translate3d(14%, 5%, 0) scale(1.08); }
  }
  @keyframes mimatory-sweep {
    0% { opacity: 0; transform: translateX(-110%); }
    25% { opacity: 1; }
    100% { opacity: 0; transform: translateX(330%); }
  }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .float { --material: var(--surface); }
  }
  .float.is-open { border-radius: 18px; }
  @media (prefers-color-scheme: dark) {
    .float {${MENU_TOKENS_DARK}
      color-scheme: dark;
      --material: color-mix(in srgb, var(--surface) 86%, transparent);
      --glow: color-mix(in srgb, var(--accent) 20%, transparent);
      --glow-2: color-mix(in srgb, #bf5af2 10%, transparent);
      --sheen: #ffffff1f;
    }
  }
  @keyframes mimatory-float-in { from { opacity: 0; translate: 0 -8px; } }
  @media (prefers-reduced-motion: reduce) {
    .float { animation: none; }
    .float::before { animation: none; transform: none; }
    .float::after { display: none; }
  }
  .pill { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 10px; align-items: center;
    min-height: calc(var(--pill-height) - 14px); padding: 0 0 0 4px; }
  .badge { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; overflow: hidden;
    background: var(--accent); color: #ffffff; font-weight: 600; font-size: 14px; }
  .badge.has-icon { background: transparent; }
  .badge img { width: 100%; height: 100%; object-fit: contain; }
  .badge svg { width: 18px; height: 18px; }
  .text { display: grid; min-width: 0; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-subtle); font-size: 12px;
    line-height: 15px; }
  .tools { display: flex; align-items: center; gap: 2px; }
  button { font: inherit; color: inherit; margin: 0; border: 0; background: transparent; cursor: default;
    -webkit-tap-highlight-color: transparent; }
  button:hover { background: var(--hover); }
  button:disabled { opacity: 0.5; }
  button:disabled:hover { background: transparent; }
  .action.is-busy:disabled { opacity: 1; display: inline-flex; align-items: center; gap: 6px; }
  .spinner { width: 12px; height: 12px; border-radius: 50%; box-sizing: border-box; flex: none;
    border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent); border-top-color: var(--accent);
    animation: mimatory-spin 700ms linear infinite; }
  @keyframes mimatory-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: mimatory-pulse 1.4s ease-in-out infinite alternate; border-color: var(--accent); }
    @keyframes mimatory-pulse { from { opacity: 0.35; } }
  }
  button:focus-visible { outline: 3px solid var(--accent); outline-offset: 0; }
  .action { min-height: 32px; padding: 0 12px; border-radius: 16px; color: var(--accent); font-weight: 600;
    white-space: nowrap; }
  .icon-button { width: 28px; height: 28px; border-radius: 14px; display: grid; place-items: center;
    color: var(--text-subtle); padding: 0; }
  .icon-button.chevron svg { transition: transform 150ms cubic-bezier(0.25, 0.1, 0.25, 1); }
  .icon-button.chevron[aria-expanded="true"] svg { transform: rotate(180deg); }
  @media (prefers-reduced-motion: reduce) { .icon-button.chevron svg { transition: none; } }
  .panel { display: grid; gap: 2px; margin: 6px 0 0; padding: 6px 0 0; border-top: 1px solid var(--border);
    max-height: calc(5 * 40px + 4 * 2px + 6px); overflow: auto; scrollbar-width: thin; }
  .panel[hidden] { display: none; }
  .row { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 10px; align-items: center; min-height: 40px;
    padding: 4px 8px; border-radius: 10px; text-align: left; }
  .row .badge { width: 24px; height: 24px; border-radius: 6px; font-size: 12px; }
  .row .badge svg { width: 16px; height: 16px; }
  .row.option .badge { background: transparent; color: var(--text-subtle); }
`

let floatHost = null
let floatView = null
let floatScanTimer = 0
let floatScanUntil = 0
let floatPoll = null
let floatLastHref = location.href
// The float's sign-in is in flight (its spinner shows until the page is filled).
let floatPicking = false
// The page asked for this item by URL (Open & Fill): no float competes with it.
const floatSuppressed = Boolean(openAndFillItemId)
// Frames with a sign-in form, by frameId (top frame only).
const frameLogins = new Map()

function sessionList(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function floatDismissed(origin) {
  return sessionList(FLOAT_DISMISSED_KEY).includes(origin)
}

function dismissFloatFor(origin) {
  try {
    const list = sessionList(FLOAT_DISMISSED_KEY)
    if (!list.includes(origin)) sessionStorage.setItem(FLOAT_DISMISSED_KEY, JSON.stringify([...list, origin]))
  } catch {}
}

async function floatAllowed(origin) {
  const stored = await chrome.storage.local.get([FLOAT_ENABLED_KEY, FLOAT_NEVER_KEY]).catch(() => ({}))
  if (stored[FLOAT_ENABLED_KEY] === false) return false
  const never = Array.isArray(stored[FLOAT_NEVER_KEY]) ? stored[FLOAT_NEVER_KEY] : []
  return !never.includes(origin) && !floatDismissed(origin)
}

async function neverOnSite(origin) {
  const stored = await chrome.storage.local.get([FLOAT_NEVER_KEY]).catch(() => ({}))
  const never = Array.isArray(stored[FLOAT_NEVER_KEY]) ? stored[FLOAT_NEVER_KEY] : []
  if (!never.includes(origin)) await chrome.storage.local.set({ [FLOAT_NEVER_KEY]: [...never, origin] })
}

/* Whether the user is busy with the sign-in already: typing in one of its fields or using the field menu, or an
   identifier-first step Mimatory itself is in the middle of. */
function signInBusy() {
  return Boolean(menuState) || pendingStepItemId() !== null || isLoginField(document.activeElement)
}

function hideFloat() {
  stopUnlockPoll()
  floatHost?.remove()
  floatHost = null
  floatView = null
}

function stopUnlockPoll() {
  if (floatPoll) window.clearTimeout(floatPoll.timer)
  floatPoll = null
}

/* Where the float's login lives: this page, or a frame (asked through the background worker, which forwards to
   that frame's content script and adds nothing the frame could forge). */
function pageSource() {
  return {
    match: () => fetchSummaries(),
    origin: location.origin,
    pick: (item) => signInWith(item),
  }
}

function frameSource(frameId, origin) {
  const call = (body) => chrome.runtime.sendMessage({ ...body, frameId, type: 'MIMATORY_FRAME_CALL' })
  return {
    frameId,
    match: async () => (await call({ call: 'match' })) || { items: [], status: 0 },
    origin,
    pick: async (item) => (await call({ call: 'pick', itemId: item.id })) || { ok: false, status: 0 },
  }
}

/* Picking a login, wherever its form is: the username (known from the summary) goes in at once, the password is
   fetched for this one item, then filled and the page's own button pressed. A "Sign in with…" login clicks the
   provider's button — here the user pressed a button that says "使用 Google 登录", unlike the field menu, which
   only points at it. Answers `{ ok, status }` (status as `fetchPicked`), so the float can say why it failed. */
async function signInWith(item) {
  if (item.sign_in_with) {
    const button = findProviderButton(item.sign_in_with)
    if (!button) return { ok: false, status: 404 }
    highlightProviderButton(button)
    button.click()
    return { ok: true, status: 200 }
  }
  const login = findLoginForm()
  if (login?.username && item.username) {
    suppressMenuUntil = Date.now() + 1500
    setFieldValue(login.username, item.username)
  }
  const { item: full, status } = await fetchPicked(item.id)
  if (!full) return { ok: false, status }
  return { ok: fillLogin(full, { submit: true }), status: 200 }
}

function providerLabel(provider) {
  return PROVIDER_NAMES[provider]?.[0] || provider
}

function floatButton(className, label, html, onClick) {
  const button = trustedButton('', className, onClick)
  if (html) {
    button.innerHTML = html
    button.setAttribute('aria-label', label)
    button.title = label
  } else button.textContent = label
  return button
}

function floatShell(source) {
  hideFloat()
  const host = el('div', { 'data-mimatory-float': '' })
  const root = host.attachShadow({ mode: 'closed' })
  root.append(el('style', { text: FLOAT_STYLE }))
  const card = el('div', { 'aria-label': msg('floatLabel'), class: 'float', role: 'region' })
  card.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return
    if (event.key === 'Escape') {
      event.preventDefault()
      dismissFloat()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = [...card.querySelectorAll('.panel:not([hidden]) .row')]
    if (!rows.length) return
    event.preventDefault()
    const at = rows.indexOf(root.activeElement)
    const next = event.key === 'ArrowDown' ? at + 1 : at <= 0 ? rows.length - 1 : at - 1
    rows[next % rows.length].focus()
  })
  root.append(card)
  card.classList.toggle('is-paused', document.hidden)
  document.documentElement.append(host)
  floatHost = host
  floatView = { card, kind: 'accounts', root, source }
  return card
}

function pillRow(badge, title, sub, tools) {
  return el('div', { class: 'pill' }, [
    badge,
    el('div', { class: 'text' }, [
      el('span', { class: 'title', text: title, title }),
      el('span', { class: 'sub', text: sub, title: sub }),
    ]),
    el('div', { class: 'tools' }, tools),
  ])
}

function closeButton() {
  return floatButton('icon-button', msg('floatClose'), ICON_X, () => dismissFloat())
}

// × and Escape: not again in this tab for this site.
function dismissFloat() {
  if (floatView) dismissFloatFor(floatView.source.origin)
  hideFloat()
}

function itemSub(item) {
  return item.sign_in_with ? msg('signInWithProvider', [providerLabel(item.sign_in_with)]) : item.username || ''
}

function actionLabel(item) {
  return item.sign_in_with ? msg('signInWithProvider', [providerLabel(item.sign_in_with)]) : msg('floatSignIn')
}

/* Picked: the float is done on this site for this tab, whether or not the page lets the sign-in through. It stays
   up only while the password crosses — its button turns into a spinner with 正在登录… (the username is already in)
   — and leaves the moment the page is filled; a failure is said in a note under it instead of silence. */
async function pickFromFloat(source, item, button) {
  dismissFloatFor(source.origin)
  const view = floatView
  if (view && !item.sign_in_with) {
    view.card.classList.add('is-busy')
    for (const control of view.card.querySelectorAll('button')) control.disabled = true
    const target = button?.classList.contains('action') ? button : view.card.querySelector('.action')
    if (target) {
      target.disabled = true
      target.classList.add('is-busy')
      target.replaceChildren(el('span', { 'aria-hidden': 'true', class: 'spinner' }), msg('floatSigningIn'))
    }
  }
  const anchor = view?.card.getBoundingClientRect()
  floatPicking = true
  const result = await source.pick(item).catch(() => null)
  floatPicking = false
  if (floatView === view) hideFloat()
  if (!result?.ok && anchor && !item.sign_in_with) {
    fillToast({ bottom: anchor.bottom, left: anchor.left + 6 }, fillErrorText(result?.status ?? 0))
  }
}

function showAccounts(source, items) {
  const [first, ...others] = items
  const card = floatShell(source)
  const panel = el('div', { class: 'panel', hidden: '', role: 'group' })
  const tools = []
  const toggle = (kind) => {
    const open = panel.hidden || panel.dataset.kind !== kind
    // The pill keeps its width; a long title in the list truncates instead of widening the card.
    if (open && !card.style.width) card.style.width = `${card.getBoundingClientRect().width}px`
    panel.replaceChildren(...(open ? (kind === 'accounts' ? accountRows() : optionRows()) : []))
    panel.dataset.kind = kind
    panel.hidden = !open
    panel.setAttribute('aria-label', kind === 'accounts' ? msg('floatOtherAccounts') : msg('floatMore'))
    card.classList.toggle('is-open', open)
    chevron?.setAttribute('aria-expanded', String(open && kind === 'accounts'))
    more.setAttribute('aria-expanded', String(open && kind === 'options'))
    if (open) panel.querySelector('button')?.focus({ preventScroll: true })
  }
  const accountRows = () =>
    others.map((item) => {
      const title = item.title || location.hostname
      const row = floatButton('row', '', '', () => pickFromFloat(source, item, row))
      row.title = `${actionLabel(item)} · ${title}`
      row.append(
        siteBadge(item, title),
        el('span', { class: 'text' }, [
          el('span', { class: 'title', text: title }),
          el('span', { class: 'sub', text: itemSub(item) }),
        ]),
      )
      return row
    })
  const optionRows = () => {
    const row = floatButton('row option', '', '', async () => {
      hideFloat()
      await neverOnSite(source.origin)
    })
    const badge = el('span', { 'aria-hidden': 'true', class: 'badge' })
    badge.innerHTML = ICON_EYE_OFF
    row.append(badge, el('span', { class: 'text' }, [el('span', { class: 'title', text: msg('floatNever') })]))
    return [row]
  }
  const chevron = others.length
    ? floatButton('icon-button chevron', msg('floatOtherAccounts'), ICON_CHEVRON, () => toggle('accounts'))
    : null
  chevron?.setAttribute('aria-expanded', 'false')
  if (chevron) tools.push(chevron)
  tools.push(floatButton('action', actionLabel(first), '', (button) => pickFromFloat(source, first, button)))
  const more = floatButton('icon-button', msg('floatMore'), ICON_ELLIPSIS, () => toggle('options'))
  more.setAttribute('aria-expanded', 'false')
  tools.push(more, closeButton())
  const title = first.title || location.hostname
  card.append(pillRow(siteBadge(first, title), title, itemSub(first), tools), panel)
}

function showLocked(source) {
  const card = floatShell(source)
  floatView.kind = 'locked'
  const badge = el('span', { 'aria-hidden': 'true', class: 'badge' })
  badge.innerHTML = ICON_LOCK
  const sub = el('span', { class: 'sub', text: source.origin.replace(/^https?:\/\//, '') })
  const unlock = floatButton('action', msg('floatUnlock'), '', async (button) => {
    button.disabled = true
    const answer = await bridge('/unlock').catch(() => null)
    if (!answer?.ok) {
      hideFloat()
      return
    }
    sub.textContent = msg('floatWaitingUnlock')
    pollUntilUnlocked(source)
  })
  const row = el('div', { class: 'pill' }, [
    badge,
    el('div', { class: 'text' }, [el('span', { class: 'title', text: msg('floatLockedTitle') }), sub]),
    el('div', { class: 'tools' }, [unlock, closeButton()]),
  ])
  card.append(row)
}

/* After 解锁密码库存: ask again every two seconds for up to two minutes while this tab is visible, and turn into
   the accounts as soon as the app answers. */
function pollUntilUnlocked(source) {
  stopUnlockPoll()
  const view = floatView
  const until = Date.now() + UNLOCK_POLL_LIMIT_MS
  const tick = async () => {
    if (floatView !== view) return
    if (Date.now() > until) {
      stopUnlockPoll()
      return
    }
    if (document.visibilityState === 'visible') {
      const answer = await source.match().catch(() => null)
      if (floatView !== view) return
      if (answer?.status === 200) {
        stopUnlockPoll()
        const items = usable(answer.items)
        if (items.length && !signInBusy()) showAccounts(source, items)
        else hideFloat()
        return
      }
      if (answer && answer.status !== 423) {
        hideFloat()
        return
      }
    }
    floatPoll = { timer: window.setTimeout(tick, UNLOCK_POLL_MS) }
  }
  floatPoll = { timer: window.setTimeout(tick, UNLOCK_POLL_MS) }
}

// A login the float can act on: a provider button to press, or a password to fill.
function usable(items) {
  return (items || []).filter((item) => item.sign_in_with || item.has_password)
}

async function offerFloat(source) {
  if (!(await floatAllowed(source.origin))) return
  const answer = await source.match().catch(() => null)
  // Not paired (401 未授权), app not running (0) or any other failure: no float at all.
  if (!answer || signInBusy() || !(await floatAllowed(source.origin))) return
  if (answer.status === 423) {
    if (floatView?.kind !== 'locked' || floatView.source.origin !== source.origin) showLocked(source)
    return
  }
  if (answer.status !== 200) return
  const items = usable(answer.items)
  if (!items.length) {
    hideFloat()
    return
  }
  showAccounts(source, items)
}

/* Same site, roughly: a frame on the page's own host or a sibling under the same registrable name. Without the
   Public Suffix List here, a two-letter country code under a common second level (co.uk, com.cn…) needs three
   labels to match. A frame from another site never puts its logins in this page's float. */
function sameSite(frameOrigin) {
  let frame
  try {
    frame = new URL(frameOrigin)
  } catch {
    return false
  }
  if (frame.origin === location.origin) return true
  if (frame.protocol !== location.protocol) return false
  const tail = (host) => {
    const labels = host.split('.')
    const count =
      labels.length > 2 && /^(co|com|net|org|gov|edu|ac|ne|or)$/.test(labels.at(-2)) && labels.at(-1).length === 2
        ? 3
        : 2
    return labels.slice(-count).join('.')
  }
  if (/^[\d.]+$/.test(frame.hostname) || /^[\d.]+$/.test(location.hostname)) return false
  return tail(frame.hostname) === tail(location.hostname)
}

async function scanForFloat() {
  floatScanTimer = 0
  if (floatSuppressed) return
  const login = findLoginForm()
  if (login) warmBridge()
  if (!IS_TOP) {
    reportFrameLogin(Boolean(login) && !signInBusy())
    return
  }
  if (login) {
    if (signInBusy()) return
    if (floatView && floatView.source.frameId === undefined) return
    await offerFloat(pageSource())
    return
  }
  if (floatView && floatView.source.frameId === undefined) hideFloat()
  for (const [frameId, origin] of frameLogins) {
    if (floatView?.source.frameId === frameId) return
    await offerFloat(frameSource(frameId, origin))
    if (floatView) return
  }
}

function scheduleFloatScan(delay = 300) {
  if (floatScanTimer) window.clearTimeout(floatScanTimer)
  floatScanTimer = window.setTimeout(() => scanForFloat().catch(() => {}), delay)
}

// A load or a route change opens a short window in which late-rendered forms are looked for.
function openScanWindow() {
  floatScanUntil = Date.now() + FLOAT_SCAN_WINDOW_MS
  scheduleFloatScan()
}

let frameReported = null
function reportFrameLogin(present) {
  if (IS_TOP || frameReported === present) return
  frameReported = present
  chrome.runtime.sendMessage({ present, type: 'MIMATORY_FRAME_LOGIN' }).catch(() => {})
}

function checkRouteChange() {
  if (location.href === floatLastHref) return false
  floatLastHref = location.href
  // A new route is a new page for the float; a dismissal stays (it is per site).
  if (IS_TOP && floatView?.source.frameId === undefined) hideFloat()
  openScanWindow()
  return true
}

new MutationObserver(() => {
  if (checkRouteChange()) return
  if (Date.now() < floatScanUntil) scheduleFloatScan()
}).observe(document.documentElement, { childList: true, subtree: true })
// The float's background stops moving while nobody can see it.
document.addEventListener('visibilitychange', () => {
  floatView?.card.classList.toggle('is-paused', document.hidden)
})
window.addEventListener('popstate', checkRouteChange)
window.addEventListener('hashchange', checkRouteChange)

document.addEventListener(
  'keydown',
  (event) => {
    // Escape with nothing focused (or the float itself) closes the float; inside a page field it is the page's.
    if (!event.isTrusted || event.key !== 'Escape' || !floatView) return
    const active = document.activeElement
    if (active && active !== document.body && active !== document.documentElement && active !== floatHost) return
    dismissFloat()
  },
  true,
)

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !floatView) return
  if (changes[FLOAT_ENABLED_KEY]?.newValue === false) hideFloat()
  const never = changes[FLOAT_NEVER_KEY]?.newValue
  if (Array.isArray(never) && never.includes(floatView.source.origin)) hideFloat()
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (IS_TOP && message?.type === 'MIMATORY_FRAME_LOGIN' && Number.isInteger(message.frameId)) {
    if (message.present && sameSite(message.origin)) frameLogins.set(message.frameId, message.origin)
    else {
      frameLogins.delete(message.frameId)
      if (floatView?.source.frameId === message.frameId && !floatPicking) hideFloat()
    }
    if (message.present) scheduleFloatScan(0)
    return false
  }
  if (!IS_TOP && message?.type === 'MIMATORY_FRAME_CALL') {
    const work =
      message.call === 'match'
        ? fetchSummaries()
        : message.call === 'pick' && typeof message.itemId === 'string'
          ? cachedMatches().then((items) => {
              const item = items.find((match) => match.id === message.itemId)
              return item ? signInWith(item) : { ok: false, status: 404 }
            })
          : Promise.resolve(null)
    work.then(sendResponse, () => sendResponse(null))
    return true
  }
  return false
})

openScanWindow()
