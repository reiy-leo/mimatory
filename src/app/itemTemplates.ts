import type { FieldValidation, ValueFieldType } from './fieldFormats'

/**
 * The default field set for every item category, modelled on what 1Password, Apple Passwords and
 * Bitwarden ship for the same kinds of item. Data only: the editor and the read-only view both render
 * these through the type-driven field components, so a category gets new behaviour by changing a
 * `field_type` here, never by a special case in App.tsx.
 *
 * Storage: a template section is an ordinary `section` custom field whose value is a JSON array of
 * children. Each child a template seeds carries its template `key`, which is how a stored field finds
 * its type, options and rules again after a rename or a language switch. Empty template children are
 * dropped on save and re-seeded on load (see `itemFields.ts`), so the vault only stores what was typed.
 */

/** Pop-up button choices. A stored value is the option id; its label is `itemTemplates.options.<set>.<id>`. */
export const optionSets = {
  bankAccountType: ['checking', 'savings', 'business', 'other'],
  cardBrand: ['visa', 'mastercard', 'amex', 'discover', 'jcb', 'unionpay', 'diners', 'other'],
  connectionSecurity: ['none', 'ssl_tls', 'starttls'],
  databaseType: ['postgresql', 'mysql', 'sqlite', 'sqlserver', 'oracle', 'mongodb', 'redis', 'other'],
  emailServerType: ['imap', 'pop3', 'other'],
  gender: ['female', 'male', 'nonbinary', 'undisclosed'],
  passportType: ['ordinary', 'official', 'diplomatic', 'other'],
  sshKeyType: ['ed25519', 'ecdsa', 'rsa', 'ed25519_sk', 'ecdsa_sk', 'dsa'],
  wifiSecurity: ['none', 'wep', 'wpa_personal', 'wpa2_personal', 'wpa3_personal', 'wpa2_wpa3', 'enterprise'],
} as const

export type OptionSetName = keyof typeof optionSets

export function optionLabelKey(set: OptionSetName, option: string): string {
  return `itemTemplates.options.${set}.${option}`
}

/** A value one field can fill into an empty sibling: a card's network from its number, an SSH key's type
 * from its public key, the public key from an OpenSSH private key. Never overwrites what the user chose. */
export type FieldDerivation = 'cardBrand' | 'sshKeyType' | 'sshPublicKey'

export type TemplateField = {
  /** Shows "Expired" / "Expires soon" beside the value. */
  expiry?: boolean
  field_type: ValueFieldType
  fills?: Array<{ derive: FieldDerivation; key: string }>
  inputMode?: 'numeric'
  /** Stable id, unique within its template. Stored on the child so the field keeps its meaning. */
  key: string
  labelKey: string
  /** Keys, fingerprints and addresses read better in the monospaced face. */
  monospace?: boolean
  options?: OptionSetName
  validation?: FieldValidation
}

export type TemplateSection = {
  fields: TemplateField[]
  /** Stable id of the section within its template. */
  key: string
  titleKey: string
}

/** The item's own username / password columns, which autofill, Watchtower and Quick Access read. */
export type CredentialsLayout = {
  passwordLabelKey: string
  username: boolean
  usernameLabelKey: string
}

export type ItemTemplate = {
  /** Null when the item has no username / password columns of its own. */
  credentials: CredentialsLayout | null
  /** Offers a one-time password slot in the credential group. */
  otp: boolean
  sections: TemplateSection[]
  websites: boolean
}

const loginCredentials: CredentialsLayout = {
  passwordLabelKey: 'vault.password',
  username: true,
  usernameLabelKey: 'vault.username',
}

// Key prefixes, not keys: written as template literals so the i18n sweep (which reads quoted literals) does
// not take them for keys. Every full key built from them is checked in itemTemplates.test.ts.
const f = `itemTemplates.fields`
const s = `itemTemplates.sections`

/**
 * Types with no entry here keep the login layout, so a category can be added to the sidebar before it
 * has a template without changing what its editor looks like.
 */
const loginTemplate: ItemTemplate = {
  credentials: loginCredentials,
  otp: true,
  sections: [],
  websites: true,
}

export const itemTemplates: Record<string, ItemTemplate> = {
  api_credential: {
    credentials: { ...loginCredentials, passwordLabelKey: `${f}.credential` },
    otp: false,
    sections: [
      {
        fields: [
          { field_type: 'text', key: 'type', labelKey: `${f}.credentialType` },
          { field_type: 'text', key: 'hostname', labelKey: `${f}.hostname`, monospace: true },
          { field_type: 'date', key: 'validFrom', labelKey: `${f}.validFrom` },
          { expiry: true, field_type: 'date', key: 'expires', labelKey: `${f}.expiryDate` },
        ],
        key: 'details',
        titleKey: `${s}.apiDetails`,
      },
    ],
    websites: false,
  },
  bank_account: {
    credentials: null,
    otp: false,
    sections: [
      {
        fields: [
          { field_type: 'text', key: 'bankName', labelKey: `${f}.bankName` },
          { field_type: 'text', key: 'accountHolder', labelKey: `${f}.accountHolder` },
          { field_type: 'select', key: 'accountType', labelKey: `${f}.accountType`, options: 'bankAccountType' },
          { field_type: 'concealed', key: 'accountNumber', labelKey: `${f}.accountNumber`, monospace: true },
          { field_type: 'text', key: 'routingNumber', labelKey: `${f}.routingNumber`, monospace: true },
          { field_type: 'text', key: 'swift', labelKey: `${f}.swift`, monospace: true, validation: 'swift' },
          { field_type: 'text', key: 'iban', labelKey: `${f}.iban`, monospace: true, validation: 'iban' },
          {
            field_type: 'concealed',
            inputMode: 'numeric',
            key: 'pin',
            labelKey: 'itemTemplates.creditCard.pin',
            validation: 'digits',
          },
        ],
        key: 'account',
        titleKey: `${s}.accountDetails`,
      },
      {
        fields: [
          { field_type: 'phone', key: 'branchPhone', labelKey: `${f}.branchPhone` },
          { field_type: 'address', key: 'branchAddress', labelKey: `${f}.branchAddress` },
        ],
        key: 'branch',
        titleKey: `${s}.branch`,
      },
    ],
    websites: false,
  },
  credit_card: {
    credentials: null,
    otp: false,
    sections: [
      {
        fields: [
          { field_type: 'text', key: 'cardholder', labelKey: 'itemTemplates.creditCard.cardholder' },
          { field_type: 'select', key: 'brand', labelKey: `${f}.cardType`, options: 'cardBrand' },
          {
            field_type: 'card_number',
            fills: [{ derive: 'cardBrand', key: 'brand' }],
            key: 'number',
            labelKey: 'itemTemplates.creditCard.cardNumber',
          },
          { expiry: true, field_type: 'month_year', key: 'expiry', labelKey: 'itemTemplates.creditCard.expiryDate' },
          { field_type: 'month_year', key: 'validFrom', labelKey: `${f}.validFrom` },
          {
            field_type: 'concealed',
            inputMode: 'numeric',
            key: 'cvv',
            labelKey: 'itemTemplates.creditCard.securityCode',
            validation: 'cvv',
          },
          {
            field_type: 'concealed',
            inputMode: 'numeric',
            key: 'pin',
            labelKey: 'itemTemplates.creditCard.pin',
            validation: 'digits',
          },
          { field_type: 'address', key: 'billingAddress', labelKey: `${f}.billingAddress` },
        ],
        key: 'card',
        titleKey: 'itemTemplates.creditCard.cardDetails',
      },
      {
        fields: [
          { field_type: 'text', key: 'issuingBank', labelKey: `${f}.issuingBank` },
          { field_type: 'phone', key: 'issuerPhone', labelKey: 'vault.customFieldDefaults.phone' },
          { field_type: 'url', key: 'issuerWebsite', labelKey: `${f}.website` },
        ],
        key: 'issuer',
        titleKey: `${s}.issuer`,
      },
    ],
    websites: false,
  },
  crypto_wallet: {
    credentials: null,
    otp: false,
    sections: [
      {
        fields: [
          {
            field_type: 'concealed_multiline',
            key: 'recoveryPhrase',
            labelKey: `${f}.recoveryPhrase`,
            monospace: true,
          },
          { field_type: 'password', key: 'walletPassword', labelKey: `${f}.walletPassword` },
          { field_type: 'text', key: 'walletAddress', labelKey: `${f}.walletAddress`, monospace: true },
          { field_type: 'text', key: 'network', labelKey: `${f}.blockchainNetwork` },
        ],
        key: 'wallet',
        titleKey: `${s}.wallet`,
      },
    ],
    websites: false,
  },
  database: {
    credentials: loginCredentials,
    otp: false,
    sections: [
      {
        fields: [
          { field_type: 'select', key: 'databaseType', labelKey: `${f}.databaseType`, options: 'databaseType' },
          { field_type: 'text', key: 'server', labelKey: `${f}.server`, monospace: true },
          { field_type: 'text', inputMode: 'numeric', key: 'port', labelKey: `${f}.port`, validation: 'digits' },
          { field_type: 'text', key: 'database', labelKey: `${f}.databaseName` },
          { field_type: 'text', key: 'connectionOptions', labelKey: `${f}.connectionOptions`, monospace: true },
        ],
        key: 'connection',
        titleKey: `${s}.connection`,
      },
    ],
    websites: false,
  },
  driver_license: {
    credentials: null,
    otp: false,
    sections: [
      {
        fields: [
          { field_type: 'text', key: 'fullName', labelKey: 'itemTemplates.identity.fullName' },
          { field_type: 'text', key: 'number', labelKey: `${f}.licenseNumber`, monospace: true },
          { field_type: 'text', key: 'class', labelKey: `${f}.licenseClass` },
          { field_type: 'text', key: 'region', labelKey: `${f}.stateRegion` },
          { field_type: 'text', key: 'country', labelKey: `${f}.country` },
          { field_type: 'date', key: 'issueDate', labelKey: `${f}.issueDate` },
          { expiry: true, field_type: 'date', key: 'expiryDate', labelKey: `${f}.expiryDate` },
          { field_type: 'date', key: 'birthDate', labelKey: 'itemTemplates.identity.birthDate' },
          { field_type: 'address', key: 'address', labelKey: 'vault.customFieldDefaults.address' },
        ],
        key: 'license',
        titleKey: `${s}.driverLicense`,
      },
    ],
    websites: false,
  },
  email: {
    credentials: loginCredentials,
    otp: false,
    sections: [
      {
        fields: [
          { field_type: 'select', key: 'serverType', labelKey: `${f}.serverType`, options: 'emailServerType' },
          { field_type: 'text', key: 'server', labelKey: `${f}.server`, monospace: true },
          { field_type: 'text', inputMode: 'numeric', key: 'port', labelKey: `${f}.port`, validation: 'digits' },
          { field_type: 'select', key: 'security', labelKey: `${f}.security`, options: 'connectionSecurity' },
        ],
        key: 'incoming',
        titleKey: `${s}.incomingMail`,
      },
      {
        fields: [
          { field_type: 'text', key: 'smtpServer', labelKey: `${f}.server`, monospace: true },
          { field_type: 'text', inputMode: 'numeric', key: 'smtpPort', labelKey: `${f}.port`, validation: 'digits' },
          { field_type: 'select', key: 'smtpSecurity', labelKey: `${f}.security`, options: 'connectionSecurity' },
        ],
        key: 'outgoing',
        titleKey: `${s}.outgoingMail`,
      },
    ],
    websites: false,
  },
  identity: {
    credentials: null,
    otp: false,
    sections: [
      {
        fields: [
          { field_type: 'text', key: 'firstName', labelKey: `${f}.firstName` },
          { field_type: 'text', key: 'middleName', labelKey: `${f}.middleName` },
          { field_type: 'text', key: 'lastName', labelKey: `${f}.lastName` },
          { field_type: 'select', key: 'gender', labelKey: `${f}.gender`, options: 'gender' },
          { field_type: 'date', key: 'birthDate', labelKey: 'itemTemplates.identity.birthDate' },
          { field_type: 'text', key: 'idNumber', labelKey: 'itemTemplates.identity.idNumber', monospace: true },
        ],
        key: 'identification',
        titleKey: 'itemTemplates.identity.personalDetails',
      },
      {
        fields: [
          { field_type: 'email', key: 'email', labelKey: 'vault.customFieldDefaults.email' },
          { field_type: 'phone', key: 'phone', labelKey: 'vault.customFieldDefaults.phone' },
          { field_type: 'address', key: 'address', labelKey: 'vault.customFieldDefaults.address' },
        ],
        key: 'contact',
        titleKey: `${s}.contact`,
      },
      {
        fields: [
          { field_type: 'text', key: 'company', labelKey: `${f}.company` },
          { field_type: 'text', key: 'jobTitle', labelKey: `${f}.jobTitle` },
        ],
        key: 'work',
        titleKey: `${s}.work`,
      },
    ],
    websites: false,
  },
  login: loginTemplate,
  passport: {
    credentials: null,
    otp: false,
    sections: [
      {
        fields: [
          { field_type: 'select', key: 'type', labelKey: `${f}.passportType`, options: 'passportType' },
          { field_type: 'text', key: 'issuingCountry', labelKey: `${f}.issuingCountry` },
          { field_type: 'text', key: 'number', labelKey: `${f}.passportNumber`, monospace: true },
          { field_type: 'text', key: 'fullName', labelKey: 'itemTemplates.identity.fullName' },
          { field_type: 'select', key: 'sex', labelKey: `${f}.sex`, options: 'gender' },
          { field_type: 'text', key: 'nationality', labelKey: `${f}.nationality` },
          { field_type: 'date', key: 'birthDate', labelKey: 'itemTemplates.identity.birthDate' },
          { field_type: 'text', key: 'birthPlace', labelKey: `${f}.birthPlace` },
          { field_type: 'date', key: 'issueDate', labelKey: `${f}.issueDate` },
          { expiry: true, field_type: 'date', key: 'expiryDate', labelKey: `${f}.expiryDate` },
          { field_type: 'text', key: 'authority', labelKey: `${f}.authority` },
        ],
        key: 'passport',
        titleKey: `${s}.passportDetails`,
      },
    ],
    websites: false,
  },
  password: {
    credentials: { ...loginCredentials, username: false },
    otp: false,
    sections: [],
    websites: false,
  },
  router: {
    credentials: null,
    otp: false,
    sections: [
      {
        fields: [
          { field_type: 'text', key: 'baseStationName', labelKey: `${f}.baseStationName` },
          { field_type: 'password', key: 'baseStationPassword', labelKey: `${f}.baseStationPassword` },
          { field_type: 'text', key: 'serverIp', labelKey: `${f}.serverIp`, monospace: true },
        ],
        key: 'baseStation',
        titleKey: `${s}.baseStation`,
      },
      {
        fields: [
          { field_type: 'text', key: 'networkName', labelKey: `${f}.networkName` },
          { field_type: 'select', key: 'wirelessSecurity', labelKey: `${f}.security`, options: 'wifiSecurity' },
          { field_type: 'password', key: 'wirelessPassword', labelKey: `${f}.wifiPassword` },
        ],
        key: 'wireless',
        titleKey: `${s}.wirelessNetwork`,
      },
    ],
    websites: false,
  },
  secure_note: {
    credentials: null,
    otp: false,
    sections: [],
    websites: false,
  },
  server: {
    credentials: loginCredentials,
    otp: true,
    sections: [
      {
        fields: [
          { field_type: 'url', key: 'url', labelKey: `${f}.serverUrl` },
          { field_type: 'url', key: 'adminConsoleUrl', labelKey: `${f}.adminConsoleUrl` },
          { field_type: 'text', key: 'hostingProvider', labelKey: `${f}.hostingProvider` },
        ],
        key: 'server',
        titleKey: `${s}.server`,
      },
    ],
    websites: false,
  },
  software_license: {
    credentials: null,
    otp: false,
    sections: [
      {
        fields: [
          {
            field_type: 'concealed',
            key: 'licenseKey',
            labelKey: 'itemTemplates.softwareLicense.licenseKey',
            monospace: true,
          },
          { field_type: 'text', key: 'version', labelKey: `${f}.version` },
          {
            field_type: 'text',
            key: 'serialNumber',
            labelKey: 'itemTemplates.softwareLicense.serialNumber',
            monospace: true,
          },
          { field_type: 'text', key: 'issuedTo', labelKey: 'itemTemplates.softwareLicense.issuedTo' },
          { field_type: 'email', key: 'registeredEmail', labelKey: `${f}.registeredEmail` },
          { field_type: 'text', key: 'company', labelKey: `${f}.company` },
          { field_type: 'url', key: 'downloadPage', labelKey: `${f}.downloadPage` },
          { field_type: 'date', key: 'purchaseDate', labelKey: 'itemTemplates.softwareLicense.purchaseDate' },
          { field_type: 'text', key: 'orderNumber', labelKey: `${f}.orderNumber` },
          { expiry: true, field_type: 'date', key: 'expiryDate', labelKey: `${f}.expiryDate` },
        ],
        key: 'license',
        titleKey: 'itemTemplates.softwareLicense.licenseDetails',
      },
    ],
    websites: false,
  },
  ssh_key: {
    credentials: null,
    otp: false,
    sections: [
      {
        fields: [
          {
            field_type: 'concealed_multiline',
            fills: [{ derive: 'sshPublicKey', key: 'publicKey' }],
            key: 'privateKey',
            labelKey: `${f}.privateKey`,
            monospace: true,
          },
          {
            field_type: 'multiline',
            fills: [{ derive: 'sshKeyType', key: 'keyType' }],
            key: 'publicKey',
            labelKey: `${f}.publicKey`,
            monospace: true,
            validation: 'ssh_public_key',
          },
          { field_type: 'select', key: 'keyType', labelKey: `${f}.keyType`, options: 'sshKeyType' },
          { field_type: 'password', key: 'passphrase', labelKey: `${f}.passphrase` },
        ],
        key: 'key',
        titleKey: `${s}.sshKey`,
      },
    ],
    websites: false,
  },
  wifi: {
    // The network name and password live in the item's own columns, which is also where Wi-Fi items
    // saved before this template existed already keep them.
    credentials: {
      passwordLabelKey: `${f}.wifiPassword`,
      username: true,
      usernameLabelKey: `${f}.networkName`,
    },
    otp: false,
    sections: [
      {
        fields: [{ field_type: 'select', key: 'security', labelKey: `${f}.security`, options: 'wifiSecurity' }],
        key: 'network',
        titleKey: `${s}.network`,
      },
    ],
    websites: false,
  },
}

export function getItemTemplate(itemType: string): ItemTemplate {
  return itemTemplates[itemType] ?? loginTemplate
}

/** The template field a stored child points at, if its type still has one. */
export function findTemplateField(itemType: string, key: string | undefined): TemplateField | undefined {
  if (!key) return undefined
  for (const section of getItemTemplate(itemType).sections) {
    const field = section.fields.find((candidate) => candidate.key === key)
    if (field) return field
  }
  return undefined
}

/** Label key of the derived SSH fingerprint row, which is computed from the public key and never stored. */
export const sshFingerprintLabelKey = `${f}.fingerprint`
