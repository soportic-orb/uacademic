/**
 * R3 is the rule that, if broken, lets a user from any Microsoft organization
 * in the world into someone else's center. These tests exist to make that
 * impossible to regress quietly.
 */
import { describe, expect, it } from 'vitest'

import {
  type JitCandidateCenter,
  type RegisteredTenant,
  canSignIn,
  decideJitProvisioning,
  emailDomain,
  emailFromClaims,
  expectedIssuers,
  signInBlockedMessageKey,
  subjectIdFromClaims,
  validateTenantClaims,
} from '../src/domain/identity.js'

const OUR_TENANT = '11111111-2222-3333-4444-555555555555'
const OTHER_TENANT = '99999999-8888-7777-6666-555555555555'

const TENANTS: RegisteredTenant[] = [{ tenantId: OUR_TENANT, status: 'active' }]

const validClaims = {
  tid: OUR_TENANT,
  iss: `https://login.microsoftonline.com/${OUR_TENANT}/v2.0`,
  oid: 'a1b2c3d4-0000-0000-0000-000000000001',
  preferred_username: 'Marta.Puig@Universitat.edu',
}

describe('tenant validation', () => {
  it('accepts a token from a registered tenant', () => {
    expect(validateTenantClaims(validClaims, TENANTS)).toEqual({ ok: true, tenantId: OUR_TENANT })
  })

  it('rejects a token from an organization we never registered', () => {
    const foreign = {
      ...validClaims,
      tid: OTHER_TENANT,
      iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0`,
    }
    expect(validateTenantClaims(foreign, TENANTS)).toEqual({
      ok: false,
      reason: 'unknown_tenant',
    })
  })

  it('rejects a token with no tid at all', () => {
    expect(validateTenantClaims({ ...validClaims, tid: undefined }, TENANTS)).toEqual({
      ok: false,
      reason: 'missing_tid',
    })
  })

  it('rejects an issuer that does not belong to the tid', () => {
    const spoofed = {
      ...validClaims,
      iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0`,
    }
    expect(validateTenantClaims(spoofed, TENANTS)).toEqual({
      ok: false,
      reason: 'issuer_mismatch',
    })
  })

  it('accepts the legacy v1 issuer Microsoft still emits', () => {
    const legacy = { ...validClaims, iss: `https://sts.windows.net/${OUR_TENANT}/` }
    expect(validateTenantClaims(legacy, TENANTS).ok).toBe(true)
    expect(expectedIssuers(OUR_TENANT)).toHaveLength(2)
  })

  it('honours a pinned issuer over the defaults', () => {
    const pinned: RegisteredTenant[] = [
      {
        tenantId: OUR_TENANT,
        issuer: 'https://login.microsoftonline.com/custom/v2.0',
        status: 'active',
      },
    ]
    expect(validateTenantClaims(validClaims, pinned)).toEqual({
      ok: false,
      reason: 'issuer_mismatch',
    })
    expect(
      validateTenantClaims(
        { ...validClaims, iss: 'https://login.microsoftonline.com/custom/v2.0' },
        pinned,
      ).ok,
    ).toBe(true)
  })

  it('rejects a suspended tenant', () => {
    expect(
      validateTenantClaims(validClaims, [{ tenantId: OUR_TENANT, status: 'suspended' }]),
    ).toEqual({ ok: false, reason: 'suspended_tenant' })
  })

  it('compares tenant ids and issuers case-insensitively, as GUIDs are', () => {
    const upper = {
      tid: OUR_TENANT.toUpperCase(),
      iss: `https://login.microsoftonline.com/${OUR_TENANT.toUpperCase()}/v2.0`,
    }
    expect(validateTenantClaims(upper, TENANTS)).toEqual({
      ok: true,
      tenantId: OUR_TENANT.toUpperCase(),
    })

    // Mixed casing between the two claims must still match the same tenant.
    expect(
      validateTenantClaims({ ...validClaims, tid: OUR_TENANT.toUpperCase() }, TENANTS).ok,
    ).toBe(true)
  })
})

describe('user identity from claims', () => {
  it('uses oid as the stable identifier, never the email', () => {
    expect(subjectIdFromClaims(validClaims)).toBe('a1b2c3d4-0000-0000-0000-000000000001')
    expect(subjectIdFromClaims({ ...validClaims, oid: undefined })).toBeNull()
  })

  it('reads the email from preferred_username and lower-cases it', () => {
    expect(emailFromClaims(validClaims)).toBe('marta.puig@universitat.edu')
    expect(emailFromClaims({ email: 'x@y.edu' })).toBe('x@y.edu')
    expect(emailFromClaims({ preferred_username: 'not-an-email' })).toBeNull()
  })

  it('extracts the domain for the provisioning policy', () => {
    expect(emailDomain('marta@Universitat.edu')).toBe('universitat.edu')
    expect(emailDomain('broken')).toBeNull()
  })
})

describe('just-in-time provisioning', () => {
  const center = (overrides: Partial<JitCandidateCenter> = {}): JitCandidateCenter => ({
    centerId: 'center-a',
    entraTenantId: OUR_TENANT,
    policy: {
      enabled: true,
      allowedEmailDomains: ['universitat.edu'],
      defaultRole: 'TEACHER',
      requireActivation: true,
    },
    ...overrides,
  })

  it('creates a teacher pending activation when tenant and domain match', () => {
    expect(
      decideJitProvisioning({ tenantId: OUR_TENANT, email: 'nova@universitat.edu' }, [center()]),
    ).toEqual({
      provision: true,
      centerId: 'center-a',
      role: 'TEACHER',
      status: 'pending_activation',
    })
  })

  it('activates directly when the center does not require approval', () => {
    const relaxed = center({
      policy: {
        enabled: true,
        allowedEmailDomains: [],
        defaultRole: 'TEACHER',
        requireActivation: false,
      },
    })
    expect(
      decideJitProvisioning({ tenantId: OUR_TENANT, email: 'nova@qualsevol.edu' }, [relaxed]),
    ).toMatchObject({ provision: true, status: 'active' })
  })

  it('refuses a domain outside the allow list', () => {
    expect(
      decideJitProvisioning({ tenantId: OUR_TENANT, email: 'someone@gmail.com' }, [center()]),
    ).toEqual({ provision: false, reason: 'domain_not_allowed' })
  })

  it('refuses when no center is bound to that tenant', () => {
    expect(
      decideJitProvisioning({ tenantId: OTHER_TENANT, email: 'nova@universitat.edu' }, [center()]),
    ).toEqual({ provision: false, reason: 'no_matching_center' })
  })

  it('refuses when the center has provisioning switched off', () => {
    const off = center({
      policy: {
        enabled: false,
        allowedEmailDomains: [],
        defaultRole: 'TEACHER',
        requireActivation: true,
      },
    })
    expect(
      decideJitProvisioning({ tenantId: OUR_TENANT, email: 'nova@universitat.edu' }, [off]),
    ).toEqual({ provision: false, reason: 'disabled' })
  })
})

describe('account status', () => {
  it('lets only active accounts in, with a reason for the rest', () => {
    expect(canSignIn('active')).toBe(true)
    expect(canSignIn('pending_activation')).toBe(false)
    expect(canSignIn('suspended')).toBe(false)
    expect(canSignIn('invited')).toBe(false)
    expect(signInBlockedMessageKey('pending_activation')).toBe('auth.errors.pendingActivation')
    expect(signInBlockedMessageKey('suspended')).toBe('auth.errors.suspended')
  })
})
