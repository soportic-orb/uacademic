/**
 * Teacher availability.
 *
 * A teacher declares weekly windows with a level, plus dated exceptions. The
 * planner asks one question: "what is the effective level of this slot?".
 */
import {
  type ClockTime,
  type TimeInterval,
  type Weekday,
  dateRangesOverlap,
  isoWeekday,
  overlapMinutes,
  round2,
  toMinuteInterval,
} from './time.js'

export type AvailabilityLevel = 'preferred' | 'available' | 'avoid' | 'unavailable'

export const AVAILABILITY_LEVELS: readonly AvailabilityLevel[] = [
  'preferred',
  'available',
  'avoid',
  'unavailable',
]

/** Higher rank = more restrictive. The most restrictive level always wins. */
const RESTRICTIVENESS: Record<AvailabilityLevel, number> = {
  preferred: 0,
  available: 1,
  avoid: 2,
  unavailable: 3,
}

export function mostRestrictive(
  a: AvailabilityLevel,
  b: AvailabilityLevel | undefined,
): AvailabilityLevel {
  if (!b) return a
  return RESTRICTIVENESS[a] >= RESTRICTIVENESS[b] ? a : b
}

/** A slot can be planned unless the teacher is unavailable; `avoid` is a warning. */
export function isAssignable(level: AvailabilityLevel): boolean {
  return level !== 'unavailable'
}

export interface AvailabilityEntry {
  weekday: Weekday
  startTime: ClockTime
  endTime: ClockTime
  level: AvailabilityLevel
}

export interface AvailabilityExceptionEntry {
  dateFrom: Date
  dateTo: Date
  level: AvailabilityLevel
}

export interface WeeklySlot extends TimeInterval {
  weekday: Weekday
}

export interface EffectiveAvailabilityOptions {
  /**
   * Level applied to the part of the slot no entry covers. Defaults to
   * `unavailable`: silence is not consent when we are placing someone's class.
   */
  fallback?: AvailabilityLevel
}

/**
 * Effective level of a weekly slot: the most restrictive level found across it,
 * counting any uncovered minute as the fallback level.
 */
export function effectiveAvailability(
  slot: WeeklySlot,
  entries: readonly AvailabilityEntry[],
  options: EffectiveAvailabilityOptions = {},
): AvailabilityLevel {
  const fallback = options.fallback ?? 'unavailable'
  const { start, end } = toMinuteInterval(slot)
  const slotMinutes = end - start
  if (slotMinutes <= 0) return fallback

  // Entries carry `startTime`/`endTime`; the interval helpers speak
  // `start`/`end`, so they are normalised once here.
  const relevant = entries
    .filter((entry) => entry.weekday === slot.weekday)
    .map((entry) => ({
      level: entry.level,
      interval: { start: entry.startTime, end: entry.endTime },
    }))
    .filter((entry) => overlapMinutes(entry.interval, { start: slot.start, end: slot.end }) > 0)

  if (relevant.length === 0) return fallback

  // Walk the slot minute-window by minute-window over entry boundaries: the
  // level of every covered portion counts, and any gap counts as the fallback.
  const boundaries = new Set<number>([start, end])
  for (const entry of relevant) {
    const interval = toMinuteInterval(entry.interval)
    if (interval.start > start && interval.start < end) boundaries.add(interval.start)
    if (interval.end > start && interval.end < end) boundaries.add(interval.end)
  }

  const points = [...boundaries].sort((a, b) => a - b)
  let result: AvailabilityLevel | undefined

  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]
    const to = points[i + 1]
    if (from === undefined || to === undefined || to <= from) continue

    let segment: AvailabilityLevel | undefined
    for (const entry of relevant) {
      const interval = toMinuteInterval(entry.interval)
      if (interval.start <= from && interval.end >= to) {
        segment = mostRestrictive(entry.level, segment)
      }
    }
    result = mostRestrictive(segment ?? fallback, result)
  }

  return result ?? fallback
}

/**
 * Same question, for a concrete date: a dated exception (leave, conference…)
 * overrides the weekly pattern when it is more restrictive.
 */
export function effectiveAvailabilityOnDate(
  date: Date,
  slot: TimeInterval,
  entries: readonly AvailabilityEntry[],
  exceptions: readonly AvailabilityExceptionEntry[] = [],
  options: EffectiveAvailabilityOptions = {},
): AvailabilityLevel {
  const weekday = isoWeekday(date)
  const weekly = effectiveAvailability({ ...slot, weekday }, entries, options)

  const applicable = exceptions.filter((exception) =>
    dateRangesOverlap({ from: exception.dateFrom, to: exception.dateTo }, { from: date, to: date }),
  )

  return applicable.reduce<AvailabilityLevel>(
    (level, exception) => mostRestrictive(exception.level, level),
    weekly,
  )
}

/** Weekly hours a teacher offers, counting only levels that can be planned. */
export function weeklyAvailableHours(
  entries: readonly AvailabilityEntry[],
  levels: readonly AvailabilityLevel[] = ['preferred', 'available'],
): number {
  const allowed = new Set(levels)
  const minutes = entries
    .filter((entry) => allowed.has(entry.level))
    .reduce((total, entry) => {
      const interval = toMinuteInterval({ start: entry.startTime, end: entry.endTime })
      return total + Math.max(0, interval.end - interval.start)
    }, 0)
  return round2(minutes / 60)
}
