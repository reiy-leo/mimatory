const bridge = 'http://127.0.0.1:17891'
const statusEl = document.getElementById('status')
const tokenInput = document.getElementById('token')

const text = (key, substitutions) => chrome.i18n.getMessage(key, substitutions)

/* The popup has no in-app language switch: it follows the browser UI language, which is what
   chrome.i18n resolves messages against. Assistive tech reads this value for the whole document. */
document.documentElement.lang = chrome.i18n.getUILanguage()
document.title = text('appName') || document.title
for (const element of document.querySelectorAll('[data-i18n]')) {
  element.textContent = text(element.dataset.i18n) || element.textContent
}
for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
  element.placeholder = text(element.dataset.i18nPlaceholder) || element.placeholder
}

// Renamed from Passless on 2026-10-23: show (and keep) a token saved under the old key until it is moved.
chrome.storage.local.get(['mimatoryToken', 'passlessToken']).then(async (result) => {
  const token = result.mimatoryToken || result.passlessToken || ''
  tokenInput.value = token
  if (result.passlessToken !== undefined) {
    if (!result.mimatoryToken && token) await chrome.storage.local.set({ mimatoryToken: token })
    await chrome.storage.local.remove('passlessToken')
  }
})

fetch(`${bridge}/health`)
  .then((response) => {
    statusEl.textContent = text(response.ok ? 'statusConnected' : 'statusUnavailable')
  })
  .catch(() => {
    statusEl.textContent = text('statusUnavailable')
  })

/* The bridge sends a known provider as its id (`google`) and anything else as the name the user typed. */
const PROVIDER_LABELS = {
  apple: 'Apple',
  facebook: 'Facebook',
  github: 'GitHub',
  google: 'Google',
  microsoft: 'Microsoft',
  x: 'X',
}

function describeFill(result) {
  if (!result) return text('noMatch')
  if (result.kind === 'signInWith') {
    const provider = PROVIDER_LABELS[result.provider] || result.provider
    const hint = text(result.found ? 'providerButtonFound' : 'providerButtonMissing', [provider])
    return `${text('signInWithProvider', [provider])}. ${hint}`
  }
  if (result.kind === 'filled') return text('filledPage')
  if (result.kind === 'noLoginForm') return text('noLoginForm')
  if (result.kind === 'noMatch') return text('noMatch')
  return text('statusUnavailable')
}

document.getElementById('fill').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'MIMATORY_FILL' })
    statusEl.textContent = describeFill(result)
  } catch {
    statusEl.textContent = text('statusUnavailable')
  }
})

document.getElementById('save-token').addEventListener('click', async () => {
  await chrome.storage.local.set({ mimatoryToken: tokenInput.value.trim() })
  statusEl.textContent = text('tokenSaved')
})
