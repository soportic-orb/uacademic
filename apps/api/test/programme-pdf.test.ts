/**
 * How tall a row of the printed programme has to be.
 *
 * A class given by four people is three lines of names, and a long topic is
 * two lines of topic. They used to be drawn over the rows beneath them, which
 * made a page of them unreadable — so the row is measured and grown instead.
 */
import PDFDocument from 'pdfkit'
import { describe, expect, it } from 'vitest'

import { type ProgrammeEntry, rowHeight } from '../src/services/programme-pdf.js'

const entry = (overrides: Partial<ProgrammeEntry> = {}): ProgrammeEntry => ({
  date: '2027-01-11',
  startTime: '11:00',
  endTime: '15:00',
  subjectId: 's1',
  subjectCode: 'SP',
  subjectName: 'Salut pública',
  subjectColor: null,
  groupCode: 'A1',
  topic: 'Presentació curs',
  teacherName: 'Cristina Casamitjana',
  spaceName: 'Aula 1.1',
  ...overrides,
})

const document = new PDFDocument({ size: [595, 842], margin: 36, autoFirstPage: false })
const height = (overrides: Partial<ProgrammeEntry> = {}) =>
  rowHeight(document, entry(overrides), 'ca')

describe('the height of a row', () => {
  it('is one line for a class that fits on one', () => {
    expect(height()).toBe(15)
  })

  it('grows for the names of everybody giving the class', () => {
    const shared = height({
      teacherName:
        'Cristina Casamitjana, Laura Lorente, Lorena Villa García, Octavi Rodríguez Blanco',
    })

    expect(shared).toBeGreaterThan(height())
    // Three lines of names, not three lines of row for one line of names.
    expect(shared).toBeLessThan(height() * 3)
  })

  it('grows for a topic that does not fit its column', () => {
    expect(
      height({
        topic:
          'M1 Concepte de salut, determinants i desigualtats socials en salut al llarg del curs',
      }),
    ).toBeGreaterThan(height())
  })

  it('does not shrink below one line for a class with nothing written on it', () => {
    expect(height({ topic: null, teacherName: null, spaceName: null })).toBe(15)
  })
})
