import { parseTags } from './vaultApi'

type DraftField = { field_type: string; label: string; value: string }
type DraftUrl = { label: string; url: string }

// The subset `toInput` actually writes, in the shape it writes it. Comparing this instead of
// the raw form means a keystroke that saves nothing different — a trailing space in the title,
// a re-tagged comma — is not reported as an unsaved edit.
export type DraftSnapshot = {
  custom_fields: DraftField[]
  favorite: boolean
  item_type: string
  notes: string
  password: string
  tagsInput: string
  title: string
  urlsInput: DraftUrl[]
  username: string
}

export function formFingerprint(form: DraftSnapshot): string {
  return JSON.stringify({
    custom_fields: form.custom_fields.map((field) => [field.field_type, field.label, field.value]),
    favorite: form.favorite,
    item_type: form.item_type,
    notes: form.notes,
    password: form.password,
    tags: parseTags(form.tagsInput),
    title: form.title.trim(),
    urls: form.urlsInput.map((url) => [url.label.trim(), url.url.trim()]).filter(([, url]) => url),
    username: form.username.trim(),
  })
}

export function isFormDirty(baseline: DraftSnapshot, form: DraftSnapshot): boolean {
  return formFingerprint(baseline) !== formFingerprint(form)
}
