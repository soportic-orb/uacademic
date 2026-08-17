/**
 * Entra ID claim validation (R3).
 *
 * The app is registered as multi-tenant, so signature verification alone is
 * worthless: a token from *any* Microsoft organization in the world verifies
 * against the `/organizations` JWKS. What makes a token ours is the `tid`
 * claim matching a tenant a SUPERADMIN registered, and the `iss` matching the
 * issuer that tenant is supposed to use.
 *
 * This module is pure so the rules can be tested exhaustively without a
 * network, a database or Microsoft.
 */
import type { Role } from '../schemas/common.js'

export interface RegisteredTenant {
  /** The Microsoft tenant GUID stored in `entra_tenants.tenant_id`. */
  tenantId: string
  /** Expected issuer, when the tenant pins one. */
  issuer?: string | null
  status: 'active' | 'suspended'
}

export type TenantRejectionReason =
  | 'missing_tid'
  | 'missing_iss'
  | 'unknown_tenant'
  | 'suspended_tenant'
  | 'issuer_mismatch'

export type TenantValidation =
  | { ok: true; tenantId: string }
  | { ok: false; reason: TenantRejectionReason }

/** Issuers Microsoft publishes for a tenant: v2.0 endpoint and the v1 legacy one. */
export function expectedIssuers(tenantId: string): string[] {
  return [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`,
  ]
}

export interface TokenClaims {
  tid?: string | undefined
  iss?: string | undefined
  oid?: string | undefined
  preferred_username?: string | undefined
  email?: string | undefined
  name?: string | undefined
}

/**
 * Decides whether a verified token belongs to an organization we serve.
 * Called *after* the signature check, never instead of it.
 */
export function validateTenantClaims(
  claims: TokenClaims,
  tenants: readonly RegisteredTenant[],
): TenantValidation {
  const tid = claims.tid?.trim()
  if (!tid) return { ok: false, reason: 'missing_tid' }

  const iss = claims.iss?.trim()
  if (!iss) return { ok: false, reason: 'missing_iss' }

  const tenant = tenants.find((candidate) => candidate.tenantId.toLowerCase() === tid.toLowerCase())
  if (!tenant) return { ok: false, reason: 'unknown_tenant' }
  if (tenant.status !== 'active') return { ok: false, reason: 'suspended_tenant' }

  // A pinned issuer wins; otherwise the two Microsoft publishes for this tid.
  const allowed = tenant.issuer ? [tenant.issuer] : expectedIssuers(tid)
  if (!allowed.some((candidate) => candidate.toLowerCase() === iss.toLowerCase())) {
    return { ok: false, reason: 'issuer_mismatch' }
  }

  return { ok: true, tenantId: tid }
}

/** The stable user identifier is `oid` — never the email, which can change. */
export function subjectIdFromClaims(claims: TokenClaims): string | null {
  const oid = claims.oid?.trim()
  return oid && oid.length > 0 ? oid : null
}

/** Entra puts the email in `preferred_username` for work accounts. */
export function emailFromClaims(claims: TokenClaims): string | null {
  const candidate = claims.preferred_username?.trim() || claims.email?.trim()
  return candidate && candidate.includes('@') ? candidate.toLowerCase() : null
}

export function emailDomain(email: string): string | null {
  const domain = email.split('@')[1]?.trim().toLowerCase()
  return domain && domain.length > 0 ? domain : null
}

export interface JitPolicy {
  enabled: boolean
  /** Empty means "any domain of a tenant that is registered for this center". */
  allowedEmailDomains: readonly string[]
  defaultRole: Role
  /** When true the account is created but cannot act until someone approves it. */
  requireActivation: boolean
}

export interface JitCandidateCenter {
  centerId: string
  /** The tenant GUID this center is bound to. */
  entraTenantId: string | null
  policy: JitPolicy
}

export type JitDecision =
  | {
      provision: true
      centerId: string
      role: Role
      status: 'active' | 'pending_activation'
    }
  | { provision: false; reason: 'disabled' | 'no_matching_center' | 'domain_not_allowed' }

/**
 * Just-in-time provisioning: a person who signs in from a registered tenant
 * with a matching email domain gets an account, but by default it lands in
 * `pending_activation` — belonging to the university is not the same as
 * belonging to a center.
 */
export function decideJitProvisioning(
  claims: { tenantId: string; email: string },
  centers: readonly JitCandidateCenter[],
): JitDecision {
  const tenantId = claims.tenantId.toLowerCase()
  const domain = emailDomain(claims.email)

  const boundCenters = centers.filter(
    (center) => (center.entraTenantId ?? '').toLowerCase() === tenantId,
  )
  if (boundCenters.length === 0) return { provision: false, reason: 'no_matching_center' }

  const enabled = boundCenters.filter((center) => center.policy.enabled)
  if (enabled.length === 0) return { provision: false, reason: 'disabled' }

  const match = enabled.find((center) => {
    const domains = center.policy.allowedEmailDomains
    if (domains.length === 0) return true
    return domain !== null && domains.some((allowed) => allowed.toLowerCase() === domain)
  })
  if (!match) return { provision: false, reason: 'domain_not_allowed' }

  return {
    provision: true,
    centerId: match.centerId,
    role: match.policy.defaultRole,
    status: match.policy.requireActivation ? 'pending_activation' : 'active',
  }
}

/** Only an active account may act; everything else is a dead end with a reason. */
export type AccountStatus = 'active' | 'invited' | 'pending_activation' | 'suspended'

export function canSignIn(status: AccountStatus): boolean {
  return status === 'active'
}

export function signInBlockedMessageKey(status: AccountStatus): string {
  switch (status) {
    case 'pending_activation':
      return 'auth.errors.pendingActivation'
    case 'suspended':
      return 'auth.errors.suspended'
    case 'invited':
      return 'auth.errors.invited'
    case 'active':
      return ''
  }
}
