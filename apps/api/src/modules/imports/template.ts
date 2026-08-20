/**
 * The sample workbook an administrator downloads before an import.
 *
 * Built from the same field specifications the importer validates against
 * (`@uacademic/shared`), so the columns cannot drift from what is expected: a
 * template with yesterday's columns is worse than no template, because it
 * looks authoritative.
 */
import { type ImportKind, fieldsFor, translate } from '@uacademic/shared'
import type { AppLocale } from '@uacademic/shared'
import ExcelJS from 'exceljs'

export const SPREADSHEET_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function importTemplateWorkbook(kind: ImportKind, locale: AppLocale): Promise<Buffer> {
  const t = (key: string) => translate(locale, key)
  const fields = fieldsFor(kind)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'UAcademic'

  const sheet = workbook.addWorksheet(
    t(kind === 'teachers' ? 'imports.kindTeachers' : 'imports.kindSubjects'),
  )
  sheet.columns = fields.map((field) => ({
    key: field.key,
    header: t(field.labelKey),
    width: Math.max(16, t(field.labelKey).length + 4),
  }))
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  // One filled row. Emptying it is one keystroke; working out what belongs in
  // "Dedicació" from a blank column is not.
  sheet.addRow(Object.fromEntries(fields.map((field) => [field.key, field.example])))

  /*
    A second sheet rather than a comment on each cell: it survives being opened
    in Numbers, in LibreOffice and in whatever the faculty has, and it is where
    the difference between a required column and an optional one can actually
    be read.
  */
  const guide = workbook.addWorksheet(t('imports.template.guideSheet'))
  guide.columns = [
    { key: 'column', header: t('imports.template.column'), width: 28 },
    { key: 'required', header: t('imports.template.required'), width: 14 },
    { key: 'example', header: t('imports.template.example'), width: 34 },
    { key: 'accepts', header: t('imports.template.accepts'), width: 60 },
  ]
  guide.getRow(1).font = { bold: true }

  for (const field of fields) {
    guide.addRow({
      column: t(field.labelKey),
      required: t(field.required ? 'common.yes' : 'common.no'),
      example: field.example,
      // The header spellings that map by themselves, so somebody with an
      // export from another system can see whether theirs is among them.
      accepts: field.aliases.join(', '),
    })
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
