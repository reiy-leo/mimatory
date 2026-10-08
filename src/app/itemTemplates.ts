export type TemplateFieldType = 'address' | 'date' | 'email' | 'month_year' | 'password' | 'phone' | 'text' | 'url'

export type TemplateField = {
  field_type: TemplateFieldType
  labelKey: string
}

export type TemplateSection = {
  fields: TemplateField[]
  titleKey: string
}

export type ItemTemplate = {
  /** Whether the item's username / password columns are the point of the item. */
  credentials: boolean
  sections: TemplateSection[]
  websites: boolean
}

/**
 * Types with no entry here keep the login layout, so a category can be added to
 * the sidebar before it has a template without changing what its editor looks like.
 */
const loginTemplate: ItemTemplate = {
  credentials: true,
  sections: [],
  websites: true,
}

export const itemTemplates: Record<string, ItemTemplate> = {
  credit_card: {
    credentials: false,
    sections: [
      {
        fields: [
          { field_type: 'text', labelKey: 'itemTemplates.creditCard.cardholder' },
          { field_type: 'password', labelKey: 'itemTemplates.creditCard.cardNumber' },
          { field_type: 'month_year', labelKey: 'itemTemplates.creditCard.expiryDate' },
          { field_type: 'password', labelKey: 'itemTemplates.creditCard.securityCode' },
          { field_type: 'password', labelKey: 'itemTemplates.creditCard.pin' },
        ],
        titleKey: 'itemTemplates.creditCard.cardDetails',
      },
    ],
    websites: false,
  },
  identity: {
    credentials: false,
    sections: [
      {
        fields: [
          { field_type: 'text', labelKey: 'itemTemplates.identity.fullName' },
          { field_type: 'date', labelKey: 'itemTemplates.identity.birthDate' },
          { field_type: 'text', labelKey: 'itemTemplates.identity.idNumber' },
          { field_type: 'email', labelKey: 'vault.customFieldDefaults.email' },
          { field_type: 'phone', labelKey: 'vault.customFieldDefaults.phone' },
          { field_type: 'address', labelKey: 'vault.customFieldDefaults.address' },
        ],
        titleKey: 'itemTemplates.identity.personalDetails',
      },
    ],
    websites: false,
  },
  secure_note: {
    credentials: false,
    sections: [],
    websites: false,
  },
  software_license: {
    credentials: false,
    sections: [
      {
        fields: [
          { field_type: 'password', labelKey: 'itemTemplates.softwareLicense.licenseKey' },
          { field_type: 'text', labelKey: 'itemTemplates.softwareLicense.serialNumber' },
          { field_type: 'text', labelKey: 'itemTemplates.softwareLicense.issuedTo' },
          { field_type: 'date', labelKey: 'itemTemplates.softwareLicense.purchaseDate' },
        ],
        titleKey: 'itemTemplates.softwareLicense.licenseDetails',
      },
    ],
    websites: false,
  },
}

export function getItemTemplate(itemType: string): ItemTemplate {
  return itemTemplates[itemType] ?? loginTemplate
}
