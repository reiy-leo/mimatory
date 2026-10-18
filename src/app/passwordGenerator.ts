/**
 * The password generator popover's rules (1Password 8's generator, owner 2026-10-18: "用这个密码生成的弹窗"):
 * which characters are coloured, the limits each type's slider runs between, how an option change is applied,
 * and how full the strength bar is. Pure, so the tests read it without a DOM.
 */
import { largeTypeKind } from './largeType'
import type { PasswordGeneratorMode, PasswordGeneratorOptions, PasswordStrength } from './vaultApi'

/** Digits read in blue and symbols in red, letters in the label colour (Large Type uses the same convention). */
export type PasswordCharKind = 'digit' | 'letter' | 'symbol'

export type PasswordRun = { kind: PasswordCharKind; text: string }

export function passwordCharKind(character: string): PasswordCharKind {
  const kind = largeTypeKind(character)
  // A space in a passphrase is a separator, but it draws nothing, so it never needs a colour of its own.
  return kind === 'space' ? 'letter' : kind
}

/** Consecutive characters of one kind become one run, so a 128-character password is a handful of spans. */
export function passwordRuns(value: string): PasswordRun[] {
  const runs: PasswordRun[] = []
  for (const character of Array.from(value)) {
    const kind = passwordCharKind(character)
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.text += character
    else runs.push({ kind, text: character })
  }
  return runs
}

/** The types the Type pop-up offers, in its order: the modes the backend's generator knows. */
export const generatorTypes: PasswordGeneratorMode[] = ['random', 'passphrase', 'pin']

export type GeneratorLimits = { max: number; min: number; step: number }

// Every step divides its span evenly, so the slider never lands between two values.
export const generatorLimits: Record<PasswordGeneratorMode, GeneratorLimits> = {
  passphrase: { max: 9, min: 3, step: 1 },
  pin: { max: 12, min: 4, step: 1 },
  random: { max: 100, min: 8, step: 1 },
}

/** The slider's value for a type: the word count for a passphrase, the length otherwise. */
export function generatorAmount(options: PasswordGeneratorOptions): number {
  return options.mode === 'passphrase' ? options.words : options.length
}

export function clampToLimits(value: number, limits: GeneratorLimits): number {
  if (!Number.isFinite(value)) return limits.min
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)))
}

/** 1Password opens on a 32-character random password with numbers and symbols. */
export const defaultGeneratorOptions: PasswordGeneratorOptions = {
  exclude_ambiguous: true,
  length: 32,
  lowercase: true,
  mode: 'random',
  numbers: true,
  symbols: true,
  uppercase: true,
  words: 4,
}

export type GeneratorChange =
  | { kind: 'type'; mode: PasswordGeneratorMode }
  | { kind: 'amount'; value: number }
  | { kind: 'toggle'; option: 'numbers' | 'symbols'; value: boolean }

/**
 * Applies one control's change. A type switch brings the length into the new type's range (a 32-character
 * password becomes a 12-digit PIN, not a 32-digit one); the amount is clamped to the current type's range.
 * Letters stay on in a random password, so turning off both toggles still leaves a character set.
 */
export function applyGeneratorChange(
  options: PasswordGeneratorOptions,
  change: GeneratorChange,
): PasswordGeneratorOptions {
  if (change.kind === 'type') {
    if (change.mode === 'passphrase') return { ...options, mode: change.mode }
    // A PIN's few digits would make a weak password, so coming back from PIN starts at the default length.
    const length = options.mode === 'pin' && change.mode === 'random' ? defaultGeneratorOptions.length : options.length
    return { ...options, length: clampToLimits(length, generatorLimits[change.mode]), mode: change.mode }
  }
  if (change.kind === 'amount') {
    const value = clampToLimits(change.value, generatorLimits[options.mode])
    return options.mode === 'passphrase' ? { ...options, words: value } : { ...options, length: value }
  }
  return { ...options, lowercase: true, uppercase: true, [change.option]: change.value }
}

/** How much of the bar under the password is filled, by the backend's strength level. */
export function strengthFill(level: PasswordStrength['level']): 'full' | 'half' | 'quarter' | 'three-quarters' {
  if (level === 'excellent') return 'full'
  if (level === 'strong') return 'three-quarters'
  if (level === 'fair') return 'half'
  return 'quarter'
}

/** The popover remembers its last options for as long as the window lives; nothing is written to disk. */
let lastOptions: PasswordGeneratorOptions = defaultGeneratorOptions

export function rememberedGeneratorOptions(): PasswordGeneratorOptions {
  return lastOptions
}

export function rememberGeneratorOptions(options: PasswordGeneratorOptions) {
  lastOptions = options
}
