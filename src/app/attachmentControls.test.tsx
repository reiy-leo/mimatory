import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AttachmentEditActions, attachmentId, formatByteSize, isTextPreviewable } from './attachmentControls'
import './i18n'

const noop = () => {}

function editActions(field: { field_type: string; label: string; value: string }) {
  return renderToStaticMarkup(<AttachmentEditActions field={field} onChoose={noop} onExport={noop} onPreview={noop} />)
}

function actionsIn(markup: string) {
  return [...markup.matchAll(/data-attachment-action="([a-z]+)"/g)].map((match) => match[1])
}

describe('attachment rows', () => {
  it('reads the stored attachment id and leaves a draft path alone', () => {
    expect(attachmentId('attachment://abc-123')).toBe('abc-123')
    expect(attachmentId('attachment://')).toBeNull()
    expect(attachmentId('/Users/rei/notes.txt')).toBeNull()
    expect(attachmentId('')).toBeNull()
  })

  it('previews stored .txt attachments only', () => {
    const stored = { field_type: 'file', label: 'notes.txt', value: 'attachment://1' }
    expect(isTextPreviewable(stored)).toBe(true)
    expect(isTextPreviewable({ ...stored, label: '  README.TXT ' })).toBe(true)
    expect(isTextPreviewable({ ...stored, label: 'photo.png' })).toBe(false)
    expect(isTextPreviewable({ ...stored, label: 'notes.txt.pdf' })).toBe(false)
    expect(isTextPreviewable({ ...stored, label: 'txt' })).toBe(false)
    // Not stored yet (a new item's draft holds a local path), or not an attachment at all.
    expect(isTextPreviewable({ ...stored, value: '/tmp/notes.txt' })).toBe(false)
    expect(isTextPreviewable({ ...stored, field_type: 'text' })).toBe(false)
  })

  it('never offers to replace an attachment once it holds a file', () => {
    expect(actionsIn(editActions({ field_type: 'file', label: 'scan.pdf', value: 'attachment://1' }))).toEqual([
      'export',
    ])
    expect(actionsIn(editActions({ field_type: 'file', label: 'notes.txt', value: 'attachment://2' }))).toEqual([
      'preview',
      'export',
    ])
    // A draft row already holding a local file: nothing to export yet, and still nothing to swap it for.
    expect(actionsIn(editActions({ field_type: 'file', label: 'notes.txt', value: '/tmp/notes.txt' }))).toEqual([])
    // Only an empty row asks for a file.
    expect(actionsIn(editActions({ field_type: 'file', label: '', value: '' }))).toEqual(['choose'])
  })

  it('formats byte counts for the truncation note', () => {
    expect(formatByteSize(512, 'en')).toBe('512 B')
    expect(formatByteSize(256 * 1024, 'en')).toBe('256 KB')
    expect(formatByteSize(1536, 'en')).toBe('1.5 KB')
    expect(formatByteSize(3 * 1024 * 1024, 'en')).toBe('3 MB')
  })
})
