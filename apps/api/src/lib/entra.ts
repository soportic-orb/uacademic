import { type TokenClaims, validateTenantClaims } from '@uacademic/shared'
import type { RegisteredTenant } from '@uacademic/shared'
import { type JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose'

import { AppError } from './errors.js'

/**
 * Microsoft Entra ID token verification (R3).
 *
 * The signature check is necessary but nowhere near sufficient: the app is
 * registered as multi-tenant, so the `/organizations` JWKS signs tokens for
 * every Microsoft organization on earth. What makes a token ours is:
 *
 *   1. a valid signature from that JWKS,
 *   2. an `aud` equal to our client id — otherwise a token minted for another
 *      application would pass,
 *   3. a `tid` present in our `entra_tenants` table,
 *   4. an `iss` that matches that `tid`.
 *
 * Steps 3 and 4 live in `@uacademic/shared` so they can be unit-tested without
 * a network; this module wires them to the real key set.
 */
export interface EntraVerifierOptions {
  jwksUri: string
  audiences: string[]
  /** Optional clock tolerance for slow clocks on shared hosts. */
  clockToleranceSeconds?: number
}

export interface VerifiedIdentity {
  tenantId: string
  objectId: string
  email: string | null
  displayName: string | null
  claims: TokenClaims & JWTPayload
}

type KeySet = ReturnType<typeof createRemoteJWKSet>

export class EntraVerifier {
  readonly #keySet: KeySet
  readonly #options: EntraVerifierOptions

  constructor(options: EntraVerifierOptions) {
    this.#options = options
    // jose caches the key set and re-fetches on unknown `kid`, which is what
    // makes Microsoft's key rotation a non-event.
    this.#keySet = createRemoteJWKSet(new URL(options.jwksUri))
  }

  /**
   * Verifies signature, audience and expiry, then checks the tenant against
   * the registered ones. Every failure is a 401/403 with a specific key, never
   * a generic "invalid token" — an operator needs to know which rule bit.
   */
  async verify(token: string, tenants: readonly RegisteredTenant[]): Promise<VerifiedIdentity> {
    let payload: JWTPayload
    try {
      const verified = await jwtVerify(token, this.#keySet, {
        audience: this.#options.audiences,
        clockTolerance: this.#options.clockToleranceSeconds ?? 5,
      })
      payload = verified.payload
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'auth.errors.tokenInvalid')
    }

    const claims = payload as TokenClaims & JWTPayload
    const tenantCheck = validateTenantClaims(claims, tenants)

    if (!tenantCheck.ok) {
      // "tenant not authorized" is a 403: the caller proved who they are, they
      // just do not belong to an organization we serve.
      throw new AppError(403, 'UNKNOWN_TENANT', 'auth.errors.tenantNotAuthorized', [
        { path: 'tid', messageKey: `auth.errors.${tenantCheck.reason}` },
      ])
    }

    const objectId = typeof claims.oid === 'string' ? claims.oid.trim() : ''
    if (!objectId) {
      // Without `oid` there is no stable identity: the email can be reassigned.
      throw new AppError(401, 'UNAUTHORIZED', 'auth.errors.tokenInvalid')
    }

    const rawEmail =
      (typeof claims.preferred_username === 'string' ? claims.preferred_username : null) ??
      (typeof claims.email === 'string' ? claims.email : null)

    return {
      tenantId: tenantCheck.tenantId,
      objectId,
      email: rawEmail && rawEmail.includes('@') ? rawEmail.toLowerCase() : null,
      displayName: typeof claims.name === 'string' ? claims.name : null,
      claims,
    }
  }
}

let verifier: EntraVerifier | undefined

export function getEntraVerifier(options: EntraVerifierOptions): EntraVerifier {
  verifier ??= new EntraVerifier(options)
  return verifier
}

/** Test seam: drops the cached verifier so a suite can point at its own JWKS. */
export function resetEntraVerifier(): void {
  verifier = undefined
}
