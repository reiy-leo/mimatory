import type { Dispatch, SetStateAction } from 'react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { getAutoLockMilliseconds, type SecurityPreferences } from './securityPreferences'
import { type AppStatus, type LoginItemSummary, vaultApi } from './vaultApi'
import type { VaultMode } from './vaultModel'

/**
 * Locked or not: the first-run / unlock state, master password and biometric unlock, and the idle auto-lock
 * (moved out of App.tsx 2026-10-23). Locking itself stays in useVaultWindow because it clears the window.
 */
export function useVaultSession({
  handleLock,
  loadArchivedItems,
  loadTrashedItems,
  loadVaults,
  securityPreferences,
  setError,
  setItems,
  setSelectedId,
}: {
  handleLock: () => Promise<void>
  loadArchivedItems: () => Promise<void>
  loadTrashedItems: () => Promise<void>
  loadVaults: () => Promise<void>
  securityPreferences: SecurityPreferences
  setError: Dispatch<SetStateAction<string | null>>
  setItems: Dispatch<SetStateAction<LoginItemSummary[]>>
  setSelectedId: Dispatch<SetStateAction<string | null>>
}) {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [mode, setMode] = useState<VaultMode>('loading')
  const [masterPassword, setMasterPassword] = useState('')
  const masterPasswordInputRef = useRef<HTMLInputElement>(null)
  // Between the master password going in and the list arriving: key derivation and the first read.
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [biometricsAvailable, setBiometricsAvailable] = useState(false)
  // A ref, not state: it changes on every mouse move and scroll, and as state it re-rendered the whole
  // window (every list row included) on each of them.
  const lastActivityRef = useRef(Date.now())

  useEffect(() => {
    vaultApi
      .initialize()
      .then((nextStatus) => {
        setStatus(nextStatus)
        setMode(nextStatus.has_master_password ? 'locked' : 'setup')
      })
      .catch((nextError) => {
        setError(String(nextError))
        setMode('setup')
      })
  }, [])

  useEffect(() => {
    vaultApi
      .canUseBiometrics()
      .then(setBiometricsAvailable)
      .catch(() => setBiometricsAvailable(false))
  }, [])

  useEffect(() => {
    if (mode !== 'unlocked') return
    const updateActivity = () => {
      lastActivityRef.current = Date.now()
    }
    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    for (const eventName of events) {
      window.addEventListener(eventName, updateActivity, { capture: true, passive: true })
    }
    return () => {
      for (const eventName of events) window.removeEventListener(eventName, updateActivity, { capture: true })
    }
  }, [mode])

  // The lock screen's password field takes focus from an effect rather than `autoFocus`, the same way
  // every other panel in the window focuses its first field.
  useEffect(() => {
    if (mode === 'locked' || mode === 'setup') masterPasswordInputRef.current?.focus()
  }, [mode])

  useEffect(() => {
    if (mode !== 'unlocked') return
    const timeout = getAutoLockMilliseconds(securityPreferences.autoLockIdleDuration)
    if (timeout === null) return
    lastActivityRef.current = Date.now()
    const lockCheck = window.setInterval(
      () => {
        if (Date.now() - lastActivityRef.current >= timeout) handleLock()
      },
      Math.min(timeout, 5000),
    )
    return () => window.clearInterval(lockCheck)
  }, [mode, securityPreferences.autoLockIdleDuration])

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isUnlocking) return
    setError(null)
    setIsUnlocking(true)
    try {
      const nextItems = mode === 'setup' ? await vaultApi.setup(masterPassword) : await vaultApi.unlock(masterPassword)
      setItems(nextItems)
      setSelectedId(nextItems[0]?.id ?? null)
      setMasterPassword('')
      setMode('unlocked')
      await loadVaults()
      loadArchivedItems().catch((nextError) => setError(String(nextError)))
      loadTrashedItems().catch((nextError) => setError(String(nextError)))
      setStatus((current) => (current ? { ...current, has_master_password: true, unlocked: true } : current))
    } catch (nextError) {
      setError(String(nextError))
    } finally {
      setIsUnlocking(false)
    }
  }

  async function handleBiometricUnlock() {
    setError(null)
    try {
      const nextItems = await vaultApi.unlockWithBiometrics()
      setItems(nextItems)
      setSelectedId(nextItems[0]?.id ?? null)
      setMode('unlocked')
      await loadVaults()
    } catch (nextError) {
      setError(String(nextError))
    }
  }

  return {
    biometricsAvailable,
    handleBiometricUnlock,
    handleUnlock,
    isUnlocking,
    lastActivityRef,
    masterPassword,
    masterPasswordInputRef,
    mode,
    setBiometricsAvailable,
    setIsUnlocking,
    setMasterPassword,
    setMode,
    setStatus,
    status,
  }
}
