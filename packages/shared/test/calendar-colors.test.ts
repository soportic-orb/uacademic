/**
 * The colour a subject gets on the calendar.
 */
import { describe, expect, it } from 'vitest'

import { CALENDAR_PALETTE, calendarColor, paletteIndex } from '../src/domain/calendar-colors.js'

describe('a subject’s colour', () => {
  it('is the same every time it is asked for', () => {
    // The screen, the PDF and a colleague's screen all have to agree without
    // anybody passing colours around.
    expect(calendarColor('subject-a')).toEqual(calendarColor('subject-a'))
  })

  it('does not move when another subject is added', () => {
    // Which is what an index into a list would do.
    const before = calendarColor('fisica')
    void calendarColor('matematiques')
    expect(calendarColor('fisica')).toEqual(before)
  })

  it('spreads a realistic set of subjects over the palette', () => {
    const keys = Array.from({ length: 40 }, (_, index) => `0198f0d2-8f2a-7000-8000-${index}`)
    const used = new Set(keys.map((key) => paletteIndex(key)))

    // Not a guarantee of no collision — ten buckets and forty subjects — but
    // a hash that piled them into two would be worth knowing about.
    expect(used.size).toBeGreaterThanOrEqual(7)
  })

  it('always lands inside the palette, whatever it is given', () => {
    for (const key of ['', 'x', '💡', 'a'.repeat(500)]) {
      const index = paletteIndex(key)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(CALENDAR_PALETTE.length)
      expect(calendarColor(key).background).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })

  it('carries a background, its text colour and an accent for every entry', () => {
    for (const colour of CALENDAR_PALETTE) {
      expect(colour.background).toMatch(/^#[0-9A-F]{6}$/i)
      expect(colour.text).toMatch(/^#[0-9A-F]{6}$/i)
      expect(colour.accent).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })

  it('pairs every background with text dark enough to read on it', () => {
    // WCAG 2.2 AA for body text is 4.5:1, and these chips carry the subject
    // code and the room — which is text somebody has to read (R8).
    for (const colour of CALENDAR_PALETTE) {
      expect(contrast(colour.background, colour.text)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

function contrast(a: string, b: string): number {
  const lighter = Math.max(luminance(a), luminance(b))
  const darker = Math.min(luminance(a), luminance(b))
  return (lighter + 0.05) / (darker + 0.05)
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
