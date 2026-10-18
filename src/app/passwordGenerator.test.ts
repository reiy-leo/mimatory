import { describe, expect, it } from 'vitest'
import {
  applyGeneratorChange,
  clampToLimits,
  defaultGeneratorOptions,
  generatorAmount,
  generatorLimits,
  passwordCharKind,
  passwordRuns,
  strengthFill,
} from './passwordGenerator'

describe('password character colouring', () => {
  it('tells digits, symbols and letters apart', () => {
    expect(passwordCharKind('7')).toBe('digit')
    expect(passwordCharKind('@')).toBe('symbol')
    expect(passwordCharKind('!')).toBe('symbol')
    expect(passwordCharKind('-')).toBe('symbol')
    expect(passwordCharKind('q')).toBe('letter')
    expect(passwordCharKind('Z')).toBe('letter')
    expect(passwordCharKind('é')).toBe('letter')
    // A passphrase's space draws nothing, so it never takes a colour.
    expect(passwordCharKind(' ')).toBe('letter')
  })

  it('groups consecutive characters of one kind into a run', () => {
    expect(passwordRuns('vGK@Z3miM!eQ44')).toEqual([
      { kind: 'letter', text: 'vGK' },
      { kind: 'symbol', text: '@' },
      { kind: 'letter', text: 'Z' },
      { kind: 'digit', text: '3' },
      { kind: 'letter', text: 'miM' },
      { kind: 'symbol', text: '!' },
      { kind: 'letter', text: 'eQ' },
      { kind: 'digit', text: '44' },
    ])
    expect(passwordRuns('')).toEqual([])
    expect(
      passwordRuns('abc!@#123')
        .map((run) => run.text)
        .join(''),
    ).toBe('abc!@#123')
  })
})

describe('generator options', () => {
  it('opens like 1Password: a 32-character random password with numbers and symbols', () => {
    expect(defaultGeneratorOptions).toMatchObject({ length: 32, mode: 'random', numbers: true, symbols: true })
  })

  it('brings the length into range when the type changes', () => {
    const pin = applyGeneratorChange(defaultGeneratorOptions, { kind: 'type', mode: 'pin' })
    expect(pin).toMatchObject({ length: generatorLimits.pin.max, mode: 'pin' })
    const back = applyGeneratorChange(pin, { kind: 'type', mode: 'random' })
    expect(back).toMatchObject({ length: defaultGeneratorOptions.length, mode: 'random' })
    const phrase = applyGeneratorChange(defaultGeneratorOptions, { kind: 'type', mode: 'passphrase' })
    expect(phrase).toMatchObject({ length: 32, mode: 'passphrase', words: 4 })
    expect(generatorAmount(phrase)).toBe(4)
  })

  it('clamps the amount to the type and writes words for a passphrase', () => {
    expect(applyGeneratorChange(defaultGeneratorOptions, { kind: 'amount', value: 500 }).length).toBe(100)
    expect(applyGeneratorChange(defaultGeneratorOptions, { kind: 'amount', value: 2 }).length).toBe(8)
    const phrase = { ...defaultGeneratorOptions, mode: 'passphrase' as const }
    expect(applyGeneratorChange(phrase, { kind: 'amount', value: 6 })).toMatchObject({ length: 32, words: 6 })
    expect(clampToLimits(Number.NaN, generatorLimits.random)).toBe(8)
    expect(clampToLimits(12.6, generatorLimits.random)).toBe(13)
  })

  it('keeps letters on, so both toggles off still leaves a character set', () => {
    let options = applyGeneratorChange(defaultGeneratorOptions, { kind: 'toggle', option: 'numbers', value: false })
    options = applyGeneratorChange(options, { kind: 'toggle', option: 'symbols', value: false })
    expect(options).toMatchObject({ lowercase: true, numbers: false, symbols: false, uppercase: true })
  })

  it('fills the strength bar by level', () => {
    expect(strengthFill('weak')).toBe('quarter')
    expect(strengthFill('fair')).toBe('half')
    expect(strengthFill('strong')).toBe('three-quarters')
    expect(strengthFill('excellent')).toBe('full')
  })
})
