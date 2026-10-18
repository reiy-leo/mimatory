/* Runs in the page's own world (manifest: "world": "MAIN"), because a content script's isolated world has its
   own `navigator` wrapper and wrapping `create` there never sees the site's call. It only watches: once the
   browser's authenticator has actually created a passkey, it tells content.js the relying party and the account
   handle, and content.js asks the user whether to record it in Passless. Nothing here reads or stores a key —
   the private key stays with the platform authenticator. */
;(() => {
  const credentials = navigator.credentials
  if (!credentials || typeof credentials.create !== 'function' || credentials.__passlessObserved) return
  const originalCreate = credentials.create.bind(credentials)

  credentials.create = async function passlessCreate(options) {
    const credential = await originalCreate(options)
    try {
      const publicKey = options?.publicKey
      if (publicKey && credential && credential.type === 'public-key') {
        window.postMessage(
          {
            __passless: 'passkey-created',
            rpId: publicKey.rp?.id || location.hostname,
            userName: publicKey.user?.name || publicKey.user?.displayName || '',
          },
          location.origin,
        )
      }
    } catch {
      // Never let the observer break the site's own registration.
    }
    return credential
  }

  Object.defineProperty(credentials, '__passlessObserved', { value: true })
})()
