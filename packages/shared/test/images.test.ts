import { describe, expect, it } from 'vitest'

import { MAX_IMAGE_BYTES, checkImageUpload, sniffImage } from '../src/domain/images.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
])
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])

describe('recognising an uploaded picture', () => {
  it('reads the format from the bytes, not from what was claimed', () => {
    expect(sniffImage(PNG)).toEqual({ mime: 'image/png', extension: 'png' })
    expect(sniffImage(JPEG)).toEqual({ mime: 'image/jpeg', extension: 'jpg' })
    expect(sniffImage(WEBP)).toEqual({ mime: 'image/webp', extension: 'webp' })
    expect(sniffImage(GIF)).toEqual({ mime: 'image/gif', extension: 'gif' })
  })

  /**
   * These come back out of our own origin, where a document that can carry
   * script is a document that runs with our cookies.
   */
  it('refuses SVG however convincingly it announces itself', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')

    expect(sniffImage(svg)).toBeNull()
    expect(checkImageUpload({ bytes: svg, maxBytes: MAX_IMAGE_BYTES })).toEqual({
      ok: false,
      reason: 'unsupportedType',
    })
  })

  it('refuses a WEBP header that is only the RIFF half of one', () => {
    const riff = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])

    expect(sniffImage(riff)).toBeNull()
  })

  it('rejects what is too big and what is nothing at all', () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1)
    big.set(PNG)

    expect(checkImageUpload({ bytes: big, maxBytes: MAX_IMAGE_BYTES })).toEqual({
      ok: false,
      reason: 'tooLarge',
    })
    expect(checkImageUpload({ bytes: new Uint8Array(0), maxBytes: MAX_IMAGE_BYTES })).toEqual({
      ok: false,
      reason: 'empty',
    })
  })

  it('accepts a picture and says what it turned out to be', () => {
    expect(checkImageUpload({ bytes: JPEG, maxBytes: MAX_IMAGE_BYTES })).toEqual({
      ok: true,
      kind: { mime: 'image/jpeg', extension: 'jpg' },
    })
  })
})
