/**
 * Pictures people upload of themselves and of their institution.
 *
 * Two things are decided here and nowhere else: what an image actually is, and
 * whether it is small enough to keep. Both are judged from the bytes — a
 * filename and a declared content type are claims made by whoever is uploading
 * (R7).
 */

export interface ImageKind {
  mime: string
  extension: string
}

/** What we are willing to store and hand back to a browser. */
export const ACCEPTED_IMAGE_MIMES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

/**
 * SVG is deliberately absent: it is a document that can carry script, and we
 * serve these back from our own origin.
 */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const starts = (signature: readonly number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte)

  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', extension: 'png' }
  }
  if (starts([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', extension: 'jpg' }
  // `RIFF....WEBP`: the four bytes between are the file size.
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: 'image/webp', extension: 'webp' }
  }
  if (starts([0x47, 0x49, 0x46, 0x38])) return { mime: 'image/gif', extension: 'gif' }

  return null
}

export type ImageRejection = 'unsupportedType' | 'tooLarge' | 'empty'

export interface ImageCheckInput {
  bytes: Uint8Array
  maxBytes: number
}

export type ImageCheck = { ok: true; kind: ImageKind } | { ok: false; reason: ImageRejection }

export function checkImageUpload({ bytes, maxBytes }: ImageCheckInput): ImageCheck {
  if (bytes.byteLength === 0) return { ok: false, reason: 'empty' }
  // Size before type: reading the signature of a 40 MB upload is work we do not
  // owe anybody.
  if (bytes.byteLength > maxBytes) return { ok: false, reason: 'tooLarge' }

  const kind = sniffImage(bytes)
  if (!kind) return { ok: false, reason: 'unsupportedType' }

  return { ok: true, kind }
}

/** The largest picture worth keeping of one person or one institution. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
