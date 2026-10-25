/** A locale's strings: nested namespaces whose leaves are the UI text. */
export type LocaleBundle = { [key: string]: string | LocaleBundle }
