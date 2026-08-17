/**
 * The center load panel as a spreadsheet.
 *
 * It is written from the rows the panel already filtered and sorted, so the
 * download always matches the screen. Headers and the traffic light are
 * translated into the caller's locale (R1), and hour figures stay numeric so
 * the file can be pivoted rather than only read.
 */
import type { AppLocale, CenterLoadRow, LoadThresholds } from '@uacademic/shared'
import { summarizeLoads, translate } from '@uacademic/shared'
import ExcelJS from 'exceljs'

export interface LoadWorkbookOptions {
  locale: AppLocale
  thresholds: LoadThresholds
}

const COLUMNS = [
  { key: 'lastName', header: 'teachers.lastName', width: 26 },
  { key: 'firstName', header: 'teachers.firstName', width: 20 },
  { key: 'category', header: 'teachers.category', width: 22 },
  { key: 'dedication', header: 'teachers.dedication', width: 16 },
  { key: 'contractedHours', header: 'load.contracted', width: 14 },
  { key: 'reductionHours', header: 'load.reductions', width: 14 },
  { key: 'capacityHours', header: 'load.capacity', width: 14 },
  { key: 'assignedHours', header: 'load.assigned', width: 14 },
  { key: 'remainingHours', header: 'load.remaining', width: 14 },
  { key: 'ratioPercent', header: 'load.ratio', width: 12 },
  { key: 'status', header: 'teachers.status', width: 16 },
] as const

export async function loadWorkbook(
  rows: readonly CenterLoadRow[],
  options: LoadWorkbookOptions,
): Promise<Buffer> {
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(options.locale, key, params)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'UAcademic'
  const sheet = workbook.addWorksheet(t('load.title'))

  sheet.columns = COLUMNS.map((column) => ({
    key: column.key,
    header: t(column.header),
    width: column.width,
  }))
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of rows) {
    sheet.addRow({
      lastName: row.lastName,
      firstName: row.firstName,
      category: t(`teacherCategory.${row.category}`),
      dedication: t(`dedication.${row.dedication}`),
      contractedHours: row.contractedHours,
      reductionHours: row.reductionHours,
      capacityHours: row.capacityHours,
      assignedHours: row.assignedHours,
      remainingHours: row.remainingHours,
      // A teacher with no capacity has no ratio; an empty cell says that
      // better than a zero would.
      ratioPercent: row.ratioPercent ?? null,
      status: t(`load.status.${row.status}`),
    })
  }

  const summary = summarizeLoads(
    rows.map((row) => ({
      ...row,
      byConcept: { lecture: 0, tutoring: 0, coordination: 0, tfg: 0, other: 0 },
    })),
  )

  const total = sheet.addRow({
    lastName: t('load.summary'),
    capacityHours: summary.totalCapacityHours,
    assignedHours: summary.totalAssignedHours,
    ratioPercent: summary.ratioPercent ?? null,
  })
  total.font = { bold: true }

  for (const key of [
    'contractedHours',
    'reductionHours',
    'capacityHours',
    'assignedHours',
    'remainingHours',
  ]) {
    sheet.getColumn(key).numFmt = '0.00'
  }
  sheet.getColumn('ratioPercent').numFmt = '0.00'

  // The thresholds that produced the traffic light, so the file explains itself
  // away from the app.
  const legend = workbook.addWorksheet(t('load.thresholds'))
  legend.columns = [
    { header: t('teachers.status'), width: 20 },
    { header: t('load.ratio'), width: 20 },
  ]
  legend.getRow(1).font = { bold: true }
  legend.addRows([
    [t('load.status.under'), `< ${options.thresholds.underBelow} %`],
    [
      t('load.status.optimal'),
      `${options.thresholds.underBelow}–${options.thresholds.optimalUpTo} %`,
    ],
    [t('load.status.limit'), `${options.thresholds.optimalUpTo}–${options.thresholds.limitUpTo} %`],
    [t('load.status.over'), `> ${options.thresholds.limitUpTo} %`],
  ])

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
