import { CircleMinus, Eye, EyeOff, Paperclip, Plus, Star, X } from 'lucide-react'
import { AddMoreControl } from './addMoreMenu'
import { AttachmentEditActions } from './attachmentControls'
import { FieldEditor, SshFingerprintCaption } from './fieldControls'
import { AddRowButton, AutofillBehaviorButton, EditFieldRow, EditSectionCard } from './fieldRows'
import { childDisplayLabel, parseSectionChildren, sectionDisplayTitle } from './itemFields'
import { ItemIcon } from './itemIcon'
import { ItemIconMenuButton } from './itemIconMenu'
import { relationRef } from './itemRelations'
import { addTag, removeTag, tagList } from './itemTags'
import { findTemplateField, sshFingerprintLabelKey } from './itemTemplates'
import { OtpScanButton } from './otpFieldView'
import { PasskeyRow, passkeyCreatedAt } from './passkeyRow'
import { PasswordGeneratorButton } from './passwordGeneratorPopover'
import { RelationSection } from './relationControls'
import { SignInRow } from './signInControls'
import { parseSignInProvider } from './signInProviders'
import { formatOtpSecret, parseOtpSecretInput } from './totpDisplay'
import type { VaultWindowModel } from './useVaultWindow'
import type { CustomField } from './vaultApi'
import {
  defaultWebsiteLabel,
  fieldLabels,
  fieldValuePlaceholderKey,
  fileNameFromPath,
  specialFieldTypes,
  templateFieldMeta,
} from './vaultModel'

/** The item editor: header, credentials, websites, fields and sections, tags, notes, attachments. */
export function ItemEditForm({ vw }: { vw: VaultWindowModel }) {
  const {
    addCustomField,
    addOtpField,
    addSectionChild,
    addWebsite,
    chooseAttachmentForField,
    closeFieldMenus,
    commitTagDraft,
    editChildRefs,
    editParentRefs,
    editRelatedRefs,
    editTopRuns,
    features,
    fieldDrag,
    focusedOtpField,
    form,
    generateFieldPassword,
    handleFavorite,
    handleOtpPaste,
    handleSave,
    handleUseGeneratedPassword,
    hasSignInField,
    headerArt,
    iconChoices,
    importOtpQrImage,
    isDraggingFiles,
    isEditing,
    isMobileLayout,
    items,
    loginSectionFields,
    measurePassword,
    openAttachment,
    openRelationPicker,
    openSignInPicker,
    openTextPreview,
    otpFileInputRef,
    otpFileTarget,
    otpInputRefs,
    passwordLabel,
    relationIcon,
    relationTypeLabel,
    removeCustomField,
    removeLastTag,
    removeRelation,
    removeSectionChild,
    removeWebsite,
    reorderFor,
    scanOtpQr,
    sectionMenuIndex,
    selectedItem,
    setFocusedOtpField,
    setForm,
    setShowPassword,
    setTagDraft,
    showAddMore,
    showCredentials,
    showPassword,
    showUsername,
    showWebsites,
    t,
    tagDraft,
    template,
    toggleAddMoreMenu,
    toggleSectionMenu,
    updateCustomField,
    updateSectionChild,
    updateUrl,
    usernameLabel,
  } = vw

  function fieldLabelOf(field: CustomField) {
    return field.label.trim() || t(`vault.customFieldDefaults.${field.field_type}`)
  }

  function renderEditField(field: CustomField, index: number, container: 'login' | 'top', position: number) {
    const label = fieldLabelOf(field)
    const labelInput =
      field.field_type === 'sign_in_with'
        ? undefined
        : {
            onChange: (value: string) => updateCustomField(index, { label: value }),
            placeholder: t(`vault.customFieldDefaults.${field.field_type}`),
            value: field.label,
          }
    const key = `field-${container}-${field.field_type}-${index}`
    const common = {
      drop: fieldDrag.dropAt(container, position),
      label,
      labelInput,
      onRemove: () => removeCustomField(index),
      // The credential card's rows sit in a fixed order: nothing there has a handle.
      reorder: container === 'login' ? undefined : reorderFor(container, position, field.field_type),
    }

    if (field.field_type === 'passkey') {
      // Made by the extension, never typed: neither the label nor the value is editable, only removable.
      return (
        <div className="field-slot" key={key}>
          <PasskeyRow
            actions={
              <button
                aria-label={t('vault.removeField')}
                className="field-remove-button"
                onClick={() => removeCustomField(index)}
                title={t('vault.removeField')}
                type="button"
              >
                <CircleMinus aria-hidden="true" size={18} />
              </button>
            }
            createdAt={passkeyCreatedAt(field, form.custom_fields, selectedItem?.created_at)}
            editing
            field={field}
          />
        </div>
      )
    }
    if (field.field_type === 'sign_in_with') {
      return (
        <EditFieldRow
          key={key}
          {...common}
          trailing={
            <button className="field-text-button" onClick={openSignInPicker} type="button">
              {t('vault.signIn.change')}
            </button>
          }
        >
          <SignInRow
            account={
              form.relationDraft.signInId
                ? relationRef(form.relationDraft.signInId, items, selectedItem?.relations)
                : null
            }
            accountDetail={items.find((item) => item.id === form.relationDraft.signInId)?.username}
            provider={parseSignInProvider(field.value)}
          />
        </EditFieldRow>
      )
    }
    if (field.field_type === 'otp') {
      // 1Password's editor: the key itself, in lowercase groups of four while it is being edited. At rest it is
      // dots (AGENTS.md › "The TOTP seed rests masked"); what is stored is the normalized key.
      const focused = focusedOtpField === `otp:${index}`
      return (
        <EditFieldRow
          key={key}
          {...common}
          trailing={<OtpScanButton label={label} onScan={() => void scanOtpQr(index)} />}
        >
          <input
            aria-label={label}
            autoComplete="off"
            className="field-row-input is-mono"
            onBlur={() => setFocusedOtpField('')}
            onChange={(event) => updateCustomField(index, { value: parseOtpSecretInput(event.target.value) })}
            onFocus={() => setFocusedOtpField(`otp:${index}`)}
            onPaste={(event) => handleOtpPaste(index, event)}
            placeholder={t('vault.otpSecretPlaceholder')}
            ref={(node) => {
              otpInputRefs.current[index] = node
            }}
            spellCheck={false}
            type={focused || !field.value ? 'text' : 'password'}
            value={focused ? formatOtpSecret(field.value) : field.value}
          />
        </EditFieldRow>
      )
    }
    if (field.field_type === 'file') {
      return (
        <EditFieldRow
          key={key}
          {...common}
          // An attachment is never replaced once added, only removed (owner, 2026-10-18).
          trailing={
            <AttachmentEditActions
              field={field}
              onChoose={() => void chooseAttachmentForField(index)}
              onExport={() => void openAttachment(field)}
              onPreview={() => void openTextPreview(field)}
            />
          }
        >
          <span className="field-row-value" title={field.value}>
            {field.value ? fileNameFromPath(field.value) : t('vault.chooseAttachment')}
          </span>
        </EditFieldRow>
      )
    }
    if (field.field_type === 'related_item') {
      return (
        <EditFieldRow key={key} {...common}>
          <select
            aria-label={label}
            className="field-select"
            onChange={(event) => updateCustomField(index, { value: event.target.value })}
            value={field.value}
          >
            <option value="">{t('vault.chooseRelatedItem')}</option>
            {items
              .filter((item) => item.id !== selectedItem?.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
          </select>
        </EditFieldRow>
      )
    }
    if (specialFieldTypes.includes(field.field_type)) {
      return (
        <EditFieldRow key={key} {...common}>
          <input
            aria-label={label}
            autoComplete="off"
            className="field-row-input"
            onChange={(event) => updateCustomField(index, { value: event.target.value })}
            placeholder={t(fieldValuePlaceholderKey(field.field_type))}
            spellCheck={false}
            value={field.value}
          />
        </EditFieldRow>
      )
    }
    return (
      <EditFieldRow key={key} {...common}>
        <FieldEditor
          fieldType={field.field_type}
          label={label}
          measureStrength={field.field_type === 'password' ? measurePassword : undefined}
          onChange={(value) => updateCustomField(index, { value })}
          onGenerate={generateFieldPassword}
          placeholder={t(fieldValuePlaceholderKey(field.field_type))}
          value={field.value}
        />
      </EditFieldRow>
    )
  }

  function renderEditSection(field: CustomField, index: number, position: number) {
    const container = `section:${index}`
    const children = parseSectionChildren(field.value)
    // The category's own section: its fields empty out rather than go away, and so does the section.
    const templateSection = children.some((child) => findTemplateField(form.item_type, child.key))
    const title = sectionDisplayTitle(form.item_type, field, fieldLabels)
    const drop = fieldDrag.dropAt('top', position)
    return (
      <div
        className={['field-section', 'is-edit', drop ? `is-drop-${drop}` : ''].filter(Boolean).join(' ')}
        data-reorder-container="top"
        data-reorder-index={position}
        key={`section-${index}`}
      >
        <EditSectionCard
          addMore={
            <AddMoreControl
              attachments={features.attachments}
              context="section"
              dropIndicator={fieldDrag.dropAt(container, children.length)}
              dropZone={{ container, index: children.length }}
              onPick={(entry) => {
                if (entry.kind === 'field') addSectionChild(index, entry.id)
              }}
              onToggle={() => toggleSectionMenu(index)}
              open={sectionMenuIndex === index}
              sheet={isMobileLayout}
            />
          }
        >
          <EditFieldRow
            className="is-section-header"
            label={title || t('vault.sectionName')}
            labelHidden
            onRemove={templateSection ? undefined : () => removeCustomField(index)}
            removeLabel={t('fieldRows.removeSection')}
            reorder={reorderFor('top', position, 'section')}
          >
            <input
              aria-label={t('vault.sectionName')}
              className="field-row-input section-name-input"
              onChange={(event) => updateCustomField(index, { label: event.target.value })}
              placeholder={templateSection ? title : t('vault.sectionName')}
              spellCheck={false}
              value={field.label}
            />
          </EditFieldRow>
          {children.map((child, childIndex) => {
            const templateField = findTemplateField(form.item_type, child.key)
            const childLabel = child.label.trim() || t(`vault.customFieldDefaults.${child.field_type}`)
            return (
              <EditFieldRow
                drop={fieldDrag.dropAt(container, childIndex)}
                key={child.id ?? childIndex}
                label={templateField ? childDisplayLabel(form.item_type, child, fieldLabels) : childLabel}
                labelInput={
                  templateField
                    ? undefined
                    : {
                        onChange: (value) => updateSectionChild(index, childIndex, { label: value }),
                        placeholder: t(`vault.customFieldDefaults.${child.field_type}`),
                        value: child.label,
                      }
                }
                // A template field is part of the category; left empty it is hidden when viewing and not
                // stored, so there is nothing to remove.
                onRemove={templateField ? undefined : () => removeSectionChild(index, childIndex)}
                reorder={reorderFor(container, childIndex, child.field_type, Boolean(templateField))}
              >
                <FieldEditor
                  fieldType={child.field_type}
                  footer={
                    child.key === 'publicKey' && form.item_type === 'ssh_key' ? (
                      <SshFingerprintCaption label={t(sshFingerprintLabelKey)} publicKey={child.value} />
                    ) : null
                  }
                  label={childLabel}
                  measureStrength={child.field_type === 'password' ? measurePassword : undefined}
                  meta={templateFieldMeta(templateField)}
                  onChange={(value) => updateSectionChild(index, childIndex, { value })}
                  onGenerate={generateFieldPassword}
                  placeholder={t(fieldValuePlaceholderKey(child.field_type))}
                  value={child.value}
                />
              </EditFieldRow>
            )
          })}
        </EditSectionCard>
      </div>
    )
  }
  return (
    <form className="detail-form" id="item-detail-form" onSubmit={handleSave}>
      <fieldset className="detail-fieldset" disabled={!isEditing} onScroll={closeFieldMenus}>
        {/* 1Password 8's edit header (owner 2026-10-18): a 60pt icon with a chevron badge for the icon
                    choices, the title in a filled field beside it. */}
        <div className="detail-header is-edit">
          <div className="item-icon-well">
            <ItemIcon
              className="large-icon"
              fallback={headerArt}
              item={{
                icon_mode: selectedItem?.icon_mode,
                title: form.title,
                urls: selectedItem?.urls ?? [],
                website: selectedItem?.website ?? '',
              }}
              placeholder="+"
            />
            <ItemIconMenuButton choices={iconChoices} label={t('vault.siteIcon.menu')} />
          </div>
          <input
            aria-label={t('vault.loginTitle')}
            className="title-input is-filled"
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            placeholder={selectedItem ? t('vault.loginTitle') : t('vault.newLoginItem')}
            value={form.title}
          />
          <button
            aria-label={t('vault.favorite')}
            className={form.favorite ? 'icon-button active' : 'icon-button'}
            onClick={handleFavorite}
            title={t('vault.favorite')}
            type="button"
          >
            <Star fill={form.favorite ? 'currentColor' : 'none'} size={16} />
          </button>
        </div>

        <div className="form-grid onepassword-form">
          {showCredentials ? (
            <div className="wide field-group is-edit">
              {showUsername ? (
                <EditFieldRow label={usernameLabel}>
                  <input
                    aria-label={usernameLabel}
                    autoComplete="off"
                    className="field-row-input"
                    onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                    spellCheck={false}
                    value={form.username}
                  />
                </EditFieldRow>
              ) : null}
              {/* A "Sign in with…" login has no password of its own; the row comes back as soon as
                          one is typed somewhere (or the sign-in method is removed). */}
              {!hasSignInField || form.password ? (
                <EditFieldRow
                  label={passwordLabel}
                  trailing={
                    <>
                      <button
                        aria-label={t('vault.showPassword')}
                        aria-pressed={showPassword}
                        className="field-type-button"
                        onClick={() => setShowPassword((value) => !value)}
                        title={t('vault.showPassword')}
                        type="button"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                      <PasswordGeneratorButton
                        className="field-type-button"
                        generate={generateFieldPassword}
                        iconSize={18}
                        label={t('vault.generatePassword')}
                        measure={measurePassword}
                        onUse={handleUseGeneratedPassword}
                      />
                    </>
                  }
                >
                  <input
                    aria-label={passwordLabel}
                    className="field-row-input"
                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder={t('vault.passwordPlaceholder')}
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                  />
                </EditFieldRow>
              ) : null}
              {loginSectionFields.map(({ field, index }, position) => renderEditField(field, index, 'login', position))}
              {template.otp && !loginSectionFields.some(({ field }) => field.field_type === 'otp') ? (
                // The template's one-time password slot. Nothing is stored until a secret is typed,
                // pasted or read from a QR code, at which point it becomes an ordinary OTP field.
                <EditFieldRow
                  label={t('vault.customFieldDefaults.otp')}
                  trailing={
                    <OtpScanButton
                      label={t('vault.customFieldDefaults.otp')}
                      onScan={() => void scanOtpQr(addOtpField())}
                    />
                  }
                >
                  <input
                    aria-label={t('vault.customFieldDefaults.otp')}
                    autoComplete="off"
                    className="field-row-input is-mono"
                    onChange={(event) => {
                      const value = parseOtpSecretInput(event.target.value)
                      const index = addOtpField()
                      updateCustomField(index, { value })
                      setFocusedOtpField(`otp:${index}`)
                      window.requestAnimationFrame(() => otpInputRefs.current[index]?.focus())
                    }}
                    placeholder={t('vault.otpSecretPlaceholder')}
                    spellCheck={false}
                    type="text"
                    value=""
                  />
                </EditFieldRow>
              ) : null}
            </div>
          ) : null}
          {showWebsites ? (
            <div className="wide field-group is-edit">
              {form.urlsInput.map((itemUrl, index) => {
                const label = itemUrl.label === defaultWebsiteLabel ? t('vault.website') : itemUrl.label
                return (
                  <EditFieldRow
                    drop={fieldDrag.dropAt('urls', index)}
                    key={itemUrl.id}
                    label={label}
                    labelInput={{
                      onChange: (value) => updateUrl(index, { label: value.trim() ? value : defaultWebsiteLabel }),
                      placeholder: t('vault.website'),
                      value: itemUrl.label === defaultWebsiteLabel ? '' : itemUrl.label,
                    }}
                    onRemove={() => removeWebsite(index)}
                    removeLabel={t('vault.removeWebsite')}
                    reorder={form.urlsInput.length > 1 ? reorderFor('urls', index, 'url') : undefined}
                    trailing={
                      <AutofillBehaviorButton
                        label={label}
                        mode={itemUrl.match_type}
                        onChange={(match_type) => updateUrl(index, { match_type })}
                        url={itemUrl.url}
                      />
                    }
                  >
                    <input
                      aria-label={label}
                      autoComplete="off"
                      className="field-row-input"
                      inputMode="url"
                      onChange={(event) => updateUrl(index, { url: event.target.value })}
                      placeholder="https://example.com"
                      spellCheck={false}
                      value={itemUrl.url}
                    />
                  </EditFieldRow>
                )
              })}
              <AddRowButton onClick={addWebsite}>
                <Plus aria-hidden="true" size={16} />
                {t('vault.addAnotherWebsite')}
              </AddRowButton>
            </div>
          ) : null}
          <div className="wide custom-fields-section">
            {editTopRuns.map((run) =>
              run.kind === 'fields' ? (
                <div className="field-group is-edit" key={`run-${run.entries[0]?.index}`}>
                  {run.entries.map(({ field, index, position }) => renderEditField(field, index, 'top', position))}
                </div>
              ) : (
                renderEditSection(run.entry.field, run.entry.index, run.entry.position)
              ),
            )}
            <AddMoreControl
              attachments={features.attachments}
              context="item"
              onPick={(entry) => {
                if (entry.kind === 'relation') openRelationPicker(entry.id)
                else void addCustomField(entry.id)
              }}
              onToggle={toggleAddMoreMenu}
              open={showAddMore}
              sheet={isMobileLayout}
            />
            {/* No standing drop hint (owner 2026-10-18: removed); the target appears only while files are dragged over. */}
            {isEditing && features.attachments && isDraggingFiles ? (
              <div className="attachment-dropzone is-active">
                <Paperclip aria-hidden="true" size={15} />
                <span>{t('vault.dropToAttachHere')}</span>
              </div>
            ) : null}
          </div>
          {editParentRefs.length || editChildRefs.length || editRelatedRefs.length ? (
            <div className="relation-editor">
              {(
                [
                  ['parent', 'vault.relations.parent', editParentRefs],
                  ['child', 'vault.relations.children', editChildRefs],
                  ['related', 'vault.relations.related', editRelatedRefs],
                ] as const
              ).map(([kind, headingKey, refs]) => (
                <RelationSection
                  archivedLabel={t('vault.relations.archived')}
                  heading={t(headingKey)}
                  iconFor={relationIcon}
                  key={kind}
                  onRemove={(ref) => removeRelation(kind, ref.id)}
                  refs={refs}
                  removeLabel={(title) => t('vault.relations.remove', { title })}
                  typeLabel={relationTypeLabel}
                />
              ))}
            </div>
          ) : null}
          <div className="wide field-group is-edit">
            <EditFieldRow label={t('vault.tags')}>
              <div className="tag-chip-box">
                {tagList(form.tagsInput).map((tag) => (
                  <span className="tag-chip" key={tag}>
                    <span>{tag}</span>
                    <button
                      aria-label={t('vault.removeTag', { tag })}
                      className="tag-chip-remove"
                      onClick={() =>
                        setForm((current) => ({ ...current, tagsInput: removeTag(current.tagsInput, tag) }))
                      }
                      type="button"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <input
                  aria-label={t('vault.addTag')}
                  className="tag-input"
                  onBlur={commitTagDraft}
                  onChange={(event) => {
                    const next = event.target.value
                    // A comma means a finished tag, whether it was typed or pasted, so it
                    // commits instead of sitting in the box as loose text.
                    if (next.includes(',')) {
                      setForm((current) => ({ ...current, tagsInput: addTag(current.tagsInput, next) }))
                      setTagDraft('')
                      return
                    }
                    setTagDraft(next)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitTagDraft()
                      return
                    }
                    if (event.key === 'Backspace' && !tagDraft) removeLastTag()
                  }}
                  placeholder={t('vault.addTag')}
                  value={tagDraft}
                />
              </div>
            </EditFieldRow>
          </div>
          <div className="wide field-group is-edit">
            <EditFieldRow label={t('vault.notes')}>
              <textarea
                aria-label={t('vault.notes')}
                className="field-row-input field-textarea"
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder={t('vault.notePlaceholder')}
                rows={3}
                value={form.notes}
              />
            </EditFieldRow>
          </div>
        </div>
        <input
          accept="image/*"
          aria-hidden="true"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file && otpFileTarget.current !== null) void importOtpQrImage(otpFileTarget.current, file)
          }}
          ref={otpFileInputRef}
          tabIndex={-1}
          type="file"
        />
      </fieldset>
    </form>
  )
}
