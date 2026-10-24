/* The one place that talks to the Mimatory app.

   Primary transport (2026-10-24): browser native messaging, like 1Password. `connectNative` starts the app's own
   binary as the host `app.mimatory.native` (its manifest, written by the app at startup, allows only this
   extension's fixed ID), and the host relays each `{ id, path, body }` to the running app over a private local
   socket; the app checks that the host is its own binary and, on macOS, that the browser that started it is signed
   by a known browser vendor. No pairing code. Answers come back as `{ id, status, data }` with the bridge's HTTP
   status codes (503 = the app is not running).

   Fallback (kept for this release; removing it is an owner decision in .agent/todo.md): the HTTP bridge on
   127.0.0.1:17891 with the pairing token, used only when the native host cannot be started at all (an app build
   from before native messaging, an unregistered browser). A content script's fetch runs under the page's origin,
   so CORS and Private Network Access would stop https://any-site.com from reaching 127.0.0.1; this service
   worker, with the bridge in host_permissions, is not a page and is not stopped. */
const MIMATORY_BRIDGE = 'http://127.0.0.1:17891'
const NATIVE_HOST = 'app.mimatory.native'
const NATIVE_TIMEOUT_MS = 20000
// After the host failed to start, the next tries go straight to the fallback for a moment instead of
// relaunching a missing host on every call.
const NATIVE_RETRY_MS = 3000

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

let nativePort = null
let nativeFailedAt = 0
let nativeError = ''
let nextRequestId = 1
const pendingRequests = new Map()

function settleAll(answer) {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timer)
    pending.resolve(answer)
  }
  pendingRequests.clear()
}

/* One persistent port while the worker lives (an open native port also keeps the worker alive, Chrome ≥ 105), opened
   ahead of the first pick by `warmNative`; a disconnect —
   the host could not start, the app quit, the browser recycled it — fails what is in flight and the next call
   reconnects. */
function openNativePort() {
  if (nativePort) return nativePort
  if (!chrome.runtime.connectNative || Date.now() - nativeFailedAt < NATIVE_RETRY_MS) return null
  let port
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST)
  } catch (error) {
    nativeFailedAt = Date.now()
    nativeError = String(error?.message || error)
    return null
  }
  port.onMessage.addListener((message) => {
    const pending = pendingRequests.get(message?.id)
    if (!pending) return
    pendingRequests.delete(message.id)
    clearTimeout(pending.timer)
    pending.resolve({ data: message.data ?? null, status: Number(message.status) || 0 })
  })
  port.onDisconnect.addListener(() => {
    nativeError = chrome.runtime.lastError?.message || 'disconnected'
    if (nativePort === port) nativePort = null
    // Answered nothing at all: the host is missing or refused to start. Otherwise it simply went away.
    if (!port.answered) nativeFailedAt = Date.now()
    settleAll(null)
  })
  nativePort = port
  return port
}

/* `{ status, data }` from the app through the native host, or null when the host is unavailable (then the caller
   falls back to HTTP). A timeout is an answer (status 0), not a reason to try the other transport. */
function nativeRequest(path, body) {
  const port = openNativePort()
  if (!port) return Promise.resolve(null)
  const id = nextRequestId++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id)
      resolve({ data: { error: 'timeout' }, status: 0 })
    }, NATIVE_TIMEOUT_MS)
    pendingRequests.set(id, {
      resolve: (answer) => {
        if (answer) port.answered = true
        resolve(answer)
      },
      timer,
    })
    try {
      port.postMessage({ body, id, path })
    } catch {
      pendingRequests.delete(id)
      clearTimeout(timer)
      resolve(null)
    }
  })
}

async function httpRequest(path, body) {
  await migrateLegacyToken().catch(() => {})
  const { mimatoryToken } = await chrome.storage.local.get(['mimatoryToken'])
  const response = await fetch(`${MIMATORY_BRIDGE}${path}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-Mimatory-Token': mimatoryToken || '' },
    method: 'POST',
  })
  const data = await response.json().catch(() => null)
  return { data, status: response.status }
}

async function bridgeRequest(path, body) {
  const native = await nativeRequest(path, body)
  const answer = native ?? (await httpRequest(path, body))
  return { data: answer.data, ok: answer.status >= 200 && answer.status < 300, status: answer.status }
}

/* Warm-up (2026-10-24): a content script that sees a sign-in form (or a focused login field) asks for the
   native connection before the user picks anything. The first request on a new port pays for starting the host
   — the app's own binary — plus its socket connect and the app's caller checks (same executable, on macOS the
   browser's code signature), all once per connection; a /health now moves that off the pick. The open port then
   keeps this worker alive, so later picks reuse it. Answers nothing to the page. */
let warmUntil = 0
function warmNative() {
  if (nativePort?.answered || Date.now() < warmUntil) return
  warmUntil = Date.now() + 5000
  nativeRequest('/health', {}).catch(() => {})
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'MIMATORY_WARM' && sender.tab) warmNative()
  return false
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'MIMATORY_BRIDGE' || !BRIDGE_PATHS.has(message.path) || !sender.tab) return false
  // The page's origin comes from the browser, never from what the page or content script claims.
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : '')
  const body = { ...message.body, origin, website: message.body?.website ? origin : undefined }
  bridgeRequest(message.path, body)
    .then(sendResponse)
    .catch(() => sendResponse({ data: null, ok: false, status: 0 }))
  return true
})

/* The popup's state line: `native` with the app's answer (200 + lock state, 503 not running, 403 refused), or
   `http` with whether the fallback bridge answers — only then does the popup show the pairing code. */
async function connectionStatus() {
  const native = await nativeRequest('/health', {})
  if (native) return { data: native.data, status: native.status, transport: 'native' }
  const reachable = await fetch(`${MIMATORY_BRIDGE}/health`)
    .then((response) => response.ok)
    .catch(() => false)
  return { error: nativeError, reachable, transport: 'http' }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the extension's own pages (the popup) ask; a content script's sender.url is the web page.
  const fromExtensionPage = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''))
  if (message?.type !== 'MIMATORY_STATUS' || !fromExtensionPage) return false
  connectionStatus()
    .then(sendResponse)
    .catch(() => sendResponse({ reachable: false, transport: 'http' }))
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
