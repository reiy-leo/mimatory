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

async function fillFromPassless() {
  const login = findLoginForm()
  if (!login) return
  const { passlessToken } = await chrome.storage.local.get(['passlessToken'])
  const response = await fetch(`${PASSLESS_BRIDGE}/fill`, {
    body: JSON.stringify({ origin: location.hostname }),
    headers: { 'Content-Type': 'application/json', 'X-Passless-Token': passlessToken || '' },
    method: 'POST',
  })
  if (!response.ok) return
  const items = await response.json()
  const item = items[0]
  if (!item) return
  if (login.username) {
    login.username.value = item.username
    login.username.dispatchEvent(new Event('input', { bubbles: true }))
  }
  login.password.value = item.password
  login.password.dispatchEvent(new Event('input', { bubbles: true }))
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

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'PASSLESS_FILL') {
    fillFromPassless()
  }
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
