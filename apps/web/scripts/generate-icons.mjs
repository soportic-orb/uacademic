/**
 * The app icons, drawn rather than committed as binaries nobody can review.
 *
 * The mark is the one in `favicon.svg` — a rounded corporate-blue square with
 * a white "U" — rasterised here so the manifest can offer the PNG sizes iOS
 * and Android actually ask for. Run `pnpm --filter @uacademic/web icons` after
 * changing the mark; the output is committed so a build needs no image
 * toolchain on the server (CLAUDE.md §2: shared host, no native dependencies).
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const BLUE = [0x00, 0x72, 0xce]
const WHITE = [0xff, 0xff, 0xff]
/** 4×4 supersampling: the curve of the U is the whole point of the mark. */
const SAMPLES = 4

/** Signed-distance helpers, all in a 0..1 unit square. */
function insideRoundedSquare(x, y, radius, inset) {
  const min = inset
  const max = 1 - inset
  if (x < min || x > max || y < min || y > max) return false

  const cx = Math.min(Math.max(x, min + radius), max - radius)
  const cy = Math.min(Math.max(y, min + radius), max - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 + 1e-9
}

/**
 * The "U": two verticals closed by a half-round bottom, as a stroke of a fixed
 * width — the same shape as the SVG path, expressed as distance to it.
 */
function insideU(x, y, geometry) {
  const { left, right, top, arcCenterY, radius, stroke } = geometry
  const half = stroke / 2

  if (y <= arcCenterY) {
    if (y < top - half) return false
    const onLeft = Math.abs(x - left) <= half
    const onRight = Math.abs(x - right) <= half
    return onLeft || onRight
  }

  const cx = (left + right) / 2
  const distance = Math.hypot(x - cx, y - arcCenterY)
  return Math.abs(distance - radius) <= half
}

function drawIcon(size, { padding = 0.06, cornerRadius = 0.22, glyphPadding = padding } = {}) {
  const pixels = Buffer.alloc(size * size * 4)
  const inset = padding
  const usable = 1 - 2 * inset

  // The mark keeps its own margin: on a maskable icon the blue runs to the
  // edges while the "U" stays inside the safe area Android will not crop.
  const glyphInset = glyphPadding
  const glyphSpan = 1 - 2 * glyphInset

  const geometry = {
    left: glyphInset + glyphSpan * 0.28,
    right: glyphInset + glyphSpan * 0.72,
    top: glyphInset + glyphSpan * 0.24,
    arcCenterY: glyphInset + glyphSpan * 0.56,
    radius: (glyphSpan * 0.44) / 2,
    stroke: glyphSpan * 0.13,
  }

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let background = 0
      let glyph = 0

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / size
          const y = (py + (sy + 0.5) / SAMPLES) / size

          if (!insideRoundedSquare(x, y, cornerRadius * usable, inset)) continue
          background += 1
          if (insideU(x, y, geometry)) glyph += 1
        }
      }

      const total = SAMPLES * SAMPLES
      const alpha = background / total
      const mix = background === 0 ? 0 : glyph / background
      const offset = (py * size + px) * 4

      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(BLUE[channel] * (1 - mix) + WHITE[channel] * mix)
      }
      pixels[offset + 3] = Math.round(alpha * 255)
    }
  }

  return pixels
}

/* ─────────────────────────── a minimal PNG writer ─────────────────────────── */

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  header[10] = 0
  header[11] = 0
  header[12] = 0

  // One filter byte per scanline; filter 0 (none) keeps the writer honest.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let row = 0; row < size; row += 1) {
    raw[row * (size * 4 + 1)] = 0
    pixels.copy(raw, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const ICONS = [
  { file: 'icon-192.png', size: 192, options: {} },
  { file: 'icon-512.png', size: 512, options: {} },
  // Maskable: the launcher crops the square to whatever shape it likes, so
  // the blue fills it entirely and the mark stays inside the safe area.
  {
    file: 'icon-maskable-512.png',
    size: 512,
    options: { padding: 0, cornerRadius: 0, glyphPadding: 0.2 },
  },
  // iOS rounds the corners itself and does not honour transparency.
  {
    file: 'apple-touch-icon.png',
    size: 180,
    options: { padding: 0, cornerRadius: 0, glyphPadding: 0.14 },
  },
]

mkdirSync(OUT, { recursive: true })

for (const icon of ICONS) {
  const pixels = drawIcon(icon.size, icon.options)
  writeFileSync(join(OUT, icon.file), encodePng(icon.size, pixels))
  console.log(`${icon.file} · ${icon.size}×${icon.size}`)
}
