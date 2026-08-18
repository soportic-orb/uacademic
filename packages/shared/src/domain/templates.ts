/**
 * The tiny template language the calendar titles use.
 *
 * R9 says formats are configurable, and a center that wants
 * `{{subjectCode}} · {{groupCode}} ({{spaceName}})` in the title of every
 * calendar event should not need a release. Substitution only — no logic, no
 * expressions, nothing that could ever be worth injecting.
 */
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

export type TemplateValues = Record<string, string | number | null | undefined>

/**
 * Replaces `{{key}}` with its value. An unknown or empty key collapses to
 * nothing, and the leftover separators around it are cleaned up so a class
 * without a room does not render as "MAT1 A · ".
 */
export function renderTemplate(template: string, values: TemplateValues): string {
  const filled = template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = values[key]
    return value === null || value === undefined ? '' : String(value)
  })

  return filled
    .replace(/\(\s*\)/g, '')
    .replace(/\s*[·|–-]\s*(?=[·|–-])/g, '')
    .replace(/^[\s·|–-]+|[\s·|–-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** The placeholders a template uses, in order and without duplicates. */
export function templateKeys(template: string): string[] {
  const keys = [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string)
  return [...new Set(keys)]
}

/** Placeholders a calendar template may use; anything else is a typo. */
export const CALENDAR_TEMPLATE_KEYS: readonly string[] = [
  'subjectCode',
  'subjectName',
  'groupCode',
  'groupType',
  'spaceName',
  'building',
  'teacherName',
  'centerName',
]

export function unknownTemplateKeys(
  template: string,
  allowed: readonly string[] = CALENDAR_TEMPLATE_KEYS,
): string[] {
  return templateKeys(template).filter((key) => !allowed.includes(key))
}
