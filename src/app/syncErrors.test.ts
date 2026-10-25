import { describe, expect, it } from 'vitest'
import i18n, { supportedLanguages } from './i18n'
import {
  checkWebdavUrl,
  describeSyncError,
  httpStatusLabel,
  syncErrorCodes,
  syncHttpHintStatuses,
  toSyncError,
} from './syncErrors'

describe('WebDAV address check', () => {
  it('accepts https and adds it to a bare host', () => {
    expect(checkWebdavUrl('https://dav.jianguoyun.com/dav/')).toEqual({
      addedScheme: false,
      kind: 'ok',
      url: 'https://dav.jianguoyun.com/dav/',
    })
    expect(checkWebdavUrl('  cloud.example.com/remote.php/dav/files/rei ')).toEqual({
      addedScheme: true,
      kind: 'ok',
      url: 'https://cloud.example.com/remote.php/dav/files/rei',
    })
  })

  // Owner 2026-10-23: no WebDAV without TLS, except this computer (the tests' server).
  it('refuses plain http except on loopback', () => {
    expect(checkWebdavUrl('http://nas.local/dav').kind).toBe('needs_https')
    expect(checkWebdavUrl('ftp://nas.local/dav').kind).toBe('needs_https')
    expect(checkWebdavUrl('http://127.0.0.1:8080/').kind).toBe('ok')
    expect(checkWebdavUrl('http://localhost:8080/').kind).toBe('ok')
  })

  it('keeps credentials out of the address and flags nonsense', () => {
    expect(checkWebdavUrl('https://rei:secret@dav.example.com/').kind).toBe('credentials')
    expect(checkWebdavUrl('https://').kind).toBe('invalid')
    expect(checkWebdavUrl('   ').kind).toBe('empty')
  })
})

describe('sync errors', () => {
  it('translates every code and every hinted status in each language', () => {
    for (const language of supportedLanguages) {
      const t = i18n.getFixedT(language)
      for (const code of syncErrorCodes) expect(i18n.exists(`sync.errors.${code}`, { lng: language })).toBe(true)
      for (const status of syncHttpHintStatuses) {
        expect(i18n.exists(`sync.httpHints.${status}`, { lng: language })).toBe(true)
      }
      expect(t('sync.errors.network')).not.toBe('sync.errors.network')
    }
  })

  // Owner rule 2026-10-13: an HTTP status always carries its Chinese gloss, whatever the UI language.
  it('shows an HTTP status with its Chinese gloss in every language', () => {
    expect(httpStatusLabel(401)).toBe('401 未授权')
    expect(httpStatusLabel(418)).toBe('418 HTTP 错误')
    const error = { code: 'http' as const, message: '401 未授权：用户名或应用密码不对', status: 401 }
    expect(describeSyncError(i18n.getFixedT('en'), error)).toBe('401 未授权: Wrong user name or app password.')
    expect(describeSyncError(i18n.getFixedT('zh'), error)).toBe('401 未授权：用户名或应用密码不对。')
    expect(describeSyncError(i18n.getFixedT('ja'), error)).toContain('401 未授权')
    expect(describeSyncError(i18n.getFixedT('en'), { code: 'http', message: '', status: 500 })).toBe(
      '500 服务器内部错误: The server returned an error.',
    )
  })

  it('reads a rejection whatever shape it has', () => {
    expect(toSyncError({ code: 'remote_password_wrong', message: 'x', status: null }).code).toBe(
      'remote_password_wrong',
    )
    expect(toSyncError({ code: 'something_new', message: 'x', status: null }).code).toBe('local')
    expect(toSyncError('boom')).toEqual({ code: 'local', message: 'boom', status: null })
  })
})
