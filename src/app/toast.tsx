import { useEffect, useRef, useSyncExternalStore } from 'react'

// Confirmations ("Vault Personal updated") are transient toasts rather than banners that stay until the next
// action (owner 2026-10-18): they fade on their own after a few seconds, and where they appear is a device-local
// Appearance setting shared by the main and Settings windows, like the theme.

export const toastPositions = ['top-right', 'bottom-right', 'top-center', 'bottom-center'] as const
export type ToastPosition = (typeof toastPositions)[number]

export const toastPositionPreferenceKey = 'passless-toast-position'
export const defaultToastPosition: ToastPosition = 'bottom-right'
/** How long a confirmation stays on screen. */
export const toastDurationMs = 3000

export function readToastPosition(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): ToastPosition {
  const value = storage?.getItem(toastPositionPreferenceKey)
  return (toastPositions as readonly string[]).includes(value ?? '') ? (value as ToastPosition) : defaultToastPosition
}

const listeners = new Set<() => void>()

export function writeToastPosition(position: ToastPosition, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(toastPositionPreferenceKey, position)
  listeners.forEach((listener) => {
    listener()
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // The other window changing the setting arrives as a storage event.
  const onStorage = (event: StorageEvent) => {
    if (event.key === toastPositionPreferenceKey) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useToastPosition(): ToastPosition {
  return useSyncExternalStore(subscribe, () => readToastPosition())
}

/**
 * A confirmation pinned to a corner or edge of the window. It clears itself through `onDismiss` after
 * `toastDurationMs`; a new message restarts the clock.
 */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const position = useToastPosition()
  // Held in a ref so a parent re-render (the OTP countdown ticks every second) never restarts the clock.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => dismissRef.current(), toastDurationMs)
    return () => window.clearTimeout(timer)
  }, [message])
  if (!message) return null
  return (
    <div aria-live="polite" className="toast" data-position={position} role="status">
      {message}
    </div>
  )
}
