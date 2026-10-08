const bridge = 'http://127.0.0.1:17891'
const statusEl = document.getElementById('status')
const tokenInput = document.getElementById('token')

const text = (key) => chrome.i18n.getMessage(key)

/* The popup has no in-app language switch: it follows the browser UI language, which is what
   chrome.i18n resolves messages against. Assistive tech reads this value for the whole document. */
document.documentElement.lang = chrome.i18n.getUILanguage()
for (const element of document.querySelectorAll('[data-i18n]')) {
  element.textContent = text(element.dataset.i18n) || element.textContent
}
for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
  element.placeholder = text(element.dataset.i18nPlaceholder) || element.placeholder
}

chrome.storage.local.get(['passlessToken']).then((result) => {
  tokenInput.value = result.passlessToken || ''
})

fetch(`${bridge}/health`)
  .then((response) => {
    statusEl.textContent = text(response.ok ? 'statusConnected' : 'statusUnavailable')
  })
  .catch(() => {
    statusEl.textContent = text('statusUnavailable')
  })

document.getElementById('fill').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'PASSLESS_FILL' })
  }
})

document.getElementById('save-token').addEventListener('click', async () => {
  await chrome.storage.local.set({ passlessToken: tokenInput.value.trim() })
  statusEl.textContent = text('tokenSaved')
})
