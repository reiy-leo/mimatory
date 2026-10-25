import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useState } from 'react'
import { describeError } from './errors'
import { vaultApi } from './vaultApi'
import type { FieldTotpPreview, LoginFormState } from './vaultModel'

/**
 * The one-time codes the open item shows: generated when a saved secret is on screen, counted down each
 * second and regenerated when they expire (moved out of App.tsx 2026-10-23).
 */
export function useTotpPreviews({
  form,
  isEditing,
  otpFieldIndexes,
  setError,
}: {
  form: LoginFormState
  isEditing: boolean
  otpFieldIndexes: number[]
  setError: Dispatch<SetStateAction<string | null>>
}) {
  const [fieldTotpPreviews, setFieldTotpPreviews] = useState<Record<number, FieldTotpPreview>>({})

  useEffect(() => {
    if (!Object.keys(fieldTotpPreviews).length) return
    const timer = window.setInterval(() => {
      setFieldTotpPreviews((current) => {
        const nextEntries = Object.entries(current).map(([index, preview]) => [
          index,
          {
            ...preview,
            secondsRemaining: Math.max(0, preview.secondsRemaining - 1),
          },
        ])
        return Object.fromEntries(nextEntries) as Record<number, FieldTotpPreview>
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [fieldTotpPreviews])

  useEffect(() => {
    const expiredIndexes = Object.entries(fieldTotpPreviews)
      .filter(([, preview]) => preview.secondsRemaining <= 0)
      .map(([index]) => Number(index))
    if (!expiredIndexes.length) return
    expiredIndexes.forEach((index) => {
      const secret = form.custom_fields[index]?.value
      if (secret) void previewFieldTotp(index, secret)
    })
  }, [fieldTotpPreviews, form.custom_fields])

  // In read-only mode nothing else asks for a code, so a saved secret generates its own as soon as the
  // item is selected. While editing, the secret is half-typed and every keystroke would fail to decode,
  // so the field row keeps its explicit preview button instead.
  useEffect(() => {
    if (isEditing) return
    const pendingIndexes = otpFieldIndexes.filter((index) => !fieldTotpPreviews[index])
    if (!pendingIndexes.length) return
    for (const index of pendingIndexes) {
      const secret = form.custom_fields[index]?.value
      if (secret) void previewFieldTotp(index, secret, true)
    }
  }, [fieldTotpPreviews, form.custom_fields, isEditing, otpFieldIndexes])

  async function previewFieldTotp(index: number, secret: string, silent = false) {
    if (!secret.trim()) return
    if (!silent) setError(null)
    try {
      const code = await vaultApi.generateTotp(secret)
      setFieldTotpPreviews((current) => ({
        ...current,
        [index]: {
          code: code.code,
          secondsRemaining: code.seconds_remaining,
        },
      }))
    } catch (nextError) {
      // A secret that no longer decodes should not stop the detail view from opening; the card has no
      // code to show until it is fixed, and opening an item is not an error.
      if (!silent) setError(describeError(nextError))
    }
  }

  return { fieldTotpPreviews, previewFieldTotp, setFieldTotpPreviews }
}
