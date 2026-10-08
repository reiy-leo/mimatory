const totpPeriodSeconds = 30

export function formatOtpCode(code: string): string {
  const normalized = code.trim()
  if (!/^\d{6}$/.test(normalized)) return normalized
  return `${normalized.slice(0, 3)} • ${normalized.slice(3)}`
}

export function getTotpProgress(secondsRemaining: number): number {
  return Math.max(0, Math.min(1, secondsRemaining / totpPeriodSeconds))
}
