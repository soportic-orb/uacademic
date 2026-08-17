import { createCipheriv, randomBytes } from 'node:crypto'

import { argon2id } from 'hash-wasm'
import { Secret } from 'otpauth'

/**
 * The SUPERADMIN break-glass credential.
 *
 * Mirrors what the API does: argon2id for the password (WebAssembly, so no
 * native build on a shared host) and AES-256-GCM for the TOTP secret. Written
 * here rather than imported from the API so `packages/db` keeps no dependency
 * on the app.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    memorySize: 19_456,
    iterations: 2,
    parallelism: 1,
    hashLength: 32,
    outputType: 'encoded',
  })
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

/** Same `v1.<iv>.<tag>.<ciphertext>` layout the API reads. */
export function encryptSecret(plaintext: string, hexKey: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}
