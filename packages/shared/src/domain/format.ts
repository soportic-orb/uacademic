/**
 * Locale-aware formatting through `Intl` (CLAUDE.md §5). Pure ECMA-402, so the
 * same helpers work in the browser today and in the Expo app in phase 2.
 */
import type { AppLocale } from '../i18n/index.js'
import { type ClockTime, type Weekday, toMinutes } from './time.js'

const LOCALE_TAGS: Record<AppLocale, string> = {
  ca: 'ca-ES',
  es: 'es-ES',
  en: 'en-GB',
}

export function localeTag(locale: AppLocale): string {
  return LOCALE_TAGS[locale]
}

/**
 * Hour figures always show two decimals: they are compared against contracts,
 * and "18 h" versus "18,25 h" is not the same conversation.
 */
export function formatHours(locale: AppLocale, hours: number): string {
  return new Intl.NumberFormat(localeTag(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(hours)
}

export function formatPercent(locale: AppLocale, percent: number | null, fractionDigits = 0): string {
  if (percent === null) return '—'
  return new Intl.NumberFormat(localeTag(locale), {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(percent / 100)
}

export function formatNumber(
  locale: AppLocale,
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(localeTag(locale), options).format(value)
}

export function formatDate(
  locale: AppLocale,
  date: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(localeTag(locale), { timeZone: 'UTC', ...options }).format(date)
}

export function formatDateRange(locale: AppLocale, from: Date, to: Date): string {
  const formatter = new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  })
  return formatter.formatRange(from, to)
}

/**
 * Weekday name for an ISO weekday. The reference date is 2024-01-01, a Monday,
 * so weekday 1 always renders as Monday — the week starts on Monday.
 */
export function formatWeekday(
  locale: AppLocale,
  weekday: Weekday,
  style: Intl.DateTimeFormatOptions['weekday'] = 'long',
): string {
  const reference = new Date(Date.UTC(2024, 0, weekday))
  return new Intl.DateTimeFormat(localeTag(locale), { weekday: style, timeZone: 'UTC' }).format(
    reference,
  )
}

/** Ordered weekday list, Monday first. */
export function weekdayNames(
  locale: AppLocale,
  style: Intl.DateTimeFormatOptions['weekday'] = 'short',
): { weekday: Weekday; label: string }[] {
  return ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((weekday) => ({
    weekday,
    label: formatWeekday(locale, weekday, style),
  }))
}

/**
 * Times are stored and displayed in center-local time, so they are formatted
 * from the stored string rather than from a `Date` — no timezone conversion.
 */
export function formatTime(locale: AppLocale, time: ClockTime, hour12 = false): string {
  const minutes = toMinutes(time)
  const reference = new Date(Date.UTC(2024, 0, 1, Math.floor(minutes / 60), minutes % 60))
  return new Intl.DateTimeFormat(localeTag(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12,
    timeZone: 'UTC',
  }).format(reference)
}

export function formatTimeRange(
  locale: AppLocale,
  start: ClockTime,
  end: ClockTime,
  hour12 = false,
): string {
  return `${formatTime(locale, start, hour12)}–${formatTime(locale, end, hour12)}`
}

export function formatPersonName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim()
}
