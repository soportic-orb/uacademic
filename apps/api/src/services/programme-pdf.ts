/**
 * The teaching programme of a year, as one document to hand round.
 *
 * The calendar views answer "what is on this week?". This one answers "what is
 * the plan?": every class of the year at a glance — the months across the top,
 * a dot on each day something happens, in the colour of the subject it belongs
 * to — followed by the classes themselves as a list, in date order, with what
 * each one is about, who gives it and where.
 *
 * A4 portrait, because a list reads down a page and this is mostly list. The
 * dates come from the same expansion every other calendar uses, so the paper
 * and the screen cannot disagree about when a class happens.
 */
import type { AppLocale } from '@uacademic/shared'
import { calendarColor, isInMonth, monthsBetween, translate, weeksOfMonth } from '@uacademic/shared'
import PDFDocument from 'pdfkit'

export interface ProgrammeEntry {
  /** `YYYY-MM-DD`. */
  date: string
  startTime: string
  endTime: string
  subjectId: string
  subjectCode: string
  subjectName: string
  /** The colour the center chose for the subject, if it chose one. */
  subjectColor?: string | null
  groupCode: string
  /** What kind of class it is, when the center keeps a list of kinds. */
  classTypeId?: string | null
  classTypeName?: string | null
  /** The colour that kind of class is washed with, if one was chosen. */
  classTypeColor?: string | null
  /** What the class is about, when whoever planned it wrote it down. */
  topic: string | null
  /** Everyone giving it, already joined: a shared class has two names. */
  teacherName: string | null
  spaceName: string | null
}

export interface ProgrammePdfInput {
  title: string
  centerName: string
  /** Whose programme it is, or which filters produced it. */
  note?: string
  from: string
  to: string
  locale: AppLocale
  entries: readonly ProgrammeEntry[]
}

/** A4 portrait, in points. */
const PAGE = { width: 595, height: 842 }
const MARGIN = 36
const CONTENT = PAGE.width - MARGIN * 2

const INK = '#0F172A'
const MUTED = '#64748B'
const RULE = '#CBD5E1'

/** The list's columns, as fractions of the width they are given. */
const COLUMNS = [
  { key: 'date', width: 62 },
  { key: 'time', width: 74 },
  { key: 'topic', width: 0 },
  { key: 'teacher', width: 118 },
  { key: 'space', width: 82 },
] as const

const ROW_HEIGHT = 15

/** The strip of month calendars: four across, which fits an A4 page. */
const MONTH_COLUMNS = 4
const MONTH_GAP = 10
const MONTH_WIDTH = (CONTENT - MONTH_GAP * (MONTH_COLUMNS - 1)) / MONTH_COLUMNS
const MINI_CELL = MONTH_WIDTH / 7
/** A day of a mini calendar: its number, with room for the dots beneath. */
const MINI_ROW = 11

export async function programmePdf(input: ProgrammePdfInput): Promise<Buffer> {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(input.locale, key, params)

  const document = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margin: MARGIN,
    autoFirstPage: false,
    info: { Title: `${input.title} — ${input.from} / ${input.to}` },
  })

  const chunks: Buffer[] = []
  document.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<Buffer>((resolve) =>
    document.on('end', () => resolve(Buffer.concat(chunks))),
  )

  const entries = [...input.entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
  )

  document.addPage()
  let y = drawHeader(document, input, t)
  y = drawMonths(document, entries, input, y)
  y = drawLegend(document, entries, y)

  if (entries.length === 0) {
    document
      .fontSize(11)
      .fillColor(MUTED)
      .text(t('calendar.empty'), MARGIN, y + 8)
    document.end()
    return finished
  }

  y = drawColumnHeadings(document, t, y + 10)

  for (const entry of entries) {
    // A row that would fall off the bottom starts the next page, under its own
    // headings: a table whose columns are named on page one only is a table
    // nobody can read on page two.
    if (y + ROW_HEIGHT > PAGE.height - MARGIN) {
      document.addPage()
      y = drawColumnHeadings(document, t, MARGIN)
    }

    y = drawRow(document, entry, input.locale, y)
  }

  document.end()
  return finished
}

function drawHeader(
  document: PDFKit.PDFDocument,
  input: ProgrammePdfInput,
  t: (key: string, params?: Record<string, string | number>) => string,
): number {
  document
    .fillColor(INK)
    .fontSize(16)
    .text(input.title || t('calendar.title'), MARGIN, MARGIN)

  document
    .fillColor(MUTED)
    .fontSize(9)
    .text(
      [input.centerName, `${input.from} – ${input.to}`, input.note].filter(Boolean).join(' · '),
      MARGIN,
      MARGIN + 20,
    )

  return MARGIN + 38
}

/**
 * The year across the top, as calendars.
 *
 * One small month grid per teaching month — Monday first, the weeks reading
 * down as they do on a wall — with a dot on every day that has a class, in the
 * colour of the subject it belongs to. Several subjects on one day means
 * several dots side by side: the question this answers is "which days are
 * busy, and with what", not how many classes each holds.
 *
 * They come before the list because that is the order somebody reads a plan
 * in: the shape of the year first, then the classes that make it up.
 */
function drawMonths(
  document: PDFKit.PDFDocument,
  entries: readonly ProgrammeEntry[],
  input: ProgrammePdfInput,
  top: number,
): number {
  const months = monthsBetween(input.from, input.to)
  if (months.length === 0) return top

  const byDate = new Map<string, ProgrammeEntry[]>()
  for (const entry of entries) {
    const day = byDate.get(entry.date) ?? []
    day.push(entry)
    byDate.set(entry.date, day)
  }

  const weekdays = weekdayInitials(input.locale)
  let y = top

  for (let index = 0; index < months.length; index += MONTH_COLUMNS) {
    const row = months.slice(index, index + MONTH_COLUMNS)
    let tallest = 0

    for (const [column, { year, month }] of row.entries()) {
      const height = drawMonth(document, {
        x: MARGIN + column * (MONTH_WIDTH + MONTH_GAP),
        y,
        year,
        month,
        weekdays,
        locale: input.locale,
        byDate,
      })
      tallest = Math.max(tallest, height)
    }

    y += tallest + MONTH_GAP
  }

  return y + 4
}

interface MonthOptions {
  x: number
  y: number
  year: number
  /** 1 = January, as `monthsBetween` gives it. */
  month: number
  weekdays: string[]
  locale: AppLocale
  byDate: Map<string, ProgrammeEntry[]>
}

/** One month, drawn from its own top-left corner. Returns how tall it came out. */
function drawMonth(document: PDFKit.PDFDocument, options: MonthOptions): number {
  const label = new Intl.DateTimeFormat(options.locale, {
    month: 'long',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(options.year, options.month - 1, 1)))

  document
    .fontSize(7)
    .fillColor(INK)
    .text(label, options.x, options.y, { width: MONTH_WIDTH, lineBreak: false, ellipsis: true })

  const headingsY = options.y + 9
  document.fontSize(5).fillColor(MUTED)
  options.weekdays.forEach((name, column) => {
    document.text(name, options.x + column * MINI_CELL, headingsY, {
      width: MINI_CELL,
      align: 'center',
      lineBreak: false,
    })
  })

  const weeks = weeksOfMonth(options.year, options.month)
  const gridTop = headingsY + 7

  weeks.forEach((week, rowIndex) => {
    week.forEach((date, column) => {
      // Days of the months either side keep their place empty: the shape of
      // the month is part of what makes it recognisable at a glance.
      if (!isInMonth(date, options.year, options.month)) return

      const x = options.x + column * MINI_CELL
      const cellTop = gridTop + rowIndex * MINI_ROW
      const onThisDay = options.byDate.get(date) ?? []

      /*
        The kind of class the day is given over to, as a wash behind it: the
        first one of the day, because a day is usually one kind of work and a
        cell this small cannot say "half practical" without saying nothing.
        A wash rather than ink, so the day's number and its dots stay legible.
      */
      const kind = onThisDay.find((entry) => entry.classTypeId)
      if (kind?.classTypeId) {
        document
          .rect(x + 0.5, cellTop - 1, MINI_CELL - 1, MINI_ROW)
          .fillColor(calendarColor(kind.classTypeId, kind.classTypeColor).background)
          .fill()
      }

      document
        .fontSize(5)
        .fillColor(INK)
        .text(String(Number(date.slice(8, 10))), x, cellTop, {
          width: MINI_CELL,
          align: 'center',
          lineBreak: false,
        })

      const subjects = new Map<string, ProgrammeEntry>()
      for (const entry of onThisDay) {
        if (!subjects.has(entry.subjectId)) subjects.set(entry.subjectId, entry)
      }
      if (subjects.size === 0) return

      const dots = [...subjects.values()].slice(0, 3)
      const radius = 1.1
      const spacing = radius * 2 + 0.6
      let dotX = x + MINI_CELL / 2 - ((dots.length - 1) * spacing) / 2

      for (const entry of dots) {
        document
          .circle(dotX, cellTop + 8, radius)
          .fillColor(calendarColor(entry.subjectId, entry.subjectColor).accent)
          .fill()
        dotX += spacing
      }
    })
  })

  return gridTop - options.y + weeks.length * MINI_ROW
}

/** Monday first, everywhere in this product (CLAUDE.md §5). */
function weekdayInitials(locale: AppLocale): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' })
  // 2026-01-05 was a Monday.
  return [0, 1, 2, 3, 4, 5, 6].map((offset) =>
    formatter.format(new Date(Date.UTC(2026, 0, 5 + offset))),
  )
}

/**
 * The colours and what each of them is.
 *
 * A page of coloured dots and tinted rows is only readable to somebody who
 * already knows the timetable, so every printed view carries its key.
 */
function drawLegend(
  document: PDFKit.PDFDocument,
  entries: readonly ProgrammeEntry[],
  top: number,
): number {
  const subjects = new Map<string, ProgrammeEntry>()
  const kinds = new Map<string, ProgrammeEntry>()
  for (const entry of entries) {
    if (!subjects.has(entry.subjectId)) subjects.set(entry.subjectId, entry)
    if (entry.classTypeId && !kinds.has(entry.classTypeId)) kinds.set(entry.classTypeId, entry)
  }
  if (subjects.size === 0) return top

  // The subjects are what the dots mean, so their swatch is a dot.
  let y = drawKeys(
    document,
    [...subjects.values()].map((entry) => ({
      label: `${entry.subjectCode} ${entry.subjectName}`,
      colour: calendarColor(entry.subjectId, entry.subjectColor).accent,
      shape: 'dot' as const,
    })),
    top,
  )

  // The kinds of class are what the days are washed with, so their swatch is
  // the same wash.
  if (kinds.size > 0) {
    y = drawKeys(
      document,
      [...kinds.values()].map((entry) => ({
        label: entry.classTypeName ?? '',
        colour: calendarColor(entry.classTypeId ?? '', entry.classTypeColor).background,
        shape: 'wash' as const,
      })),
      y,
    )
  }

  return y + 4
}

/** One line of keys, wrapping onto the next when the page runs out. */
function drawKeys(
  document: PDFKit.PDFDocument,
  keys: readonly { label: string; colour: string; shape: 'dot' | 'wash' }[],
  top: number,
): number {
  let x = MARGIN
  let y = top

  for (const key of keys) {
    const width = Math.min(170, 12 + document.fontSize(7).widthOfString(key.label))

    // Wrapping rather than running off the page: a legend cut in half names
    // half the colours.
    if (x + width > PAGE.width - MARGIN) {
      x = MARGIN
      y += 11
    }

    if (key.shape === 'dot') {
      document
        .circle(x + 3.5, y + 3.5, 3)
        .fillColor(key.colour)
        .fill()
    } else {
      document
        .rect(x, y, 7, 7)
        .fillColor(key.colour)
        .strokeColor(RULE)
        .lineWidth(0.3)
        .fillAndStroke()
    }

    document
      .fillColor(MUTED)
      .fontSize(7)
      .text(key.label, x + 10, y, { width: width - 10, lineBreak: false, ellipsis: true })

    x += width + 8
  }

  return y + 11
}

function columnWidths(): number[] {
  const fixed = COLUMNS.reduce((total, column) => total + column.width, 0)
  return COLUMNS.map((column) => (column.width === 0 ? CONTENT - fixed : column.width))
}

function drawColumnHeadings(
  document: PDFKit.PDFDocument,
  t: (key: string) => string,
  top: number,
): number {
  const widths = columnWidths()
  let x = MARGIN

  document.fontSize(7).fillColor(MUTED)
  for (const [index, column] of COLUMNS.entries()) {
    document.text(t(`calendar.programme.columns.${column.key}`), x + 3, top + 3, {
      width: (widths[index] ?? 0) - 6,
      lineBreak: false,
      ellipsis: true,
    })
    x += widths[index] ?? 0
  }

  const y = top + ROW_HEIGHT - 3
  document
    .moveTo(MARGIN, y)
    .lineTo(PAGE.width - MARGIN, y)
    .lineWidth(0.5)
    .strokeColor(RULE)
    .stroke()

  return y + 3
}

/** One class: its row tinted with the subject's colour, its text still read. */
function drawRow(
  document: PDFKit.PDFDocument,
  entry: ProgrammeEntry,
  locale: AppLocale,
  top: number,
): number {
  const colour = calendarColor(entry.subjectId, entry.subjectColor)
  const widths = columnWidths()

  document.rect(MARGIN, top, CONTENT, ROW_HEIGHT).fillColor(colour.background).fill()

  const date = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${entry.date}T00:00:00Z`))

  const cells = [
    date,
    `${entry.startTime}–${entry.endTime}`,
    // What the class is: the topic where somebody wrote one, the subject and
    // group where they did not — never an empty line.
    entry.topic ?? `${entry.subjectCode} ${entry.groupCode}`,
    entry.teacherName ?? '',
    entry.spaceName ?? '',
  ]

  let x = MARGIN
  document.fontSize(7.5).fillColor(colour.text)
  for (const [index, cell] of cells.entries()) {
    document.text(cell, x + 3, top + 4, {
      width: (widths[index] ?? 0) - 6,
      lineBreak: false,
      ellipsis: true,
    })
    x += widths[index] ?? 0
  }

  return top + ROW_HEIGHT
}
