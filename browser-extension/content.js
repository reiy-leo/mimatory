const PASSLESS_BRIDGE = 'http://127.0.0.1:17891'

function findLoginForm() {
  const password = document.querySelector('input[type="password"]')
  if (!password) return null
  const form = password.closest('form') || document
  const username =
    form.querySelector('input[autocomplete="username"]') ||
    form.querySelector('input[type="email"]') ||
    form.querySelector('input[name*="user" i]') ||
    form.querySelector('input[type="text"]')
  return { form, password, username }
}

async function fetchMatches() {
  const { passlessToken } = await chrome.storage.local.get(['passlessToken'])
  const response = await fetch(`${PASSLESS_BRIDGE}/fill`, {
    // The full origin, so "only fill on this exact host" can compare the port too (bridge: site_match.rs).
    body: JSON.stringify({ origin: location.origin }),
    headers: { 'Content-Type': 'application/json', 'X-Passless-Token': passlessToken || '' },
    method: 'POST',
  })
  if (!response.ok) return []
  return response.json()
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
  const login = findLoginForm()
  if (!login) return { kind: 'noLoginForm' }
  if (login.username) {
    login.username.value = item.username
    login.username.dispatchEvent(new Event('input', { bubbles: true }))
  }
  login.password.value = item.password
  login.password.dispatchEvent(new Event('input', { bubbles: true }))
  return { kind: 'filled' }
}

async function saveToPassless() {
  const login = findLoginForm()
  if (!login || !login.password.value) return
  const { passlessToken } = await chrome.storage.local.get(['passlessToken'])
  await fetch(`${PASSLESS_BRIDGE}/save`, {
    body: JSON.stringify({
      password: login.password.value,
      title: document.title || location.hostname,
      username: login.username?.value || '',
      website: location.origin,
    }),
    headers: { 'Content-Type': 'application/json', 'X-Passless-Token': passlessToken || '' },
    method: 'POST',
  }).catch(() => {})
}

const login = findLoginForm()
if (login?.form && login.form.addEventListener) {
  login.form.addEventListener('submit', () => {
    saveToPassless()
  })
}

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

/* ── Saving a passkey (owner, 2026-10-18) ─────────────────────────────────────────────────────────────────
   A passkey is never typed into Passless: when a site registers one, passkey-observer.js (page world) reports
   it and this prompt asks whether to record it — on a login for this site, or as a new item. Nothing is sent
   to the app until Save. Passless keeps the metadata only (site + account); the private key stays with the
   browser's or the device's authenticator. */

const msg = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key

/* WebAuthn only lets a page name its own host or a parent domain as the relying party, so a message that
   claims another site is not a passkey this page created. */
function rpIdFitsPage(rpId) {
  const host = location.hostname.toLowerCase()
  const rp = String(rpId || '').toLowerCase()
  return Boolean(rp) && (host === rp || host.endsWith(`.${rp}`))
}

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

let activePrompt = null

async function postPasskey({ itemId, newItem, rpId, userName }) {
  const { passlessToken } = await chrome.storage.local.get(['passlessToken'])
  const response = await fetch(`${PASSLESS_BRIDGE}/passkey-event`, {
    body: JSON.stringify({
      event_type: 'create',
      item_id: itemId || null,
      new_item: Boolean(newItem),
      origin: location.origin,
      rp_id: rpId,
      user_name: userName,
    }),
    headers: { 'Content-Type': 'application/json', 'X-Passless-Token': passlessToken || '' },
    method: 'POST',
  })
  if (!response.ok) throw new Error(String(response.status))
}

function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'text') node.textContent = value
    else node.setAttribute(key, value)
  }
  for (const child of children) node.append(child)
  return node
}

/* The prompt: a small card in the page's top-right corner inside a closed shadow root, so the site's CSS
   cannot restyle it and its scripts cannot read it. It offers each login Passless has for this site, then a
   new item; Save is the default button, Not Now and Escape dismiss it without writing anything. */
async function showPasskeyPrompt({ rpId, userName }) {
  activePrompt?.remove()
  const matches = await fetchMatches().catch(() => [])
  const logins = (Array.isArray(matches) ? matches : []).filter((item) => !item.sign_in_with || item.password)

  const host = el('div', { 'data-passless-prompt': '' })
  const root = host.attachShadow({ mode: 'closed' })
  root.append(el('style', { text: PROMPT_STYLE }))
  const titleId = 'passless-passkey-title'
  const card = el('div', { 'aria-labelledby': titleId, class: 'card', role: 'dialog' })

  const mark = el('div', { 'aria-hidden': 'true', class: 'mark' })
  mark.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m10.85 12.15 8.65-8.65"/><path d="m18 5 2 2"/><path d="m15 8 2 2"/></svg>'
  const account = userName || msg('passkeyUnknownAccount')
  card.append(
    el('div', { class: 'head' }, [
      mark,
      el('div', {}, [
        el('h2', { id: titleId, text: msg('passkeySaveTitle') }),
        el('p', { class: 'detail', text: msg('passkeySaveDetail', [account, rpId]), title: `${account} — ${rpId}` }),
      ]),
    ]),
  )

  const choices = el('fieldset', { class: 'choices' })
  const option = (value, title, sub, checked) => {
    const input = el('input', { name: 'passless-target', type: 'radio', value })
    input.checked = checked
    const text = el('span', {}, [el('span', { class: 'choice-title', text: title })])
    if (sub) text.append(el('span', { class: 'choice-sub', text: sub }))
    choices.append(el('label', {}, [input, text]))
  }
  for (const [index, item] of logins.entries()) {
    option(`item:${item.id}`, msg('passkeyAddToItem', [item.title || rpId]), item.username || '', index === 0)
  }
  option('new', msg('passkeyNewItem'), logins.length ? '' : rpId, logins.length === 0)
  card.append(choices)

  const note = el('p', { class: 'note', text: msg('passkeyNote') })
  card.append(note)

  const close = () => {
    host.remove()
    if (activePrompt === host) activePrompt = null
  }
  const notNow = el('button', { text: msg('passkeyNotNow'), type: 'button' })
  const save = el('button', { class: 'primary', text: msg('passkeySave'), type: 'button' })
  notNow.addEventListener('click', close)
  save.addEventListener('click', async () => {
    const picked = choices.querySelector('input:checked')?.value || 'new'
    save.disabled = true
    try {
      await postPasskey({
        itemId: picked.startsWith('item:') ? picked.slice(5) : null,
        newItem: picked === 'new',
        rpId,
        userName,
      })
      note.classList.remove('is-error')
      note.textContent = msg('passkeySaved')
      choices.remove()
      save.remove()
      notNow.textContent = msg('passkeyDone')
      notNow.focus()
    } catch {
      save.disabled = false
      note.classList.add('is-error')
      note.textContent = msg('passkeySaveFailed')
    }
  })
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close()
  })
  card.append(el('div', { class: 'actions' }, [notNow, save]))
  root.append(card)
  document.documentElement.append(host)
  activePrompt = host
  save.focus({ preventScroll: true })
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return
  const data = event.data
  if (data?.__passless !== 'passkey-created' || !rpIdFitsPage(data.rpId)) return
  showPasskeyPrompt({ rpId: String(data.rpId), userName: String(data.userName || '') })
})
