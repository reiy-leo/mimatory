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
    body: JSON.stringify({ origin: location.hostname }),
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

function installPasskeyObserver() {
  if (!navigator.credentials || navigator.credentials.__passlessObserved) return
  const originalCreate = navigator.credentials.create?.bind(navigator.credentials)
  const originalGet = navigator.credentials.get?.bind(navigator.credentials)

  async function sendPasskeyEvent(eventType, publicKey) {
    const { passlessToken } = await chrome.storage.local.get(['passlessToken'])
    const rpId = publicKey?.rp?.id || publicKey?.rpId || location.hostname
    const userName = publicKey?.user?.name || publicKey?.user?.displayName || ''
    await fetch(`${PASSLESS_BRIDGE}/passkey-event`, {
      body: JSON.stringify({
        event_type: eventType,
        origin: location.origin,
        rp_id: rpId,
        user_name: userName,
      }),
      headers: { 'Content-Type': 'application/json', 'X-Passless-Token': passlessToken || '' },
      method: 'POST',
    }).catch(() => {})
  }

  if (originalCreate) {
    navigator.credentials.create = async function passlessCreate(options) {
      if (options?.publicKey) {
        sendPasskeyEvent('create', options.publicKey)
      }
      return originalCreate(options)
    }
  }

  if (originalGet) {
    navigator.credentials.get = async function passlessGet(options) {
      if (options?.publicKey) {
        sendPasskeyEvent('get', options.publicKey)
      }
      return originalGet(options)
    }
  }

  Object.defineProperty(navigator.credentials, '__passlessObserved', { value: true })
}

installPasskeyObserver()
