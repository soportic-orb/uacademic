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
import { calendarColor, monthsBetween, translate } from '@uacademic/shared'
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
const MONTH_ROW = 15
const DAY_CELL = (CONTENT - 52) / 31

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
 * The year across the top: a row per teaching month, a dot on every day that
 * has a class, in the colour of the subject it belongs to.
 *
 * Several subjects on one day means several dots side by side in the same
 * cell, up to what fits: the point is "this day is busy, and with what", not
 * an exact count.
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

  let y = top

  // The day numbers, once, above the months they label.
  document.fontSize(5).fillColor(MUTED)
  for (let day = 1; day <= 31; day += 1) {
    document.text(String(day), MARGIN + 52 + (day - 1) * DAY_CELL, y, {
      width: DAY_CELL,
      align: 'center',
      lineBreak: false,
    })
  }
  y += 8

  for (const { year, month } of months) {
    const label = new Intl.DateTimeFormat(input.locale, {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, 1)))

    document
      .fontSize(7)
      .fillColor(INK)
      .text(label, MARGIN, y + 4, { width: 48, lineBreak: false, ellipsis: true })

    const days = new Date(Date.UTC(year, month, 0)).getUTCDate()

    for (let day = 1; day <= 31; day += 1) {
      const x = MARGIN + 52 + (day - 1) * DAY_CELL
      document
        .rect(x, y, DAY_CELL, MONTH_ROW)
        .lineWidth(0.3)
        .strokeColor(RULE)
        .fillColor(day <= days ? '#FFFFFF' : '#F1F5F9')
        .fillAndStroke()

      if (day > days) continue

      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const subjects = new Map<string, ProgrammeEntry>()
      for (const entry of byDate.get(iso) ?? []) {
        if (!subjects.has(entry.subjectId)) subjects.set(entry.subjectId, entry)
      }
      if (subjects.size === 0) continue

      const dots = [...subjects.values()].slice(0, 3)
      const radius = 1.6
      const spacing = radius * 2 + 0.8
      let dotX = x + DAY_CELL / 2 - ((dots.length - 1) * spacing) / 2

      for (const entry of dots) {
        document
          .circle(dotX, y + MONTH_ROW / 2, radius)
          .fillColor(calendarColor(entry.subjectId, entry.subjectColor).accent)
          .fill()
        dotX += spacing
      }
    }

    y += MONTH_ROW
  }

  return y + 10
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
  for (const entry of entries) {
    if (!subjects.has(entry.subjectId)) subjects.set(entry.subjectId, entry)
  }
  if (subjects.size === 0) return top

  let x = MARGIN
  let y = top

  for (const entry of subjects.values()) {
    const colour = calendarColor(entry.subjectId, entry.subjectColor)
    const label = `${entry.subjectCode} ${entry.subjectName}`
    const width = Math.min(170, 12 + document.fontSize(7).widthOfString(label))

    // Wrapping onto a second line rather than running off the page: a legend
    // cut in half names half the colours.
    if (x + width > PAGE.width - MARGIN) {
      x = MARGIN
      y += 11
    }

    document.rect(x, y, 7, 7).fill(colour.accent)
    document
      .fillColor(MUTED)
      .fontSize(7)
      .text(label, x + 10, y, { width: width - 10, lineBreak: false, ellipsis: true })

    x += width + 8
  }

  return y + 14
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
