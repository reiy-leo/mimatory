const bridge = 'http://127.0.0.1:17891'
const statusEl = document.getElementById('status')
const tokenInput = document.getElementById('token')

chrome.storage.local.get(['passlessToken']).then((result) => {
  tokenInput.value = result.passlessToken || ''
})

fetch(`${bridge}/health`)
  .then((response) => {
    statusEl.textContent = response.ok ? 'Desktop app connected' : 'Desktop app unavailable'
  })
  .catch(() => {
    statusEl.textContent = 'Desktop app unavailable'
  })

document.getElementById('fill').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'PASSLESS_FILL' })
  }
})

document.getElementById('save-token').addEventListener('click', async () => {
  await chrome.storage.local.set({ passlessToken: tokenInput.value.trim() })
  statusEl.textContent = 'Pairing token saved'
})
