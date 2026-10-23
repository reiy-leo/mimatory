import type { Dispatch, SetStateAction } from 'react'
import { useMemo } from 'react'
import type { useTranslation as useTranslationType } from 'react-i18next'
import type { AddMoreFieldType } from './addMoreOptions'
import {
  type Container,
  type ContainerLists,
  canEnter,
  keyboardTarget,
  moveFieldEntry,
  type Slot,
} from './fieldReorder'
import { type ReorderControl, useFieldDrag } from './fieldRows'
import { applyDerivedValues, newSectionChild, parseSectionChildren, stringifySectionChildren } from './itemFields'
import { addTag, removeTag, tagList } from './itemTags'
import { type CustomField, customFieldsToInput, type ItemUrl } from './vaultApi'
import { defaultUrlMatchType, defaultWebsiteLabel, type LoginFormState, toUrlFormState } from './vaultModel'

/**
 * The editor's changes to the open form: websites, fields and section children, drag / keyboard reorder, tag
 * chips (moved out of App.tsx 2026-10-23). Every change goes through setForm; nothing here writes the vault.
 */
export function useItemFormFields({
  detailCustomFields,
  detailFieldIndexes,
  form,
  inCredentialBlock,
  loginSectionFields,
  setForm,
  setSectionMenuIndex,
  setTagDraft,
  t,
  tagDraft,
}: {
  detailCustomFields: Array<{ field: CustomField; index: number }>
  detailFieldIndexes: number[]
  form: LoginFormState
  inCredentialBlock: (field: CustomField) => boolean
  loginSectionFields: Array<{ field: CustomField; index: number }>
  setForm: Dispatch<SetStateAction<LoginFormState>>
  setSectionMenuIndex: Dispatch<SetStateAction<number | null>>
  setTagDraft: Dispatch<SetStateAction<string>>
  t: ReturnType<typeof useTranslationType>['t']
  tagDraft: string
}) {
  // The chip box is a view of `tagsInput`, so committing only rewrites that one string. Leaving the
  // field with a half-typed tag still saves it, because the tag was never in a separate place.
  function commitTagDraft() {
    const pending = tagDraft.trim()
    if (!pending) return
    setForm((current) => ({ ...current, tagsInput: addTag(current.tagsInput, pending) }))
    setTagDraft('')
  }

  function removeLastTag() {
    const tags = tagList(form.tagsInput)
    const last = tags[tags.length - 1]
    if (!last) return
    setForm((current) => ({ ...current, tagsInput: removeTag(current.tagsInput, last) }))
  }

  function updateUrl(index: number, patch: Partial<ItemUrl>) {
    setForm((current) => ({
      ...current,
      urlsInput: current.urlsInput.map((itemUrl, itemIndex) =>
        itemIndex === index ? { ...itemUrl, ...patch } : itemUrl,
      ),
    }))
  }

  function addWebsite() {
    setForm((current) => ({
      ...current,
      urlsInput: [
        ...current.urlsInput,
        toUrlFormState({ label: defaultWebsiteLabel, match_type: defaultUrlMatchType, url: '' }),
      ],
    }))
  }

  function removeWebsite(index: number) {
    setForm((current) => {
      if (current.urlsInput.length <= 1) return current
      const urlsInput = current.urlsInput.filter((_, itemIndex) => itemIndex !== index)
      return {
        ...current,
        urlsInput,
      }
    })
  }

  function updateCustomField(index: number, patch: Partial<CustomField>) {
    setForm((current) => {
      const customFields = current.custom_fields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field,
      )
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  function updateSectionChild(sectionIndex: number, childIndex: number, patch: Partial<CustomField>) {
    setForm((current) => {
      const customFields = current.custom_fields.map((field, fieldIndex) => {
        if (fieldIndex !== sectionIndex) return field
        const sectionFields = parseSectionChildren(field.value)
        const changed = sectionFields[childIndex]
        const nextSectionFields = sectionFields.map((child, index) =>
          index === childIndex ? { ...child, ...patch } : child,
        )
        // A card number names its network and a public key its type, filled into an empty sibling.
        const derived =
          changed && patch.value !== undefined
            ? applyDerivedValues(current.item_type, sectionFields, nextSectionFields, changed.id)
            : nextSectionFields
        return { ...field, value: stringifySectionChildren(derived) }
      })
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  // A field just added is named first (1Password focuses the new row's label), in whichever list it landed.
  function focusNewLabel(container: string) {
    window.setTimeout(() => {
      const labels = document.querySelectorAll<HTMLInputElement>(
        `[data-reorder-container="${container}"] .field-row-label-input`,
      )
      const label = labels[labels.length - 1]
      label?.focus()
      label?.select()
    }, 0)
  }

  function addSectionChild(sectionIndex: number, fieldType: AddMoreFieldType) {
    setSectionMenuIndex(null)
    focusNewLabel(`section:${sectionIndex}`)
    setForm((current) => {
      const customFields = current.custom_fields.map((field, fieldIndex) => {
        if (fieldIndex !== sectionIndex) return field
        const sectionFields = parseSectionChildren(field.value)
        return {
          ...field,
          value: stringifySectionChildren([
            ...sectionFields,
            newSectionChild(fieldType, t(`vault.customFieldDefaults.${fieldType}`)),
          ]),
        }
      })
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  function removeSectionChild(sectionIndex: number, childIndex: number) {
    setForm((current) => {
      const customFields = current.custom_fields.map((field, fieldIndex) => {
        if (fieldIndex !== sectionIndex) return field
        const nextSectionFields = parseSectionChildren(field.value).filter((_, index) => index !== childIndex)
        return { ...field, value: stringifySectionChildren(nextSectionFields) }
      })
      return {
        ...current,
        custom_fields: customFields,
        customFieldsInput: customFieldsToInput(customFields),
      }
    })
  }

  const fieldLists = useMemo<ContainerLists>(
    () => ({ login: loginSectionFields.map(({ index }) => index), top: detailFieldIndexes }),
    [loginSectionFields, detailFieldIndexes],
  )
  // Loose top-level fields between sections share one card, the way 1Password groups them.
  const editTopRuns = useMemo(() => {
    const runs: Array<
      | { entries: Array<{ field: CustomField; index: number; position: number }>; kind: 'fields' }
      | { entry: { field: CustomField; index: number; position: number }; kind: 'section' }
    > = []
    detailCustomFields.forEach(({ field, index }, position) => {
      if (field.field_type === 'section') {
        runs.push({ entry: { field, index, position }, kind: 'section' })
        return
      }
      const last = runs[runs.length - 1]
      if (last?.kind === 'fields') last.entries.push({ field, index, position })
      else runs.push({ entries: [{ field, index, position }], kind: 'fields' })
    })
    return runs
  }, [detailCustomFields])

  function applyFieldMove(from: Slot, to: Slot) {
    setForm((current) => {
      const lists: ContainerLists = {
        login: current.custom_fields.flatMap((field, index) => (inCredentialBlock(field) ? [index] : [])),
        top: current.custom_fields.flatMap((field, index) => (inCredentialBlock(field) ? [] : [index])),
      }
      const customFields = moveFieldEntry(current.custom_fields, lists, from, to)
      if (!customFields) return current
      return { ...current, custom_fields: customFields, customFieldsInput: customFieldsToInput(customFields) }
    })
  }

  function moveUrl(from: number, to: number) {
    setForm((current) => {
      if (to < 0 || to >= current.urlsInput.length || from === to) return current
      const urlsInput = [...current.urlsInput]
      const [moved] = urlsInput.splice(from, 1)
      urlsInput.splice(to, 0, moved)
      return { ...current, urlsInput }
    })
  }

  // After a keyboard move the row is drawn somewhere else; its handle keeps the focus.
  function focusHandle(container: string, index: number) {
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          `[data-reorder-container="${container}"][data-reorder-index="${index}"] .field-reorder-handle`,
        )
        ?.focus(),
    )
  }

  const fieldDrag = useFieldDrag((source, to) => {
    if (source.container === 'urls') moveUrl(source.index, to.index)
    else applyFieldMove(source as Slot, to as Slot)
  })

  /** Template children stay in their own section: the template finds them there by key. */
  function reorderFor(container: string, index: number, fieldType: string, pinned = false): ReorderControl {
    return {
      container,
      dragging: fieldDrag.dragging?.container === container && fieldDrag.dragging.index === index,
      index,
      onKeyboardMove: (delta) => {
        if (container === 'urls') {
          moveUrl(index, index + delta)
          focusHandle(container, index + delta)
          return
        }
        const from = { container, index } as Slot
        const target = keyboardTarget(form.custom_fields, fieldLists, from, delta)
        if (!target || (pinned && target.container !== container)) return
        applyFieldMove(from, target)
        focusHandle(target.container, target.index)
      },
      onPointerDown: (event) =>
        fieldDrag.begin(event, {
          accepts: (target) =>
            container === 'urls'
              ? target === 'urls'
              : target !== 'urls' &&
                (pinned ? target === container : canEnter(fieldType, container as Container, target as Container)),
          container,
          index,
        }),
    }
  }

  return {
    addSectionChild,
    addWebsite,
    applyFieldMove,
    commitTagDraft,
    editTopRuns,
    fieldDrag,
    fieldLists,
    focusHandle,
    focusNewLabel,
    moveUrl,
    removeLastTag,
    removeSectionChild,
    removeWebsite,
    reorderFor,
    updateCustomField,
    updateSectionChild,
    updateUrl,
  }
}
