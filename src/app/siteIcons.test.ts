import { describe, expect, it } from 'vitest'
import {
  domainsToFetch,
  itemIconDomain,
  readSiteIconsEnabled,
  siteIconDomain,
  uniqueIconDomains,
  websiteHost,
} from './siteIcons'

const withSite = (website: string, icon_mode?: 'auto' | 'letter') => ({ icon_mode, urls: [], website })

describe('website icons', () => {
  it('reduces an address to the host worth asking', () => {
    expect(websiteHost('https://www.GitHub.com/login?x=1')).toBe('www.github.com')
    expect(websiteHost('figma.com')).toBe('figma.com')
    expect(websiteHost('example.com:8443/path')).toBe('example.com')
    expect(websiteHost('http://news.ycombinator.com')).toBe('news.ycombinator.com')
    for (const refused of [
      '',
      'localhost',
      'http://localhost:3000',
      '192.168.1.1',
      'https://10.0.0.1/admin',
      'http://[::1]/',
      'mailto:rei@example.com',
      'ftp://files.example.com',
      'otpauth://totp/x',
      'not a url',
    ]) {
      expect(websiteHost(refused), refused).toBeNull()
    }
  })

  it('takes the first address and honours the letter choice', () => {
    expect(siteIconDomain({ urls: [{ label: '', match_type: 'domain', url: 'https://a.example' }], website: '' })).toBe(
      'a.example',
    )
    expect(itemIconDomain(withSite('https://b.example', 'letter'))).toBeNull()
    expect(uniqueIconDomains([withSite('b.example'), withSite('https://b.example/x'), withSite('')])).toEqual([
      'b.example',
    ])
  })

  it('fetches only what was never asked or has gone stale', () => {
    const cached = { 'fresh.example': { fresh: true, icon: null }, 'old.example': { fresh: false, icon: 'data:' } }
    expect(domainsToFetch(['fresh.example', 'old.example', 'new.example'], cached)).toEqual([
      'old.example',
      'new.example',
    ])
  })

  it('is on unless switched off', () => {
    expect(readSiteIconsEnabled({ getItem: () => null })).toBe(true)
    expect(readSiteIconsEnabled({ getItem: () => 'off' })).toBe(false)
    expect(readSiteIconsEnabled(undefined)).toBe(true)
  })
})
