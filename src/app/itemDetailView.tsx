import { Star } from 'lucide-react'
import { isTextPreviewable } from './attachmentControls'
import { FieldView, SshFingerprintView } from './fieldControls'
import { autofillViewNote } from './fieldRows'
import { childDisplayLabel } from './itemFields'
import { ItemIcon } from './itemIcon'
import { tagList } from './itemTags'
import { findTemplateField, sshFingerprintLabelKey } from './itemTemplates'
import { OtpFieldView } from './otpFieldView'
import { PasskeyRow, passkeyCreatedAt } from './passkeyRow'
import { RelationSection } from './relationControls'
import { SignInRow } from './signInControls'
import { parseSignInProvider } from './signInProviders'
import type { VaultWindowModel } from './useVaultWindow'
import {
  defaultWebsiteLabel,
  fieldLabels,
  fileNameFromPath,
  itemTitleById,
  specialFieldTypes,
  templateFieldMeta,
} from './vaultModel'

/** The read-only item: header, credentials, websites, sections, links, tags, notes, dates. */
export function ItemDetailView({ vw }: { vw: VaultWindowModel }) {
  const {
    copyFieldTotp,
    copyFieldValue,
    copyTotpSecret,
    copyTotpSetupLink,
    features,
    fieldTotpPreviews,
    form,
    handleFavorite,
    headerArt,
    items,
    openAttachment,
    openItemWebsite,
    openRelatedItem,
    openTextPreview,
    passwordLabel,
    relationIcon,
    relationTypeLabel,
    revealAllSecure,
    selectedId,
    selectedItem,
    showUsername,
    signInLabel,
    t,
    usernameLabel,
    viewLoginFields,
    viewOtherFields,
    viewOtpIndexes,
    viewRelations,
    viewSections,
    viewWebsites,
  } = vw

  return (
    <div className="detail-view">
      <div className="detail-header">
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
        <h2 className="detail-title">{form.title}</h2>
        <button
          aria-label={t('vault.favorite')}
          aria-pressed={form.favorite}
          className={form.favorite ? 'icon-button active' : 'icon-button'}
          onClick={handleFavorite}
          title={t('vault.favorite')}
          type="button"
        >
          <Star fill={form.favorite ? 'currentColor' : 'none'} size={16} />
        </button>
      </div>
      {/* Keyed by item: a field revealed here goes back to hidden when another item opens. */}
      <div className="detail-view-body" key={selectedId ?? 'none'}>
        {(showUsername && form.username) || form.password || viewLoginFields.length || viewOtpIndexes.length ? (
          <div className="field-group">
            {showUsername && form.username ? (
              <FieldView fieldType="text" label={usernameLabel} onCopy={copyFieldValue} value={form.username} />
            ) : null}
            {form.password ? (
              <FieldView
                fieldType="password"
                label={passwordLabel}
                onCopy={copyFieldValue}
                revealAll={revealAllSecure}
                value={form.password}
              />
            ) : null}
            {viewLoginFields.map(({ field, index }) =>
              field.field_type === 'passkey' ? (
                <PasskeyRow
                  createdAt={passkeyCreatedAt(field, form.custom_fields, selectedItem?.created_at)}
                  field={field}
                  key={`login-view-${index}`}
                />
              ) : field.field_type === 'sign_in_with' ? (
                <SignInRow
                  account={viewRelations?.sign_in_with ?? null}
                  accountDetail={items.find((item) => item.id === viewRelations?.sign_in_with?.id)?.username}
                  key={`login-view-${index}`}
                  onOpen={(ref) => openRelatedItem(ref.id)}
                  provider={parseSignInProvider(field.value)}
                />
              ) : (
                <FieldView
                  fieldType="text"
                  key={`login-view-${index}`}
                  label={field.label.trim() || t(`vault.customFieldDefaults.${field.field_type}`)}
                  onCopy={copyFieldValue}
                  value={field.value}
                />
              ),
            )}
            {viewOtpIndexes.map((index) => {
              const field = form.custom_fields[index]
              if (!field) return null
              return (
                <OtpFieldView
                  key={`otp-view-${index}`}
                  label={field.label.trim() || t('vault.customFieldDefaults.otp')}
                  onCopy={() => void copyFieldTotp(index)}
                  onCopySecret={() => void copyTotpSecret(index)}
                  onCopySetupLink={() => void copyTotpSetupLink(index)}
                  preview={fieldTotpPreviews[index]}
                />
              )
            })}
          </div>
        ) : null}
        {viewWebsites.length ? (
          <div className="field-group">
            {viewWebsites.map((itemUrl) => {
              const note = autofillViewNote(t, itemUrl.match_type, itemUrl.url)
              return (
                <FieldView
                  canFill={features.browserExtension}
                  fieldType="url"
                  footer={note ? <span className="field-row-note">{note}</span> : null}
                  key={itemUrl.id}
                  label={itemUrl.label === defaultWebsiteLabel ? t('vault.website') : itemUrl.label}
                  onCopy={copyFieldValue}
                  onOpenUrl={openItemWebsite}
                  value={itemUrl.url}
                  // "Never fill on this website" drops Open & Fill too (1Password 8.10.80); it still opens.
                  website={itemUrl.match_type !== 'never'}
                />
              )
            })}
          </div>
        ) : null}
        {viewSections.map(({ children, index, title }) => (
          <section aria-label={title} className="field-section" key={`section-view-${index}`}>
            <h3 className="field-group-title">{title}</h3>
            <div className="field-group">
              {children.map((child) => {
                const templateField = findTemplateField(form.item_type, child.key)
                const label = childDisplayLabel(form.item_type, child, fieldLabels)
                return (
                  <div className="contents" key={child.id}>
                    <FieldView
                      fieldType={child.field_type}
                      label={label}
                      meta={templateFieldMeta(templateField)}
                      onCopy={copyFieldValue}
                      revealAll={revealAllSecure}
                      // The network already has its own row once it is filled in.
                      showBrand={!children.some((sibling) => sibling.key === 'brand')}
                      value={child.value}
                    />
                    {child.key === 'publicKey' && form.item_type === 'ssh_key' ? (
                      <SshFingerprintView
                        label={t(sshFingerprintLabelKey)}
                        onCopy={copyFieldValue}
                        publicKey={child.value}
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
        {viewOtherFields.length ? (
          <div className="field-group">
            {viewOtherFields.map(({ field, index }) => (
              <FieldView
                actions={
                  field.field_type === 'file' && field.value.startsWith('attachment://') ? (
                    <button className="secondary-button" onClick={() => openAttachment(field)} type="button">
                      {t('vault.exportAttachment')}
                    </button>
                  ) : undefined
                }
                activate={
                  isTextPreviewable(field)
                    ? { label: t('attachments.preview'), run: () => void openTextPreview(field) }
                    : undefined
                }
                display={
                  field.field_type === 'related_item'
                    ? itemTitleById(items, field.value)
                    : field.field_type === 'sign_in_with'
                      ? signInLabel(parseSignInProvider(field.value))
                      : field.field_type === 'file'
                        ? fileNameFromPath(field.value)
                        : undefined
                }
                fieldType={specialFieldTypes.includes(field.field_type) ? 'text' : field.field_type}
                key={`field-view-${index}`}
                label={field.label.trim() || t(`vault.customFieldDefaults.${field.field_type}`)}
                onCopy={copyFieldValue}
                revealAll={revealAllSecure}
                value={field.value}
              />
            ))}
          </div>
        ) : null}
        {(
          [
            ['parent', 'vault.relations.parent', viewRelations?.parent ? [viewRelations.parent] : []],
            ['child', 'vault.relations.children', viewRelations?.children ?? []],
            ['related', 'vault.relations.related', viewRelations?.related ?? []],
            ['signsInTo', 'vault.signIn.usedBy', viewRelations?.signs_in_to ?? []],
          ] as const
        ).map(([kind, headingKey, refs]) => (
          <RelationSection
            archivedLabel={t('vault.relations.archived')}
            heading={t(headingKey)}
            iconFor={relationIcon}
            key={kind}
            onOpen={(ref) => openRelatedItem(ref.id)}
            openLabel={(title) => t('vault.relations.open', { title })}
            refs={refs}
            typeLabel={relationTypeLabel}
          />
        ))}
        {tagList(form.tagsInput).length ? (
          <div className="field-group">
            <div className="field-row">
              <div className="field-row-main">
                <span className="field-row-label">{t('vault.tags')}</span>
                <span className="tag-chip-box">
                  {tagList(form.tagsInput).map((tag) => (
                    <span className="tag-chip" key={tag}>
                      {tag}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          </div>
        ) : null}
        {form.notes.trim() ? (
          <div className="field-group">
            <FieldView fieldType="multiline" label={t('vault.notes')} onCopy={copyFieldValue} value={form.notes} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
