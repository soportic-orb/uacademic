/**
 * A calendar as paper, in whichever shape was asked for.
 *
 * The coordinator's programme, a teacher's own calendar and the planner all
 * print the same classes; what differs is the period, whose classes they are
 * and the shape of the page. So the shapes live here, once: a month or a week
 * as a calendar page, the year as a programme, a day or the whole range as a
 * list. A screen that prints something the others cannot is a screen whose
 * output nobody recognises.
 *
 * The stamp is the other reason this is one place. A timetable that has not
 * been published yet may still be worth printing — a draft handed round a
 * department meeting is exactly how a timetable gets agreed — but it must
 * never be mistaken for the real one, so every page of it says so.
 */
import type { AppLocale } from '@uacademic/shared'
import { calendarColor } from '@uacademic/shared'
import PDFDocument from 'pdfkit'

import { type ProgrammeEntry, programmePdf } from './programme-pdf.js'
import { scheduleMonthlyPdf } from './schedule-pdf.js'

/** The shapes a printed calendar comes in. */
export type CalendarPrintView = 'day' | 'week' | 'month' | 'agenda' | 'programme'

export interface CalendarPrintEntry extends ProgrammeEntry {
  /** Everyone giving the class, for the list that has room for all of them. */
  teachers?: readonly { name: string }[]
}

export interface CalendarPrintInput {
  view: CalendarPrintView
  /** The heading, already in the reader's language. */
  title: string
  centerName: string
  /** Whose classes these are, or which filters produced them. */
  note?: string
  /**
   * Words stamped on the top right of every page — "provisional timetable".
   * Absent for a published one, which needs no warning.
   */
  stamp?: string
  /**
   * The institution's logo, as PNG or JPEG bytes: a document that leaves the
   * building carries the mark of who issued it.
   */
  logo?: Buffer
  from: string
  to: string
  locale: AppLocale
  entries: readonly CalendarPrintEntry[]
  /** What to say when the period holds no classes at all. */
  emptyLabel: string
}

const INK = '#0F172A'
const MUTED = '#475569'
const STAMP = '#B45309'

export async function calendarPdf(input: CalendarPrintInput): Promise<Buffer> {
  if (input.view === 'programme') {
    return programmePdf({
      title: input.title,
      centerName: input.centerName,
      ...(input.note ? { note: input.note } : {}),
      ...(input.stamp ? { stamp: input.stamp } : {}),
      ...(input.logo ? { logo: input.logo } : {}),
      from: input.from,
      to: input.to,
      locale: input.locale,
      entries: input.entries,
    })
  }

  if (input.view === 'month' || input.view === 'week') {
    return scheduleMonthlyPdf({
      teacherName: input.note ?? '',
      centerName: input.centerName,
      ...(input.stamp ? { stamp: input.stamp } : {}),
      from: input.from,
      to: input.to,
      locale: input.locale,
      layout: input.view === 'week' ? 'weeks' : 'month',
      entries: input.entries.map((entry) => ({
        date: entry.date,
        startTime: entry.startTime,
        endTime: entry.endTime,
        subjectId: entry.subjectId,
        subjectCode: entry.subjectCode,
        subjectName: entry.subjectName,
        subjectColor: entry.subjectColor ?? null,
        groupCode: entry.groupCode,
        spaceName: entry.spaceName,
        topic: entry.topic,
      })),
    })
  }

  return listPdf(input)
}

/** A day and the whole range are lists, and a list reads down a page. */
function listPdf(input: CalendarPrintInput): Promise<Buffer> {
  const document = new PDFDocument({ size: 'A4', margin: 36 })
  const chunks: Buffer[] = []
  document.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<Buffer>((resolve) =>
    document.on('end', () => resolve(Buffer.concat(chunks))),
  )

  if (input.stamp) stampPages(document, input.stamp)

  document.fontSize(18).fillColor(INK).text(input.title)
  document
    .fontSize(10)
    .fillColor(MUTED)
    .text([input.note, `${input.from} – ${input.to}`].filter(Boolean).join(' · '))
  document.moveDown()

  if (input.entries.length === 0) {
    document.fontSize(11).fillColor(INK).text(input.emptyLabel)
  } else {
    writeLegend(document, input.entries)
    writeDays(document, input.entries)
  }

  document.end()
  return finished
}

/**
 * The words a page of an unpublished timetable carries.
 *
 * Drawn on every page as it is added, including the first, and without moving
 * the cursor the caller is writing from: a stamp that pushed the content down
 * would be a stamp nobody dared add.
 */
export function stampPages(document: PDFKit.PDFDocument, words: string): void {
  const draw = () => {
    const { x, y } = document
    document
      .fontSize(9)
      .fillColor(STAMP)
      .text(words, document.page.margins.left, document.page.margins.top - 18, {
        width: document.page.width - document.page.margins.left - document.page.margins.right,
        align: 'right',
        lineBreak: false,
      })
    document.x = x
    document.y = y
    document.fillColor(INK)
  }

  document.on('pageAdded', draw)
  // A document that already has a page — PDFKit opens one unless told not to —
  // gets its stamp now, because `pageAdded` has already been and gone.
  if (document.page) draw()
}

function writeLegend(document: PDFKit.PDFDocument, entries: readonly CalendarPrintEntry[]): void {
  const subjects = new Map<string, CalendarPrintEntry>()
  for (const entry of entries) {
    if (!subjects.has(entry.subjectId)) subjects.set(entry.subjectId, entry)
  }

  const left = document.page.margins.left
  let x = left
  const top = document.y

  for (const entry of subjects.values()) {
    const label = `${entry.subjectCode} ${entry.subjectName}`
    const width = Math.min(170, 14 + document.fontSize(8).widthOfString(label))
    if (x + width > document.page.width - document.page.margins.right) break

    document.rect(x, top + 2, 7, 7).fill(calendarColor(entry.subjectId, entry.subjectColor).accent)
    document
      .fillColor(MUTED)
      .fontSize(8)
      .text(label, x + 11, top, { width: width - 11, lineBreak: false, ellipsis: true })

    x += width + 8
  }

  document.x = left
  document.y = top + 14
  document.moveDown(0.4)
}

function writeDays(document: PDFKit.PDFDocument, entries: readonly CalendarPrintEntry[]): void {
  let currentDate = ''

  for (const entry of entries) {
    if (document.y > document.page.height - document.page.margins.bottom - 40) {
      document.addPage()
      currentDate = ''
    }

    if (entry.date !== currentDate) {
      currentDate = entry.date
      document.moveDown(0.4).fontSize(12).fillColor(INK).text(entry.date, { underline: true })
      document.moveDown(0.2)
    }

    const top = document.y
    // The colour is a stripe rather than a fill: a page of pale blocks is
    // expensive to print and harder to read than ink on paper. Saturated, so
    // it is a colour rather than a suggestion of one.
    document
      .rect(document.page.margins.left, top + 1, 4, 11)
      .fill(calendarColor(entry.subjectId, entry.subjectColor).accent)

    document
      .fillColor(INK)
      .fontSize(10)
      .text(
        [
          `${entry.startTime}–${entry.endTime}`,
          `${entry.subjectCode} ${entry.groupCode}`,
          // What the class is: its topic where somebody wrote one, and the
          // subject's name where they did not.
          entry.topic ?? entry.subjectName,
          entry.teachers?.map((person) => person.name).join(', ') ?? entry.teacherName ?? '',
          entry.spaceName ?? '',
        ]
          .filter(Boolean)
          .join('   '),
        document.page.margins.left + 10,
        top,
      )
  }
}
