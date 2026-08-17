import { describe, expect, it } from 'vitest'

import { EncryptionKeyError, decryptSecret, encryptSecret, parseKey } from '../src/lib/crypto.js'

const KEY = 'a'.repeat(64)

describe('calendar token encryption', () => {
  it('round-trips a token', () => {
    const token = 'ya29.a0AfB_demo-refresh-token'
    const encrypted = encryptSecret(token, KEY)

    expect(encrypted).not.toContain(token)
    expect(encrypted.startsWith('v1.')).toBe(true)
    expect(decryptSecret(encrypted, KEY)).toBe(token)
  })

  it('produces a different ciphertext every time', () => {
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY))
  })

  it('refuses a tampered payload', () => {
    const encrypted = encryptSecret('secret', KEY)
    const [version, iv, tag, ciphertext] = encrypted.split('.')
    const tampered = [version, iv, tag, `${ciphertext!.slice(0, -2)}AA`].join('.')

    expect(() => decryptSecret(tampered, KEY)).toThrow()
  })

  it('refuses the wrong key', () => {
    const encrypted = encryptSecret('secret', KEY)
    expect(() => decryptSecret(encrypted, 'b'.repeat(64))).toThrow()
  })

  it('rejects a malformed key instead of silently padding it', () => {
    expect(() => parseKey(undefined)).toThrow(EncryptionKeyError)
    expect(() => parseKey('too-short')).toThrow(EncryptionKeyError)
    expect(parseKey(KEY)).toHaveLength(32)
  })
})
