import { type FormEvent, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultTagColor, tagColorLabelKey, tagColorOptions, tagIconOptions } from './tagIcons'

export type StyleDraft = { color: string; icon: string; name: string }

// A tag and a vault are styled by the same three choices — a name, one of the shared glyph set, one of
// the accent hues — so the dialog offering them is one component rather than two grids that can drift apart.
export function StyleEditorDialog({
  draft,
  nameLabel,
  onCancel,
  onDraftChange,
  onSubmit,
  title,
  titleId,
}: {
  draft: StyleDraft
  nameLabel: string
  onCancel: () => void
  onDraftChange: (patch: Partial<StyleDraft>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  title: string
  titleId: string
}) {
  const { t } = useTranslation()
  const nameInputRef = useRef<HTMLInputElement>(null)

  // The dialog mounts when the row is opened, so this runs once per edit: typing in the name — or
  // picking an icon — must not drag the caret back to the field every keystroke.
  useEffect(() => {
    nameInputRef.current?.focus()
  }, [])

  return (
    <div className="confirm-layer">
      <button aria-label={t('common.close')} className="confirm-backdrop" onClick={onCancel} type="button" />
      <div aria-labelledby={titleId} aria-modal="true" className="confirm-dialog" role="dialog">
        <h2 id={titleId}>{title}</h2>
        <form onSubmit={onSubmit}>
          <label>
            {nameLabel}
            <input
              onChange={(event) => onDraftChange({ name: event.target.value })}
              ref={nameInputRef}
              type="text"
              value={draft.name}
            />
          </label>
          <fieldset className="tag-icon-picker">
            <legend>{t('vault.tagIcon')}</legend>
            <div className="tag-icon-grid">
              {tagIconOptions.map((option) => (
                <button
                  aria-label={t(`tagIcons.${option.name}`)}
                  aria-pressed={draft.icon === option.name}
                  className="tag-icon-option"
                  key={option.name}
                  onClick={() => onDraftChange({ icon: option.name })}
                  type="button"
                >
                  <option.icon aria-hidden="true" size={16} />
                </button>
              ))}
            </div>
          </fieldset>
          {/* Tags are one of the places a system hue stands for itself rather than for a status, so the
              picker offers every hue and "none" alongside it. */}
          <fieldset className="tag-color-picker">
            <legend>{t('vault.tagColor')}</legend>
            <div className="tag-color-row">
              {tagColorOptions.map((option) => (
                <button
                  aria-label={t(tagColorLabelKey(option.name))}
                  aria-pressed={draft.color === option.name}
                  className={`tag-color-option ${option.swatchClass}`}
                  key={option.name === defaultTagColor ? 'none' : option.name}
                  onClick={() => onDraftChange({ color: option.name })}
                  type="button"
                />
              ))}
            </div>
          </fieldset>
          <div className="confirm-actions">
            <button className="secondary-button" onClick={onCancel} type="button">
              {t('vault.cancelEditing')}
            </button>
            <button className="primary-button" disabled={!draft.name.trim()} type="submit">
              {t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
