/**
 * Clock time and interval primitives.
 *
 * Times are stored as `HH:MM` strings in center-local time (see CLAUDE.md §5).
 * Everything that reasons about them converts to minutes-since-midnight first:
 * integer arithmetic, no timezone, no floating point.
 */

/** `HH:MM`, 24-hour, center-local. */
export type ClockTime = string

/** ISO-8601 weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7]
export const WORKING_WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5]

export const MINUTES_PER_DAY = 24 * 60

const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export class InvalidClockTimeError extends Error {
  constructor(readonly value: string) {
    super(`Invalid clock time: "${value}". Expected HH:MM in 24-hour format.`)
    this.name = 'InvalidClockTimeError'
  }
}

export function isClockTime(value: unknown): value is ClockTime {
  return typeof value === 'string' && CLOCK_TIME_PATTERN.test(value)
}

export function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7
}

/** Minutes elapsed since midnight. Throws on anything that is not `HH:MM`. */
export function toMinutes(time: ClockTime): number {
  const match = CLOCK_TIME_PATTERN.exec(time)
  if (!match) throw new InvalidClockTimeError(String(time))
  return Number(match[1]) * 60 + Number(match[2])
}

/** Inverse of {@link toMinutes}. Accepts 0…1440 (1440 renders as `24:00`). */
export function fromMinutes(minutes: number): ClockTime {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    throw new RangeError(`Minutes out of range: ${minutes}. Expected 0…${MINUTES_PER_DAY}.`)
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/** A half-open time range `[start, end)` inside a single day. */
export interface TimeInterval {
  start: ClockTime
  end: ClockTime
}

export interface MinuteInterval {
  start: number
  end: number
}

export function toMinuteInterval(interval: TimeInterval): MinuteInterval {
  return { start: toMinutes(interval.start), end: toMinutes(interval.end) }
}

/** True when `end` is strictly after `start`. Zero-length intervals are invalid. */
export function isValidInterval(interval: TimeInterval): boolean {
  if (!isClockTime(interval.start) || !isClockTime(interval.end)) return false
  return toMinutes(interval.end) > toMinutes(interval.start)
}

export function durationMinutes(interval: TimeInterval): number {
  const { start, end } = toMinuteInterval(interval)
  return end - start
}

/** Duration in decimal hours, rounded to 2 decimals to match DECIMAL(6,2). */
export function durationHours(interval: TimeInterval): number {
  return round2(durationMinutes(interval) / 60)
}

/**
 * Intervals are half-open: a class ending at 10:00 does not collide with one
 * starting at 10:00. Touching endpoints are the normal case in a timetable, so
 * treating them as a conflict would flag every back-to-back session.
 */
export function overlaps(a: TimeInterval, b: TimeInterval): boolean {
  return overlapMinutes(a, b) > 0
}

export function overlapMinutes(a: TimeInterval, b: TimeInterval): number {
  const first = toMinuteInterval(a)
  const second = toMinuteInterval(b)
  return Math.max(0, Math.min(first.end, second.end) - Math.max(first.start, second.start))
}

/** True when `inner` fits entirely inside `outer` (endpoints included). */
export function contains(outer: TimeInterval, inner: TimeInterval): boolean {
  const o = toMinuteInterval(outer)
  const i = toMinuteInterval(inner)
  return i.start >= o.start && i.end <= o.end
}

/** A closed date range, both ends inclusive (`date_from` … `date_to`). */
export interface DateRange {
  from: Date
  to: Date
}

function atUtcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/** Date ranges are inclusive on both ends, unlike time intervals. */
export function dateRangesOverlap(a: DateRange, b: DateRange): boolean {
  return atUtcMidnight(a.from) <= atUtcMidnight(b.to) && atUtcMidnight(b.from) <= atUtcMidnight(a.to)
}

/** ISO weekday of a date: 1 = Monday … 7 = Sunday (the week starts on Monday). */
export function isoWeekday(date: Date): Weekday {
  const day = date.getUTCDay()
  return (day === 0 ? 7 : day) as Weekday
}

/** Rounds to 2 decimals, the precision of DECIMAL(6,2). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Sums hour figures without accumulating binary floating-point drift. */
export function sumHours(values: readonly number[]): number {
  return round2(values.reduce((total, value) => total + value, 0))
}

/**
 * Splits a day into consecutive slots of `slotMinutes`, discarding a trailing
 * partial slot. Used by the planner grid.
 */
export function slotsBetween(
  dayStart: ClockTime,
  dayEnd: ClockTime,
  slotMinutes: number,
): TimeInterval[] {
  if (!Number.isInteger(slotMinutes) || slotMinutes <= 0) {
    throw new RangeError(`slotMinutes must be a positive integer, got ${slotMinutes}`)
  }
  const start = toMinutes(dayStart)
  const end = toMinutes(dayEnd)
  const slots: TimeInterval[] = []
  for (let cursor = start; cursor + slotMinutes <= end; cursor += slotMinutes) {
    slots.push({ start: fromMinutes(cursor), end: fromMinutes(cursor + slotMinutes) })
  }
  return slots
}

/** Merges overlapping or touching intervals into the smallest equivalent set. */
export function mergeIntervals(intervals: readonly TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) return []
  const sorted = intervals
    .map(toMinuteInterval)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((interval) => interval.end > interval.start)

  const merged: MinuteInterval[] = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged.map((interval) => ({
    start: fromMinutes(interval.start),
    end: fromMinutes(interval.end),
  }))
}
