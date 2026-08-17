import { randomBytes, timingSafeEqual } from 'node:crypto'

import { argon2Verify, argon2id } from 'hash-wasm'

/**
 * Password hashing for the SUPERADMIN break-glass account.
 *
 * argon2id via WebAssembly rather than a native binding: the target is a
 * shared host without build tools, where `node-gyp` is not an option. Same
 * algorithm, no compilation step.
 */
const MEMORY_KIB = 19_456 // 19 MiB — the OWASP baseline for argon2id
const ITERATIONS = 2
const PARALLELISM = 1
const HASH_LENGTH = 32

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    memorySize: MEMORY_KIB,
    iterations: ITERATIONS,
    parallelism: PARALLELISM,
    hashLength: HASH_LENGTH,
    outputType: 'encoded',
  })
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: encoded })
  } catch {
    return false
  }
}

/** Constant-time comparison for tokens that are not password hashes. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export const LOCKOUT_THRESHOLD = 5
export const LOCKOUT_MINUTES = 15

export function nextLockout(failedAttempts: number, now: Date = new Date()): Date | null {
  if (failedAttempts < LOCKOUT_THRESHOLD) return null
  return new Date(now.getTime() + LOCKOUT_MINUTES * 60_000)
}

export function isLockedOut(lockedUntil: Date | null | undefined, now: Date = new Date()): boolean {
  return Boolean(lockedUntil && lockedUntil.getTime() > now.getTime())
}
