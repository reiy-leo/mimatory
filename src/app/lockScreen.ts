export type LockScreenMode = 'loading' | 'setup' | 'locked' | 'unlocked'
export type LockScreenVariant = 'setup' | 'compact-unlock'

export function getLockScreenVariant(mode: LockScreenMode): LockScreenVariant {
  return mode === 'setup' || mode === 'loading' ? 'setup' : 'compact-unlock'
}

export function shouldShowTouchIdUnlock(
  biometricsAvailable: boolean,
  unlockUsingTouchId: boolean,
  unlockWithMacPassword: boolean,
): boolean {
  return biometricsAvailable && (unlockUsingTouchId || unlockWithMacPassword)
}
