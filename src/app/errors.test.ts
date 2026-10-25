import { afterAll, describe, expect, it } from 'vitest'
import { describeError, errorCode } from './errors'
import i18n from './i18n'

describe('describeError', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('translates a Rust code instead of showing its English message', async () => {
    const rejection = { code: 'invalid_master_password', message: 'invalid master password' }
    await i18n.changeLanguage('zh')
    expect(describeError(rejection)).toBe('主密码不对。')
    await i18n.changeLanguage('ja')
    expect(describeError(rejection)).toBe('マスターパスワードが違います。')
    await i18n.changeLanguage('en')
    expect(describeError(rejection)).toBe('That master password is incorrect.')
  })

  it('keeps the inner error of a wrapper code after the translated line', async () => {
    await i18n.changeLanguage('zh')
    expect(
      describeError({ code: 'database', detail: 'disk I/O error', message: 'database error: disk I/O error' }),
    ).toBe('保险库文件读写出错。（disk I/O error）')
  })

  it('shows an HTTP status with its Chinese gloss in every language', async () => {
    await i18n.changeLanguage('en')
    expect(describeError({ code: 'http', message: 'http error', status: 401 })).toBe('The server answered 401 未授权.')
    await i18n.changeLanguage('zh')
    expect(describeError({ code: 'http', message: 'http error', status: 503 })).toBe('服务器返回 503 服务不可用。')
  })

  it('falls back to the localized generic line plus the raw text', async () => {
    await i18n.changeLanguage('zh')
    expect(describeError('session lock poisoned')).toBe('出了点问题：session lock poisoned')
    expect(describeError({ code: 'brand_new_code', message: 'something new' })).toBe('出了点问题：something new')
    expect(describeError({ code: 'internal', message: 'join failed' })).toBe('出了点问题：join failed')
    expect(describeError(new Error('boom'))).toBe('出了点问题：boom')
    expect(describeError('')).toBe('出了点问题。')
  })

  it('reads a sync rejection through the sync table', async () => {
    await i18n.changeLanguage('zh')
    expect(describeError({ code: 'busy', message: '同步正在进行', status: null })).toBe(i18n.t('sync.errors.busy'))
  })

  it('exposes the code for callers that react to one case', () => {
    expect(errorCode({ code: 'locked', message: 'vault is locked' })).toBe('locked')
    expect(errorCode('vault is locked')).toBeNull()
  })
})
