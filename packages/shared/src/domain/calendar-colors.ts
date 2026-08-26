/**
 * A colour per subject, so a week with six subjects in it can be read at a
 * glance rather than word by word.
 *
 * Assigned from the subject's own identifier rather than from its position in
 * a list: the colour of "Physics" then does not change when a subject is added
 * above it, and the screen, the printed PDF and a second person's screen all
 * agree without anybody passing colours around.
 *
 * Colour is never the only carrier — every event also shows its subject code
 * and group (R8) — so somebody who cannot tell two of these apart loses
 * nothing but convenience.
 */
export interface CalendarColor {
  /** Chip background. Light in both themes: an event is an island of paper. */
  background: string
  /** Text on that background. Dark, so the pair passes AA either way. */
  text: string
  /** The saturated version, for a border or a legend dot. */
  accent: string
}

/**
 * Ten hues, evenly spaced and distinguishable for the common forms of colour
 * blindness. Each background is a tint of its accent at roughly the same
 * lightness, so no one subject shouts louder than another.
 */
export const CALENDAR_PALETTE: readonly CalendarColor[] = [
  { background: '#D0E7FA', text: '#00335C', accent: '#0072CE' },
  { background: '#D9F2E3', text: '#0F3D26', accent: '#15803D' },
  { background: '#FBE3C7', text: '#5A3208', accent: '#B45309' },
  { background: '#E7DCF7', text: '#3B2464', accent: '#7C3AED' },
  { background: '#FAD6DC', text: '#611220', accent: '#BE123C' },
  { background: '#CFEEF2', text: '#0B3B44', accent: '#0E7490' },
  { background: '#EDE7C8', text: '#4A3F0B', accent: '#A16207' },
  { background: '#DCD9F5', text: '#2C2A63', accent: '#4338CA' },
  { background: '#D5EFD1', text: '#1E3E17', accent: '#4D7C0F' },
  { background: '#F6DCEE', text: '#5B1747', accent: '#A21CAF' },
]

/**
 * A stable index for a key.
 *
 * FNV-1a: short, dependency-free, and well spread over a handful of buckets —
 * which is all that is being asked of it. Nothing here is security.
 */
export function paletteIndex(key: string, buckets = CALENDAR_PALETTE.length): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % buckets
}

/**
 * The colour of a subject.
 *
 * A center that has chosen one for a subject gets that one; everything else
 * falls back to the palette, keyed on the subject's own identifier so the
 * colour is stable and nobody has to pass colours around.
 */
export function calendarColor(key: string, chosen?: string | null): CalendarColor {
  const accent = normalizeHex(chosen)
  if (accent) return colorFrom(accent)

  return CALENDAR_PALETTE[paletteIndex(key)] as CalendarColor
}

/** `#abc` and `#AABBCC` alike, or nothing at all if it is not a colour. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null
  const hex = value.trim().toLowerCase()

  if (/^#[0-9a-f]{6}$/.test(hex)) return hex
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return null
}

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function toHex(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel)))
    .toString(16)
    .padStart(2, '0')
}

/**
 * A chosen colour, turned into the three a calendar needs.
 *
 * The background is the colour thinned against white, and the text is the
 * same colour taken most of the way to black: a class is a chip of tinted
 * paper with dark writing on it, whichever colour was chosen, so the words
 * stay readable (R8) — which "just use the colour" would not guarantee for
 * the bright end of the picker.
 */
export function colorFrom(accent: string): CalendarColor {
  const [red, green, blue] = channels(accent)

  const tint = (channel: number) => toHex(channel + (255 - channel) * 0.82)
  const shade = (channel: number) => toHex(channel * 0.45)

  return {
    background: `#${tint(red)}${tint(green)}${tint(blue)}`,
    text: `#${shade(red)}${shade(green)}${shade(blue)}`,
    accent,
  }
}
