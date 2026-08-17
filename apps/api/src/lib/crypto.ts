import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM for the tokens stored in `calendar_connections` and
 * `calendar_feed_tokens` (CLAUDE.md §5). The key never leaves the environment.
 *
 * Payload layout: `v1.<iv>.<authTag>.<ciphertext>`, all base64url. The version
 * prefix is what will make key rotation possible without guessing.
 */
const VERSION = 'v1'
const IV_BYTES = 12

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EncryptionKeyError'
  }
}

export function parseKey(hexKey: string | undefined): Buffer {
  if (!hexKey) {
    throw new EncryptionKeyError('APP_ENCRYPTION_KEY is not set')
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new EncryptionKeyError('APP_ENCRYPTION_KEY must be 32 bytes in hex (64 characters)')
  }
  return Buffer.from(hexKey, 'hex')
}

export function encryptSecret(plaintext: string, hexKey: string | undefined): string {
  const key = parseKey(hexKey)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptSecret(payload: string, hexKey: string | undefined): string {
  const key = parseKey(hexKey)
  const [version, iv, authTag, ciphertext] = payload.split('.')

  if (version !== VERSION || !iv || !authTag || !ciphertext) {
    throw new EncryptionKeyError('Malformed encrypted payload')
  }

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** Opaque token for calendar feed URLs. Stored hashed, never reversible. */
export function generateFeedToken(): string {
  return randomBytes(32).toString('hex')
}
