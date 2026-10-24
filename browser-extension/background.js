/* The one place that talks to the Mimatory app. A content script's fetch runs under the page's origin, so
   CORS and Chrome's Private Network Access would stop https://any-site.com from reaching 127.0.0.1; the
   extension's service worker, with the bridge in host_permissions, is not a page and is not stopped. */
const MIMATORY_BRIDGE = 'http://127.0.0.1:17891'
// Renamed from Passless on 2026-10-23: a pairing token saved under the old key is carried over once.
async function migrateLegacyToken() {
  const { mimatoryToken, passlessToken } = await chrome.storage.local.get(['mimatoryToken', 'passlessToken'])
  if (passlessToken === undefined) return
  if (!mimatoryToken) await chrome.storage.local.set({ mimatoryToken: passlessToken })
  await chrome.storage.local.remove('passlessToken')
}
chrome.runtime.onInstalled.addListener(() => {
  migrateLegacyToken().catch(() => {})
})
const BRIDGE_PATHS = new Set([
  '/fill',
  '/match',
  '/unlock',
  '/save',
  '/passkey-event',
  '/passkey/create',
  '/passkey/list',
  '/passkey/get',
])

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'MIMATORY_BRIDGE' || !BRIDGE_PATHS.has(message.path) || !sender.tab) return false
  ;(async () => {
    await migrateLegacyToken().catch(() => {})
    const { mimatoryToken } = await chrome.storage.local.get(['mimatoryToken'])
    // The page's origin comes from the browser, never from what the page or content script claims.
    const origin = sender.origin || (sender.url ? new URL(sender.url).origin : '')
    const response = await fetch(`${MIMATORY_BRIDGE}${message.path}`, {
      body: JSON.stringify({ ...message.body, origin, website: message.body?.website ? origin : undefined }),
      headers: { 'Content-Type': 'application/json', 'X-Mimatory-Token': mimatoryToken || '' },
      method: 'POST',
    })
    const data = await response.json().catch(() => null)
    return { data, ok: response.ok, status: response.status }
  })()
    .then(sendResponse)
    .catch(() => sendResponse({ data: null, ok: false, status: 0 }))
  return true
})

/* The one-click float lives in the top frame only; a sign-in form inside an iframe is reported up from that frame
   (with the frame's real origin, from the browser), and the top frame's float asks that frame — never any other —
   for its summaries or to sign in. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab?.id) return false
  if (message?.type === 'MIMATORY_FRAME_LOGIN' && sender.frameId > 0) {
    const origin = sender.origin || (sender.url ? new URL(sender.url).origin : '')
    chrome.tabs
      .sendMessage(
        sender.tab.id,
        { frameId: sender.frameId, origin, present: Boolean(message.present), type: 'MIMATORY_FRAME_LOGIN' },
        { frameId: 0 },
      )
      .catch(() => {})
    return false
  }
  if (message?.type === 'MIMATORY_FRAME_CALL' && sender.frameId === 0 && message.frameId > 0) {
    chrome.tabs
      .sendMessage(
        sender.tab.id,
        { call: message.call, itemId: message.itemId, type: 'MIMATORY_FRAME_CALL' },
        { frameId: message.frameId },
      )
      .then(sendResponse, () => sendResponse(null))
    return true
  }
  return false
})
