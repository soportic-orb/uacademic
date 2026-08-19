import { describe, expect, it } from 'vitest'

import { adminConsentUrl } from '../src/auth/consent'

describe('the administrator consent link', () => {
  it('names the application and the tenant it must be installed in', () => {
    const url = new URL(
      adminConsentUrl({
        clientId: '8ceb75d9-c201-4101-bd20-0564454ec566',
        tenantId: 'uvic.cat',
        origin: 'https://www.uacademic.cat',
      }),
    )

    expect(url.host).toBe('login.microsoftonline.com')
    expect(url.pathname).toBe('/uvic.cat/adminconsent')
    expect(url.searchParams.get('client_id')).toBe('8ceb75d9-c201-4101-bd20-0564454ec566')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://www.uacademic.cat/auth-callback.html',
    )
  })

  it('escapes a tenant identifier rather than pasting it into the path', () => {
    const url = adminConsentUrl({
      clientId: 'app',
      tenantId: '../common',
      origin: 'https://uacademic.cat',
    })

    expect(url).toContain('%2F')
    expect(url).not.toContain('/../common/')
  })
})
