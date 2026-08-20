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
  WORKING_WEEKDAYS,
  dateRangesOverlap,
  isoWeekday,
  overlapMinutes,
  round2,
  slotsBetween,
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
   * Level applied to the part of the slot no entry covers.
   *
   * Defaults to `defaultFallback` below rather than to a fixed level.
   */
  fallback?: AvailabilityLevel
}

/**
 * What an hour nobody has spoken about means.
 *
 * Once somebody has said anything about their week, the gaps between what they
 * said are not consent: we are placing their class, and they left that hour
 * out. But somebody who has never opened the screen has not withheld anything
 * — they have simply not been asked — and treating that as a refusal made
 * every new teacher unplannable and their whole week red.
 */
export function defaultFallback(entries: readonly AvailabilityEntry[]): AvailabilityLevel {
  return entries.length === 0 ? 'available' : 'unavailable'
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
  const fallback = options.fallback ?? defaultFallback(entries)
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

/** Weekly hours declared at each level, for the editor legend. */
export function availabilityHoursByLevel(
  entries: readonly AvailabilityEntry[],
): Record<AvailabilityLevel, number> {
  return AVAILABILITY_LEVELS.reduce(
    (totals, level) => {
      totals[level] = weeklyAvailableHours(entries, [level])
      return totals
    },
    {} as Record<AvailabilityLevel, number>,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The editor grid
//
// The screen paints a matrix of weekdays × slots, but the database stores
// intervals. Both conversions live here, pure: the drag path and the keyboard
// path (R8) then act on the same model, and neither can drift from the other.
// ─────────────────────────────────────────────────────────────────────────────

export interface AvailabilityGridOptions {
  dayStart: ClockTime
  dayEnd: ClockTime
  slotMinutes: number
  weekdays?: readonly Weekday[]
  /** Level of a slot no entry covers. Defaults to `unavailable`. */
  fallback?: AvailabilityLevel
}

/** One painted cell: a slot of one weekday. */
export interface AvailabilityGridCell extends TimeInterval {
  weekday: Weekday
  level: AvailabilityLevel
}

export interface AvailabilityGridRow {
  weekday: Weekday
  cells: AvailabilityGridCell[]
}

export interface AvailabilityGrid {
  /** Column headers: the same slots on every weekday. */
  slots: TimeInterval[]
  weekdays: Weekday[]
  rows: AvailabilityGridRow[]
}

/** Address of a cell, as the UI reports the one under the pointer or the caret. */
export interface GridCellRef {
  weekday: Weekday
  start: ClockTime
}

function cellKey(weekday: Weekday, start: ClockTime): string {
  return `${weekday}|${start}`
}

/**
 * Renders stored entries as the grid the editor paints. A slot takes the most
 * restrictive level found inside it, so a half-hour of "unavailable" is never
 * hidden by the "available" half next to it.
 */
export function buildAvailabilityGrid(
  options: AvailabilityGridOptions,
  entries: readonly AvailabilityEntry[] = [],
): AvailabilityGrid {
  const fallback = options.fallback ?? defaultFallback(entries)
  const weekdays = [...(options.weekdays ?? WORKING_WEEKDAYS)]
  const slots = slotsBetween(options.dayStart, options.dayEnd, options.slotMinutes)

  return {
    slots,
    weekdays,
    rows: weekdays.map((weekday) => ({
      weekday,
      cells: slots.map((slot) => ({
        weekday,
        start: slot.start,
        end: slot.end,
        level: effectiveAvailability({ ...slot, weekday }, entries, { fallback }),
      })),
    })),
  }
}

/** Paints a level onto the given cells, returning a new grid. */
export function paintCells(
  grid: AvailabilityGrid,
  targets: readonly GridCellRef[],
  level: AvailabilityLevel,
): AvailabilityGrid {
  const painted = new Set(targets.map((target) => cellKey(target.weekday, target.start)))
  if (painted.size === 0) return grid

  return {
    ...grid,
    rows: grid.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) =>
        painted.has(cellKey(cell.weekday, cell.start)) ? { ...cell, level } : cell,
      ),
    })),
  }
}

/**
 * Every cell of the rectangle spanned by two corners. A drag reports its anchor
 * and the cell under the pointer; shift + arrows report exactly the same pair,
 * which is what makes the keyboard alternative equivalent rather than reduced.
 */
export function cellsInRectangle(
  grid: AvailabilityGrid,
  from: GridCellRef,
  to: GridCellRef,
): GridCellRef[] {
  const dayIndex = (weekday: Weekday) => grid.weekdays.indexOf(weekday)
  const slotIndex = (start: ClockTime) => grid.slots.findIndex((slot) => slot.start === start)

  const days = [dayIndex(from.weekday), dayIndex(to.weekday)]
  const times = [slotIndex(from.start), slotIndex(to.start)]
  if (days.includes(-1) || times.includes(-1)) return []

  const [dayFrom, dayTo] = [Math.min(...days), Math.max(...days)]
  const [slotFrom, slotTo] = [Math.min(...times), Math.max(...times)]

  const cells: GridCellRef[] = []
  for (let day = dayFrom; day <= dayTo; day += 1) {
    for (let slot = slotFrom; slot <= slotTo; slot += 1) {
      const weekday = grid.weekdays[day]
      const start = grid.slots[slot]?.start
      if (weekday !== undefined && start !== undefined) cells.push({ weekday, start })
    }
  }
  return cells
}

export interface GridToEntriesOptions {
  /**
   * A level to leave unstored, when the caller knows an absent entry already
   * means it.
   *
   * Nothing is omitted by default. It used to drop `unavailable`, which was
   * exactly right while an absent entry meant unavailable — but now that
   * having said nothing at all means *available* (see `defaultFallback`),
   * somebody painting their whole week red would have saved zero rows and been
   * read back as free every hour of it.
   */
  omitLevel?: AvailabilityLevel | null
}

/**
 * Turns the grid back into the intervals the database stores, merging
 * consecutive slots of the same level into a single row. Painting a whole
 * morning must not produce sixteen half-hour rows.
 */
export function gridToEntries(
  grid: AvailabilityGrid,
  options: GridToEntriesOptions = {},
): AvailabilityEntry[] {
  const omitLevel = options.omitLevel ?? null
  const entries: AvailabilityEntry[] = []

  for (const row of grid.rows) {
    let open: AvailabilityEntry | null = null

    for (const cell of row.cells) {
      const skip = cell.level === omitLevel
      const continues = open !== null && open.level === cell.level && open.endTime === cell.start

      if (!skip && continues && open) {
        open.endTime = cell.end
        continue
      }

      if (open) entries.push(open)
      open = skip
        ? null
        : { weekday: row.weekday, startTime: cell.start, endTime: cell.end, level: cell.level }
    }

    if (open) entries.push(open)
  }

  return entries
}
