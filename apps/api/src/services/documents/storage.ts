/**
 * Where the files live.
 *
 * Outside the webroot, always: nothing under `UPLOAD_DIR` is ever reachable by
 * URL. Every read goes through an API route that checks the role and the
 * tenant first, so a link leaking is not the same as a document leaking.
 *
 * Paths are built only from ids this server generated. Nothing a person typed
 * — a filename, a title — reaches the filesystem.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { env } from '../../config/env.js'

export function documentsRoot(): string {
  return resolve(env().UPLOAD_DIR, 'documents')
}

/** `<uploads>/documents/<centerId>/<documentId>` — two server-made ids. */
export function documentPath(centerId: string, documentId: string): string {
  return join(documentsRoot(), centerId, documentId)
}

export function checksumOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function storeDocument(
  centerId: string,
  documentId: string,
  bytes: Uint8Array,
): Promise<{ path: string; sizeBytes: number }> {
  const path = documentPath(centerId, documentId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)

  return { path, sizeBytes: bytes.byteLength }
}

export async function readDocument(centerId: string, documentId: string): Promise<Buffer> {
  return readFile(documentPath(centerId, documentId))
}

export async function documentExists(centerId: string, documentId: string): Promise<boolean> {
  return stat(documentPath(centerId, documentId))
    .then(() => true)
    .catch(() => false)
}

export async function deleteDocument(centerId: string, documentId: string): Promise<void> {
  // A file that is already gone is the outcome we wanted.
  await unlink(documentPath(centerId, documentId)).catch(() => undefined)
}
