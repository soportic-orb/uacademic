/**
 * A teacher's timetable as something to print or to email.
 *
 * A4 landscape, one month per page, because that is what gets pinned above a
 * desk. The alternative — a list of dated lines — is what the calendar export
 * already produces, and it is fine for searching and useless for seeing a
 * month at a glance, which is the whole point of handing somebody a calendar.
 *
 * The dates come from the same expansion the ICS feed uses, so a class that
 * shows up in a phone's calendar and a class that shows up on this page are
 * the same class: the weekly template, minus the days the center is shut.
 */
import type { AppLocale } from '@uacademic/shared'
import { isInMonth, monthsBetween, translate, weeksBetween, weeksOfMonth } from '@uacademic/shared'
import PDFDocument from 'pdfkit'

import {
  expand,
  nonTeachingDates,
  publishedSessionsForProfile,
} from '../modules/calendar/routes.js'
import { type PrismaClient, prisma } from '../lib/prisma.js'

export interface ScheduleEntry {
  /** `YYYY-MM-DD`. */
  date: string
  startTime: string
  endTime: string
  subjectCode: string
  /** The subject in full: a code identifies a class only to whoever knows it. */
  subjectName: string
  groupCode: string
  spaceName: string | null
  /** What the class is about, when whoever planned it wrote it down. */
  topic: string | null
}

export interface SchedulePdfInput {
  teacherName: string
  centerName: string
  from: string
  to: string
  locale: AppLocale
  entries: readonly ScheduleEntry[]
  /**
   * How the page is laid out.
   *
   * `month` is a page per month, which is what somebody pins above a desk.
   * `weeks` is a page of exactly the weeks asked for — what the week view on
   * screen looks like, so printing it gives back the thing being looked at.
   */
  layout?: 'month' | 'weeks'
}

/** A4 landscape, in points. */
const PAGE = { width: 842, height: 595 }
const MARGIN = 32
const HEADER_HEIGHT = 56
const WEEKDAY_ROW = 16

const INK = '#0F172A'
const MUTED = '#64748B'
const RULE = '#CBD5E1'
const OUTSIDE = '#F1F5F9'

export async function scheduleMonthlyPdf(input: SchedulePdfInput): Promise<Buffer> {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(input.locale, key, params)

  const document = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margin: MARGIN,
    autoFirstPage: false,
    info: { Title: `${input.teacherName} — ${input.from} / ${input.to}` },
  })

  const chunks: Buffer[] = []
  document.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<Buffer>((resolve) =>
    document.on('end', () => resolve(Buffer.concat(chunks))),
  )

  const byDate = new Map<string, ScheduleEntry[]>()
  for (const entry of input.entries) {
    const day = byDate.get(entry.date) ?? []
    day.push(entry)
    byDate.set(entry.date, day)
  }
  for (const day of byDate.values()) {
    day.sort((a, b) => a.startTime.localeCompare(b.startTime))
  }

  const months = monthsBetween(input.from, input.to)

  // A range with nothing in it still produces a page: an empty document that
  // downloads and opens on nothing looks like a failure.
  if (months.length === 0) {
    document.addPage()
    drawHeader(document, input, t, '')
    document
      .fontSize(11)
      .fillColor(MUTED)
      .text(t('calendar.empty'), MARGIN, HEADER_HEIGHT + MARGIN)
    document.end()
    return finished
  }

  if (input.layout === 'weeks') {
    // One page, the weeks the range covers: every day in it belongs to the
    // period asked for, so nothing is greyed out as filler.
    document.addPage()
    drawHeader(document, input, t, '')
    drawGrid(document, {
      weeks: weeksBetween(input.from, input.to),
      byDate,
      locale: input.locale,
      from: input.from,
      to: input.to,
      belongs: () => true,
    })
    document.end()
    return finished
  }

  for (const { year, month } of months) {
    document.addPage()
    const monthName = new Intl.DateTimeFormat(input.locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, 1)))

    drawHeader(document, input, t, monthName)
    drawGrid(document, {
      weeks: weeksOfMonth(year, month),
      byDate,
      locale: input.locale,
      from: input.from,
      to: input.to,
      belongs: (date) => isInMonth(date, year, month),
    })
  }

  document.end()
  return finished
}

function drawHeader(
  document: PDFKit.PDFDocument,
  input: SchedulePdfInput,
  t: (key: string, params?: Record<string, string | number>) => string,
  monthName: string,
): void {
  document
    .fillColor(INK)
    .fontSize(16)
    .text(monthName || t('calendar.title'), MARGIN, MARGIN)

  document
    .fillColor(MUTED)
    .fontSize(9)
    .text(
      `${input.teacherName} · ${input.centerName} · ${input.from} – ${input.to}`,
      MARGIN,
      MARGIN + 22,
    )
}

interface GridOptions {
  /** The rows of the page, each seven ISO dates from Monday. */
  weeks: string[][]
  byDate: Map<string, ScheduleEntry[]>
  locale: AppLocale
  from: string
  to: string
  /** Whether a date is part of the period, or filler from a neighbour. */
  belongs: (date: string) => boolean
}

function drawGrid(document: PDFKit.PDFDocument, options: GridOptions): void {
  const weeks = options.weeks
  const top = MARGIN + HEADER_HEIGHT
  const width = PAGE.width - MARGIN * 2
  const height = PAGE.height - top - MARGIN
  const cellWidth = width / 7
  const cellHeight = (height - WEEKDAY_ROW) / weeks.length

  const weekdayNames = weekdayHeadings(options.locale)
  document.fontSize(8).fillColor(MUTED)
  weekdayNames.forEach((name, index) => {
    document.text(name, MARGIN + index * cellWidth + 4, top, {
      width: cellWidth - 8,
      align: 'left',
    })
  })

  weeks.forEach((week, rowIndex) => {
    week.forEach((date, columnIndex) => {
      const x = MARGIN + columnIndex * cellWidth
      const y = top + WEEKDAY_ROW + rowIndex * cellHeight
      const inMonth = options.belongs(date)
      // Outside the requested range is drawn like a neighbouring month: the
      // page is the month, but only what was asked for is filled in.
      const inRange = date >= options.from && date <= options.to

      if (!inMonth || !inRange) {
        document.rect(x, y, cellWidth, cellHeight).fill(OUTSIDE)
      }

      document.lineWidth(0.5).strokeColor(RULE).rect(x, y, cellWidth, cellHeight).stroke()

      document
        .fillColor(inMonth ? INK : MUTED)
        .fontSize(9)
        .text(String(Number(date.slice(8, 10))), x + 4, y + 3, {
          width: cellWidth - 8,
          align: 'right',
        })

      const entries = inMonth && inRange ? (options.byDate.get(date) ?? []) : []
      let lineY = y + 15

      for (const entry of entries) {
        // Silently dropping what does not fit would be the worst outcome — a
        // class that exists and is not on the page — so the day says how many
        // it could not show.
        if (lineY + 16 > y + cellHeight - 4) {
          document
            .fillColor(MUTED)
            .fontSize(6.5)
            .text(`+${entries.length - entries.indexOf(entry)}`, x + 4, y + cellHeight - 10, {
              width: cellWidth - 8,
            })
          break
        }

        // The whole hour, not only when it starts: a printed timetable is
        // read away from the screen, and "when does this finish?" is the
        // second question anybody asks of it.
        document
          .fillColor(INK)
          .fontSize(6.5)
          .text(
            `${entry.startTime}–${entry.endTime} ${entry.subjectCode} ${entry.groupCode}`,
            x + 4,
            lineY,
            { width: cellWidth - 8, lineBreak: false, ellipsis: true },
          )

        // What the class is: its topic where somebody wrote one, and the
        // subject's name where they did not.
        document
          .fillColor(MUTED)
          .fontSize(6)
          .text(entry.topic ?? entry.subjectName, x + 4, lineY + 7, {
            width: cellWidth - 8,
            lineBreak: false,
            ellipsis: true,
          })

        if (entry.spaceName) {
          document
            .fillColor(MUTED)
            .fontSize(6)
            .text(entry.spaceName, x + 4, lineY + 13, {
              width: cellWidth - 8,
              lineBreak: false,
              ellipsis: true,
            })
        }

        lineY += entry.spaceName ? 22 : 16
      }
    })
  })
}

/** Monday first (CLAUDE.md §5), in the reader's own language. */
function weekdayHeadings(locale: AppLocale): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  // 2026-01-05 was a Monday.
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2026, 0, 5 + index))),
  )
}

/**
 * One teacher's PDF, from the published timetable.
 *
 * Drafts never reach it: publishing is what makes a timetable real, and a
 * lecturer who prints a draft plans their term around something that has not
 * been agreed.
 */
export async function buildSchedulePdf(
  context: {
    centerId: string
    db: PrismaClient
  },
  teacherProfileId: string,
  range: { from: string; to: string },
  locale: AppLocale,
): Promise<{ buffer: Buffer; teacherName: string; email: string }> {
  const client = prisma()

  const profile = await context.db.teacherProfile.findFirstOrThrow({
    where: { id: teacherProfileId },
    select: {
      user: { select: { firstName: true, lastName: true, email: true } },
      center: { select: { name: true } },
    },
  })

  const sessions = await publishedSessionsForProfile(context.db, teacherProfileId)
  const excluded = await nonTeachingDates(client, range.from, range.to)
  const rows = expand(sessions, range.from, range.to, excluded)

  const teacherName = `${profile.user.firstName} ${profile.user.lastName}`

  const buffer = await scheduleMonthlyPdf({
    teacherName,
    centerName: profile.center.name,
    from: range.from,
    to: range.to,
    locale,
    entries: rows.map((row) => ({
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      subjectCode: row.subjectCode,
      subjectName: row.subjectName,
      groupCode: row.groupCode,
      spaceName: row.spaceName,
      topic: row.topic,
    })),
  })

  return { buffer, teacherName, email: profile.user.email }
}
