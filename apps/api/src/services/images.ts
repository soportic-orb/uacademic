/**
 * Profile photographs and institution logos.
 *
 * They live beside the document library, outside the webroot, and are read
 * back through a route that checks who is asking. The picture of a person is
 * personal data even when it is flattering.
 *
 * The path is built from an id this server generated and the extension the
 * bytes turned out to have; nothing anybody typed reaches the filesystem.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { type ImageKind, sniffImage } from '@uacademic/shared'

import { env } from '../config/env.js'

export type ImageOwner = 'avatars' | 'universities'

function ownerRoot(owner: ImageOwner): string {
  return resolve(env().UPLOAD_DIR, 'images', owner)
}

/**
 * Replaces whatever was there: one owner has one picture, and leaving the old
 * JPEG behind when a PNG arrives would leave two files claiming to be it.
 */
export async function storeImage(
  owner: ImageOwner,
  ownerId: string,
  bytes: Uint8Array,
  kind: ImageKind,
): Promise<{ version: string }> {
  const root = ownerRoot(owner)
  await mkdir(root, { recursive: true })
  await deleteImage(owner, ownerId)
  await writeFile(join(root, `${ownerId}.${kind.extension}`), bytes)

  // Enough of the checksum to change the URL when the picture changes, which
  // is what stops a browser showing yesterday's face from its cache.
  return { version: createHash('sha256').update(bytes).digest('hex').slice(0, 12) }
}

async function storedFile(owner: ImageOwner, ownerId: string): Promise<string | null> {
  const entries = await readdir(ownerRoot(owner)).catch(() => [])
  const match = entries.find((entry) => entry.startsWith(`${ownerId}.`))
  return match ? join(ownerRoot(owner), match) : null
}

export async function readImage(
  owner: ImageOwner,
  ownerId: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const path = await storedFile(owner, ownerId)
  if (!path) return null

  const bytes = await readFile(path).catch(() => null)
  if (!bytes) return null

  // Sniffed rather than derived from the name: the name is ours, but the type
  // sent to a browser is worth reading from the bytes every time.
  const kind = sniffImage(bytes)
  if (!kind) return null

  return { bytes, mime: kind.mime }
}

export async function deleteImage(owner: ImageOwner, ownerId: string): Promise<void> {
  const path = await storedFile(owner, ownerId)
  if (path) await unlink(path).catch(() => undefined)
}

/**
 * The URL that goes into `users.avatar_url` / `universities.logo_url`.
 *
 * A path on our own API and not a location on disk: the column is what the
 * browser asks for, and the storage layout stays an implementation detail.
 */
export function avatarUrlFor(userId: string, version: string): string {
  return `/api/v1/users/${userId}/avatar?v=${version}`
}

export function universityLogoUrlFor(universityId: string, version: string): string {
  return `/api/v1/universities/${universityId}/logo?v=${version}`
}
