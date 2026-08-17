import { Secret, TOTP } from 'otpauth'

/**
 * Second factor for the local SUPERADMIN account. RFC 6238, 30-second steps,
 * six digits — whatever authenticator the operator already uses.
 *
 * The secret is stored AES-256-GCM encrypted (see `lib/crypto.ts`); this
 * module only ever sees it in memory.
 */
const ISSUER = 'UAcademic'
const DIGITS = 6
const PERIOD = 30
/** Accepts the neighbouring step so a slightly skewed phone still works. */
const WINDOW = 1

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

export function buildTotp(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  })
}

/** The `otpauth://` URI an authenticator app scans. */
export function totpEnrollmentUri(secretBase32: string, label: string): string {
  return buildTotp(secretBase32, label).toString()
}

export function verifyTotp(secretBase32: string, token: string): boolean {
  const normalized = token.replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return false

  const delta = buildTotp(secretBase32, ISSUER).validate({ token: normalized, window: WINDOW })
  return delta !== null
}

/** Current code for a secret. Used by tests and by the enrolment preview. */
export function currentTotp(secretBase32: string, timestamp?: number): string {
  const totp = buildTotp(secretBase32, ISSUER)
  return timestamp === undefined ? totp.generate() : totp.generate({ timestamp })
}
