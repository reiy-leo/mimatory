import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { errorCodes } from './errors'
import i18n, { supportedLanguages } from './i18n'

/*
 * Owner (2026-10-25): "各种提示也要i18n，现在发现很多提醒在中文环境中也是英文". Every user-visible string goes
 * through t() — this guard reads the sources with the TypeScript parser and fails on English that does not:
 *
 * - JSX text with letters in it (`<p>Saved</p>`);
 * - a literal in a UI attribute (`title`, `aria-label`, `placeholder`, `alt`, `label`) or a UI-ish object property
 *   (`label: 'Personal'`, `message: '…'`), template literals included once their `${…}` parts are taken out;
 * - any other literal that reads like an English sentence (a capital, then a space, then another word);
 * - a raw rejection shown as-is (`setError(String(error))`): Rust errors carry a code, `describeError` translates it.
 *
 * Not checked: calls to t(), console output, imports, invoke() names, event names, storage keys, class names and
 * other machine attributes. The allowlist below is for brand names, URLs and codes that read the same in every
 * language; add to it only for that.
 */

const allowed: RegExp[] = [
  /^https?:\/\//, // addresses and placeholders such as https://dav.example.com/dav/
  /^[\w.-]+\.(com|app|dev|org)$/, // example.com
  /^mod\+/, // shortcut ids passed to shortcutLabel()
  /^(Mimatory|1Password|Google|Apple|GitHub|Microsoft|Facebook|X|WebDAV|Touch ID|English|日本語|中文)$/,
  /^Could not open URL$/, // console.error message
]

const uiAttributes = new Set([
  'title',
  'aria-label',
  'placeholder',
  'alt',
  'label',
  'aria-valuetext',
  'aria-description',
])
const machineAttributes = new Set([
  'className',
  'key',
  'role',
  'type',
  'd',
  'viewBox',
  'href',
  'id',
  'name',
  'autoComplete',
  'inputMode',
  'lang',
  'src',
  'htmlFor',
  'value',
  'defaultValue',
  'pattern',
  'accept',
  'enterKeyHint',
  'autoCapitalize',
  'dir',
  'target',
  'rel',
  'method',
])
const uiProperties = new Set([
  'label',
  'title',
  'placeholder',
  'description',
  'message',
  'text',
  'tooltip',
  'heading',
  'hint',
  'ariaLabel',
  'emptyText',
  'confirmLabel',
])
const ignoredCalls = [
  't',
  'i18n.t',
  'getFixedT',
  'invoke',
  'require',
  'addEventListener',
  'removeEventListener',
  'querySelector',
  'querySelectorAll',
  'getItem',
  'setItem',
  'removeItem',
  'listen',
  'emit',
  'matchMedia',
  'console.log',
  'console.warn',
  'console.error',
  'console.info',
  'console.debug',
  'shortcutLabel',
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (
      !/\.tsx?$/.test(path) ||
      /\.test\.tsx?$/.test(path) ||
      path.endsWith('.d.ts') ||
      path.endsWith('i18n.ts') ||
      path.includes('/locales/')
    )
      return []
    return [path]
  })
}

/** The literal's text with every `${…}` removed, so `${t('a')}: ${label}` reads as ": ". */
function literalText(node: ts.Node, source: ts.SourceFile): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node))
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ')
  return node.getText(source)
}

function enclosingCall(node: ts.Node, source: ts.SourceFile): string | null {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) return parent.expression.getText(source)
    if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isJsxAttribute(parent) || ts.isPropertyAssignment(parent))
      return null
  }
  return null
}

function enclosingAttribute(node: ts.Node, source: ts.SourceFile): string | null {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) return parent.name.getText(source)
    if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isBlock(parent)) return null
  }
  return null
}

const hasWord = (text: string) => /[A-Za-z]{2,}/.test(text)
const isAllowed = (text: string) => allowed.some((pattern) => pattern.test(text.trim()))
const looksLikeKey = (text: string) => /^[a-z]+(\.[A-Za-z0-9_]+)+$/.test(text)
const looksLikeSentence = (text: string) => /^[A-Z…][a-z’']*\s+[A-Za-z]{2,}/.test(text.trim())

export function findHardcodedStrings(path: string, text: string): string[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const found: string[] = []
  const report = (node: ts.Node, kind: string, value: string) => {
    if (isAllowed(value)) return
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
    found.push(`${path}:${line + 1} ${kind} ${JSON.stringify(value.trim())}`)
  }

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const value = node.getText(source).trim()
      if (hasWord(value)) report(node, 'jsx-text', value)
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const parent = node.parent
      const call = enclosingCall(node, source)
      const skip =
        ts.isImportDeclaration(parent) ||
        ts.isExportDeclaration(parent) ||
        ts.isLiteralTypeNode(parent) ||
        (call !== null && ignoredCalls.some((name) => call === name || call.endsWith(`.${name}`)))
      if (!skip) {
        const value = literalText(node, source)
        const attribute = enclosingAttribute(node, source)
        const property =
          ts.isPropertyAssignment(parent) && parent.initializer === node ? parent.name.getText(source) : null
        if (attribute && (machineAttributes.has(attribute) || attribute.startsWith('data-'))) {
          // a class name, an id, a key: not text
        } else if (attribute && uiAttributes.has(attribute)) {
          if (hasWord(value)) report(node, `attr:${attribute}`, value)
        } else if (property && uiProperties.has(property)) {
          if (hasWord(value) && !looksLikeKey(value)) report(node, `prop:${property}`, value)
        } else if (looksLikeSentence(value)) {
          report(node, 'sentence', value)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  // A rejection shown as-is is Rust's English Display text (or "[object Object]" since commands reject with
  // `{ code, message }`); describeError() translates it.
  text.split('\n').forEach((line, index) => {
    if (/set\w*Error\(\s*String\(/.test(line) || /error:\s*String\((next)?[eE]rror\)\s*,\s*fileName/.test(line))
      found.push(`${path}:${index + 1} raw-error ${JSON.stringify(line.trim())}`)
  })
  return found
}

const sources = sourceFiles('src').map((path) => ({ path, text: readFileSync(path, 'utf8') }))

describe('hardcoded user-facing strings', () => {
  it('finds none in src/', () => {
    expect(sources.flatMap(({ path, text }) => findHardcodedStrings(path, text))).toEqual([])
  })

  /* The guard has to see what it is guarding against, or a parser change would turn it green for nothing. */
  it('catches each kind it claims to', () => {
    const sample = [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text for the parser, not a template
      'export const A = () => <div title="Open item" aria-label={`Close ${name}`}>Saved</div>',
      "export const rows = [{ id: 'trash', label: 'Trash' }]",
      "export function f() { setError(String(nextError)); throw new Error('Vault is locked') }",
      'export const ok = () => <a className="Big Button" href="https://example.com">{t(\'vault.save\')}</a>',
      "console.error('Could not do it')",
    ].join('\n')
    const hits = findHardcodedStrings('sample.tsx', sample).map((hit) => hit.replace(/^sample\.tsx:\d+ /, ''))
    expect(hits).toEqual([
      'attr:title "Open item"',
      'attr:aria-label "Close"',
      'jsx-text "Saved"',
      'prop:label "Trash"',
      'sentence "Vault is locked"',
      'raw-error "export function f() { setError(String(nextError)); throw new Error(\'Vault is locked\') }"',
    ])
  })
})

describe('error codes', () => {
  /* The same list both ways: command_error.rs's CODES (and every code a From impl or lib.rs builds) against
     errorCodes here. cargo's own test checks one direction; this one runs with the frontend suite. */
  it('lists exactly the codes Rust sends', () => {
    const rust = readFileSync('src-tauri/src/command_error.rs', 'utf8')
    const lib = readFileSync('src-tauri/src/lib.rs', 'utf8')
    const listed = [
      ...(rust.match(/pub const CODES: &\[&str\] = &\[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/"([a-z_0-9]+)"/g),
    ].map((match) => match[1])
    const built = [
      ...[
        ...rust.matchAll(
          /=> "([a-z_0-9]+)"|(?:new|with_detail)\(\s*"([a-z_0-9]+)"|code = if [^{]+\{ "([a-z_0-9]+)" \} else \{ "([a-z_0-9]+)" \}/g,
        ),
      ].flatMap((match) => match.slice(1).filter(Boolean)),
      ...[...lib.matchAll(/code: "([a-z_0-9]+)"|CommandError::new\(\s*"([a-z_0-9]+)"/g)].flatMap((match) =>
        match.slice(1).filter(Boolean),
      ),
      ...[...readFileSync('src-tauri/src/biometric.rs', 'utf8').matchAll(/=> "(biometric_[a-z_]+)"/g)].map(
        (match) => match[1],
      ),
    ]
    expect(built.length).toBeGreaterThan(30)
    expect([...new Set(built)].filter((code) => !listed.includes(code))).toEqual([])
    expect([...listed].sort()).toEqual([...errorCodes].sort())
  })

  /* Rust sends these (`command_error.rs`, whose own test reads errors.ts the other way round). */
  it('translates every code Rust can send, in every language', () => {
    for (const language of supportedLanguages) {
      const t = i18n.getFixedT(language)
      const missing = errorCodes.filter(
        (code) => !i18n.exists(`errors.${code}`, { lng: language }) && code !== 'internal',
      )
      expect({ language, missing }).toEqual({ language, missing: [] })
      expect(t('errors.unknown')).not.toBe('errors.unknown')
    }
  })
})

/*
 * The browser extension speaks through chrome.i18n (`_locales/<locale>/messages.json`, default_locale en). Each
 * key the scripts, the popup and the manifest name exists in every locale, the locales agree, and no script
 * builds its own English text node (`text: 'Fill'`) or tooltip.
 */
describe('browser extension strings', () => {
  const root = 'browser-extension'
  const locales = ['en', 'zh_CN', 'ja']
  const messages = (locale: string) =>
    JSON.parse(readFileSync(join(root, '_locales', locale, 'messages.json'), 'utf8')) as Record<
      string,
      { message: string }
    >
  const scripts = ['content.js', 'popup.js', 'background.js', 'passkey-provider.js'].map((file) => ({
    file,
    text: readFileSync(join(root, file), 'utf8'),
  }))

  it('declares en as the default locale and ships en, zh_CN and ja', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { default_locale: string }
    expect(manifest.default_locale).toBe('en')
    expect(readdirSync(join(root, '_locales')).sort()).toEqual([...locales].sort())
  })

  it('keeps the three locales on the same keys', () => {
    const [english, ...others] = locales.map((locale) => Object.keys(messages(locale)).sort())
    for (const keys of others) expect(keys).toEqual(english)
  })

  it('defines every key the extension names', () => {
    const named = new Set<string>()
    for (const { text } of scripts) {
      for (const match of text.matchAll(/\b(?:msg|text)\(\s*'([A-Za-z0-9_]+)'/g)) named.add(match[1])
      for (const match of text.matchAll(/\?\s*'([A-Za-z0-9_]+)'\s*:\s*'([A-Za-z0-9_]+)'\s*\)/g)) {
        named.add(match[1])
        named.add(match[2])
      }
    }
    const popup = readFileSync(join(root, 'popup.html'), 'utf8')
    for (const match of popup.matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([A-Za-z0-9_]+)"/g))
      named.add(match[1])
    for (const match of readFileSync(join(root, 'manifest.json'), 'utf8').matchAll(/__MSG_(\w+)__/g))
      named.add(match[1])
    expect(named.size).toBeGreaterThan(20)
    for (const locale of locales) {
      const defined = messages(locale)
      expect({ locale, missing: [...named].filter((key) => !defined[key]) }).toEqual({ locale, missing: [] })
    }
  })

  it('builds no English text node or label in the scripts', () => {
    const literal = /\b(?:text|title|'aria-label'|placeholder)\s*:\s*'([^']*[A-Za-z]{2,}[^']*)'/g
    const hits = scripts.flatMap(({ file, text }) => [...text.matchAll(literal)].map((match) => `${file}: ${match[0]}`))
    expect(hits).toEqual([])
  })
})
