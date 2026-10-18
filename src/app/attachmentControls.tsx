import { Check, Copy, Eye, Paperclip } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { AttachmentText, CustomField } from './vaultApi'

/**
 * Attachment rows (owner, 2026-10-18): an attachment, once added, is never replaced — only removed — so a stored
 * row carries no "change attachment" button; a `.txt` attachment opens a read-only preview sheet instead of only
 * offering Export. The text is decrypted and decoded by Rust in memory (`read_attachment_text`), never written to
 * disk the way Export's temp copy is.
 */

const attachmentScheme = 'attachment://'

/** File types the preview sheet shows. Plain text only: anything else keeps Export. */
export const textPreviewExtensions = ['txt'] as const

/** The stored attachment's id, or null for a draft row still holding a local path (or nothing). */
export function attachmentId(value: string): string | null {
  return value.startsWith(attachmentScheme) ? value.slice(attachmentScheme.length) || null : null
}

/** Whether a row is a stored plain-text attachment: its label (Rust sets it to the file name) ends in `.txt`. */
export function isTextPreviewable(field: Pick<CustomField, 'field_type' | 'label' | 'value'>): boolean {
  if (field.field_type !== 'file' || !attachmentId(field.value)) return false
  const name = field.label.trim().toLowerCase()
  return textPreviewExtensions.some((extension) => name.endsWith(`.${extension}`))
}

/** "12.3 KB" style sizes for the truncation note, in the user's locale. */
export function formatByteSize(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`
}

export type AttachmentEditActionsProps = {
  field: Pick<CustomField, 'field_type' | 'label' | 'value'>
  onChoose: () => void
  onExport: () => void
  onPreview: () => void
}

/**
 * The trailing buttons of an attachment row in the editor, before its remove button: Preview (a `.txt`), Export
 * (anything stored). Choose appears only on a row that holds no file yet — never on one that does.
 */
export function AttachmentEditActions({ field, onChoose, onExport, onPreview }: AttachmentEditActionsProps) {
  const { t } = useTranslation()
  const stored = attachmentId(field.value) !== null
  return (
    <>
      {isTextPreviewable(field) ? (
        <button
          aria-label={t('attachments.previewNamed', { name: field.label.trim() })}
          className="field-type-button"
          data-attachment-action="preview"
          onClick={onPreview}
          title={t('attachments.preview')}
          type="button"
        >
          <Eye aria-hidden="true" size={18} />
        </button>
      ) : null}
      {stored ? (
        <button className="field-text-button" data-attachment-action="export" onClick={onExport} type="button">
          {t('vault.exportAttachment')}
        </button>
      ) : null}
      {field.value ? null : (
        <button
          aria-label={t('vault.chooseAttachment')}
          className="field-type-button"
          data-attachment-action="choose"
          onClick={onChoose}
          title={t('vault.chooseAttachment')}
          type="button"
        >
          <Paperclip aria-hidden="true" size={18} />
        </button>
      )}
    </>
  )
}

export type TextPreviewState =
  | { fileName: string; status: 'loading' }
  | { fileName: string; result: AttachmentText; status: 'ready' }
  | { error: string; fileName: string; status: 'error' }

export type TextPreviewDialogProps = {
  onClose: () => void
  /** Copies the shown text; resolves true when it reached the clipboard. */
  onCopy: (text: string) => Promise<boolean>
  state: TextPreviewState
}

/**
 * The preview sheet: the file name as its title, the text read-only in a scrolling monospace well, a note when
 * the file was cut or had bytes that are not UTF-8, Copy and Done. A sheet (`sheets.md`) on the shared
 * `.confirm-layer` recipe, rendered in a portal with its own Escape handling so no flag in `VaultWindow`'s dismiss
 * effect is needed.
 */
export function TextPreviewDialog({ onClose, onCopy, state }: TextPreviewDialogProps) {
  const { i18n, t } = useTranslation()
  const titleId = useId()
  const doneRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    doneRef.current?.focus()
    // The text well is not a focus stop (a <pre> is not interactive), so the sheet scrolls it from the keyboard
    // wherever focus sits among its buttons: arrows, Page Up/Down, Home/End.
    const scrollKeys: Record<string, (well: HTMLPreElement) => number> = {
      ArrowDown: () => 40,
      ArrowUp: () => -40,
      End: (well) => well.scrollHeight,
      Home: (well) => -well.scrollHeight,
      PageDown: (well) => well.clientHeight * 0.9,
      PageUp: (well) => -well.clientHeight * 0.9,
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      const well = bodyRef.current
      const step = scrollKeys[event.key]
      if (!well || !step || event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      well.scrollBy({ top: step(well) })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  let body: ReactNode
  const notes: string[] = []
  if (state.status === 'loading') {
    body = <p className="text-preview-status">{t('attachments.loading')}</p>
  } else if (state.status === 'error') {
    body = <p className="text-preview-status is-error">{state.error}</p>
  } else {
    const { result } = state
    if (result.truncated) {
      notes.push(
        t('attachments.truncated', {
          shown: formatByteSize(new TextEncoder().encode(result.text).length, i18n.language),
          total: formatByteSize(result.total_bytes, i18n.language),
        }),
      )
    }
    if (result.lossy) notes.push(t('attachments.lossy'))
    body = result.text ? (
      // A <pre> rather than a disabled textarea: it reads as content and scrolls both ways. Selection stays off
      // like everywhere else in the app (AGENTS.md › "No text selection"); Copy is the explicit way out.
      <pre className="text-preview-body" ref={bodyRef}>
        {result.text}
      </pre>
    ) : (
      <p className="text-preview-status">{t('attachments.empty')}</p>
    )
  }

  return createPortal(
    <div className="confirm-layer text-preview-layer">
      <button aria-label={t('common.close')} className="confirm-backdrop" onClick={onClose} type="button" />
      <div aria-labelledby={titleId} aria-modal="true" className="confirm-dialog text-preview-dialog" role="dialog">
        <h2 className="text-preview-title" id={titleId} title={state.fileName}>
          {state.fileName}
        </h2>
        {body}
        {notes.map((note) => (
          <p className="text-preview-note" key={note}>
            {note}
          </p>
        ))}
        <div className="confirm-actions">
          {state.status === 'ready' && state.result.text ? (
            <button
              className="secondary-button"
              onClick={() => {
                void onCopy(state.result.text).then((ok) => setCopied(ok))
              }}
              type="button"
            >
              {copied ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
              {copied ? t('fieldActions.copied') : t('fieldActions.copy')}
            </button>
          ) : null}
          <button className="primary-button" onClick={onClose} ref={doneRef} type="button">
            {t('attachments.done')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
