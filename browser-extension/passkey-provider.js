/* Passless as a passkey provider (owner 2026-10-18: "完整passkey支持"). Runs in the page's own world (manifest:
   "world": "MAIN"), because only there does wrapping navigator.credentials see the site's calls.

   create() and get() for public-key credentials are handed to content.js, which asks the user in its own prompt
   (a closed shadow root the page cannot read). The bridge signs in the app; this side only ever sees public data
   and signatures, never a private key. When the user picks "Use another device", or Passless holds nothing for
   the site, the browser's own WebAuthn runs exactly as if Passless were not installed. */
;(() => {
  const credentials = navigator.credentials
  if (!credentials || typeof credentials.create !== 'function' || credentials.__passlessProvider) return
  const originalCreate = credentials.create.bind(credentials)
  const originalGet = credentials.get.bind(credentials)

  const toBytes = (source) =>
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : ArrayBuffer.isView(source)
        ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
        : new Uint8Array()
  const b64url = (source) => {
    let binary = ''
    for (const byte of toBytes(source)) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  const fromB64url = (value) => {
    const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  }

  let nextId = 0
  const pending = new Map()

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.__passless !== 'webauthn-response') return
    const waiter = pending.get(event.data.id)
    if (!waiter) return
    pending.delete(event.data.id)
    waiter(event.data)
  })

  function ask(kind, request, signal) {
    nextId += 1
    const id = `passless-${Date.now()}-${nextId}`
    return new Promise((resolve, reject) => {
      const abort = () => {
        pending.delete(id)
        window.postMessage({ __passless: 'webauthn-abort', id }, location.origin)
        reject(
          signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError'),
        )
      }
      if (signal?.aborted) return abort()
      signal?.addEventListener('abort', abort, { once: true })
      pending.set(id, (answer) => {
        signal?.removeEventListener('abort', abort)
        resolve(answer)
      })
      window.postMessage({ __passless: 'webauthn-request', id, kind, request }, location.origin)
    })
  }

  const define = (target, values) => {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(target, key, { configurable: true, enumerable: true, value })
    }
    return target
  }

  /* A real PublicKeyCredential as far as the site can tell: the right prototypes (instanceof works), own
     properties in place of the native getters, and toJSON() for libraries that serialize with it. */
  function credentialFrom(kind, result, credProps) {
    const rawId = fromB64url(result.credential_id)
    const clientDataJSON = fromB64url(result.client_data_json)
    const authenticatorData = fromB64url(result.authenticator_data)
    let response
    let responseJSON
    if (kind === 'create') {
      const attestationObject = fromB64url(result.attestation_object)
      const publicKey = fromB64url(result.public_key)
      response = Object.create(globalThis.AuthenticatorAttestationResponse?.prototype || Object.prototype)
      define(response, {
        attestationObject,
        clientDataJSON,
        getAuthenticatorData: () => authenticatorData.slice(0),
        getPublicKey: () => publicKey.slice(0),
        getPublicKeyAlgorithm: () => result.public_key_algorithm,
        getTransports: () => [...result.transports],
      })
      responseJSON = {
        attestationObject: result.attestation_object,
        authenticatorData: result.authenticator_data,
        clientDataJSON: result.client_data_json,
        publicKey: result.public_key,
        publicKeyAlgorithm: result.public_key_algorithm,
        transports: [...result.transports],
      }
    } else {
      response = Object.create(globalThis.AuthenticatorAssertionResponse?.prototype || Object.prototype)
      define(response, {
        authenticatorData,
        clientDataJSON,
        signature: fromB64url(result.signature),
        userHandle: result.user_handle ? fromB64url(result.user_handle) : null,
      })
      responseJSON = {
        authenticatorData: result.authenticator_data,
        clientDataJSON: result.client_data_json,
        signature: result.signature,
        userHandle: result.user_handle || undefined,
      }
    }
    const extensions = kind === 'create' && credProps ? { credProps: { rk: true } } : {}
    const credential = Object.create(globalThis.PublicKeyCredential?.prototype || Object.prototype)
    return define(credential, {
      authenticatorAttachment: 'platform',
      getClientExtensionResults: () => ({ ...extensions }),
      id: result.credential_id,
      rawId,
      response,
      toJSON: () => ({
        authenticatorAttachment: 'platform',
        clientExtensionResults: { ...extensions },
        id: result.credential_id,
        rawId: result.credential_id,
        response: responseJSON,
        type: 'public-key',
      }),
      type: 'public-key',
    })
  }

  function failure(error) {
    return new DOMException(
      error?.message || 'The operation either timed out or was not allowed.',
      error?.name || 'NotAllowedError',
    )
  }

  credentials.create = async function passlessCreate(options) {
    const publicKey = options?.publicKey
    if (!publicKey) return originalCreate(options)
    let request
    try {
      request = {
        algorithms: (publicKey.pubKeyCredParams || []).map((param) => param.alg),
        challenge: b64url(publicKey.challenge),
        exclude_credentials: (publicKey.excludeCredentials || []).map((item) => b64url(item.id)),
        rp_id: publicKey.rp?.id || location.hostname,
        rp_name: publicKey.rp?.name || '',
        user_display_name: publicKey.user?.displayName || '',
        user_id: b64url(publicKey.user?.id),
        user_name: publicKey.user?.name || '',
      }
    } catch {
      return originalCreate(options)
    }
    const answer = await ask('create', request, options.signal)
    if (answer.fallback) return originalCreate(options)
    if (answer.error) throw failure(answer.error)
    return credentialFrom('create', answer.result, Boolean(publicKey.extensions?.credProps))
  }

  credentials.get = async function passlessGet(options) {
    const publicKey = options?.publicKey
    if (!publicKey) return originalGet(options)
    let request
    try {
      request = {
        allow_credentials: (publicKey.allowCredentials || []).map((item) => b64url(item.id)),
        challenge: b64url(publicKey.challenge),
        conditional: options.mediation === 'conditional',
        rp_id: publicKey.rpId || location.hostname,
      }
    } catch {
      return originalGet(options)
    }
    const answer = await ask('get', request, options.signal)
    if (answer.fallback) return originalGet(options)
    if (answer.error) throw failure(answer.error)
    return credentialFrom('get', answer.result, false)
  }

  Object.defineProperty(credentials, '__passlessProvider', { value: true })
})()
