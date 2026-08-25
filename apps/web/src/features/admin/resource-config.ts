import type { Role } from '@uacademic/shared'

/**
 * The admin screens are configuration, not ten hand-written pages: each
 * resource declares its columns and its form, and `resource-page.tsx` renders
 * the table, the filters, the pagination and the dialog. Adding an entity is
 * an entry here, which is also why they all behave identically.
 */
export interface ColumnConfig {
  key: string
  labelKey: string
  sortable?: boolean
  align?: 'left' | 'right'
  /** `enum` looks the value up in the catalog under `enumPrefix`. */
  render?:
    'text' | 'enum' | 'date' | 'number' | 'boolean' | 'entraConsent' | 'nameWithCode' | 'lookup'
  /** `nameWithCode` only: the column holding the short code, shown in brackets. */
  codeKey?: string
  enumPrefix?: string
  /**
   * `lookup` only: where the labels come from.
   *
   * For a column whose values are not a fixed catalog — a kind of calendar day,
   * which a center may add to — so the table names what the form offered
   * rather than showing the raw key.
   */
  optionsFrom?: { path: string; labelField: string }
}

export interface FieldOption {
  value: string
  labelKey: string
}

export interface FieldConfig {
  name: string
  labelKey: string
  type:
    | 'text'
    | 'number'
    | 'select'
    | 'multiSelect'
    | 'date'
    | 'checkbox'
    | 'url'
    | 'image'
    | 'dateRange'
  /**
   * `dateRange` only: the field holding the end of the range.
   *
   * Rendered as one control with a "single day" tick, because most of what
   * goes in an academic calendar is one day and asking for the same date twice
   * is asking somebody to do the computer's work.
   */
  rangeEnd?: string
  required?: boolean
  /**
   * `image` only: the sub-path the picture is posted to and deleted from,
   * `/api/v1/<resource>/<id>/<upload>`. The column then holds whatever URL the
   * server answers with, which is why the field is never sent in the body.
   */
  upload?: string
  options?: FieldOption[]
  /** Options loaded from another resource (degrees, academic years…). */
  optionsFrom?: { path: string; labelField: string }
  /**
   * Lets the person add an option without leaving the form.
   *
   * For lists that belong to the center rather than to the platform: the
   * dropdown carries a "create a new one" entry, and what they type becomes an
   * option they can then choose. `path` is posted to, and answers with the new
   * option.
   */
  creatable?: { path: string; titleKey: string }
  step?: string
  full?: boolean
}

export interface FilterConfig {
  name: string
  labelKey: string
  options?: FieldOption[]
  /** The same live list the form offers, for a filter that is not a catalog. */
  optionsFrom?: { path: string; labelField: string }
}

export interface ResourceConfig {
  key: string
  path: string
  titleKey: string
  roles: Role[]
  columns: ColumnConfig[]
  fields: FieldConfig[]
  filters?: FilterConfig[]
  /** Column used in the delete confirmation. */
  labelField: string
}

/** Built-in kinds of day and the center's own, already named by the server. */
const CALENDAR_TYPES = { path: 'admin/calendar-types', labelField: 'name' }

const enumOptions = (prefix: string, values: readonly string[]): FieldOption[] =>
  values.map((value) => ({ value, labelKey: `${prefix}.${value}` }))

const TRILINGUAL_FIELDS: FieldConfig[] = [
  { name: 'nameCa', labelKey: 'imports.fields.nameCa', type: 'text', required: true, full: true },
  { name: 'nameEs', labelKey: 'imports.fields.nameEs', type: 'text', required: true, full: true },
  { name: 'nameEn', labelKey: 'imports.fields.nameEn', type: 'text', required: true, full: true },
]

const TRILINGUAL_COLUMNS: ColumnConfig[] = [
  { key: 'code', labelKey: 'admin.fields.code', sortable: true },
  { key: 'nameCa', labelKey: 'admin.fields.name', sortable: true },
]

export const ADMIN_RESOURCES: ResourceConfig[] = [
  {
    key: 'universities',
    path: 'admin/universities',
    titleKey: 'admin.universities',
    roles: ['SUPERADMIN'],
    labelField: 'name',
    columns: [{ key: 'name', labelKey: 'admin.fields.name', sortable: true }],
    fields: [
      { name: 'name', labelKey: 'admin.fields.name', type: 'text', required: true, full: true },
      { name: 'logoUrl', labelKey: 'images.logo', type: 'image', upload: 'logo', full: true },
    ],
  },
  {
    key: 'entra-tenants',
    path: 'admin/entra-tenants',
    titleKey: 'admin.tenants',
    roles: ['SUPERADMIN'],
    labelField: 'displayName',
    columns: [
      { key: 'displayName', labelKey: 'admin.fields.name', sortable: true },
      { key: 'tenantId', labelKey: 'admin.fields.tenantId' },
      { key: 'status', labelKey: 'admin.fields.status', render: 'enum', enumPrefix: 'userStatus' },
      { key: 'consent', labelKey: 'admin.fields.consent', render: 'entraConsent' },
    ],
    fields: [
      {
        name: 'tenantId',
        labelKey: 'admin.fields.tenantId',
        type: 'text',
        required: true,
        full: true,
      },
      {
        name: 'displayName',
        labelKey: 'admin.fields.name',
        type: 'text',
        required: true,
        full: true,
      },
      { name: 'issuer', labelKey: 'admin.fields.issuer', type: 'url', full: true },
      {
        name: 'status',
        labelKey: 'admin.fields.status',
        type: 'select',
        options: [
          { value: 'active', labelKey: 'userStatus.active' },
          { value: 'suspended', labelKey: 'userStatus.suspended' },
        ],
      },
    ],
  },
  {
    key: 'centers',
    path: 'admin/centers',
    titleKey: 'admin.centers',
    roles: ['SUPERADMIN'],
    labelField: 'name',
    columns: [
      { key: 'name', labelKey: 'admin.fields.name', sortable: true },
      { key: 'code', labelKey: 'admin.fields.code', sortable: true },
      { key: 'universityName', labelKey: 'admin.fields.university' },
      { key: 'entraTenantId', labelKey: 'admin.fields.entraTenant' },
    ],
    fields: [
      {
        name: 'universityId',
        labelKey: 'admin.fields.university',
        type: 'select',
        required: true,
        optionsFrom: { path: 'admin/universities', labelField: 'name' },
        full: true,
      },
      { name: 'name', labelKey: 'admin.fields.name', type: 'text', required: true, full: true },
      { name: 'code', labelKey: 'admin.fields.code', type: 'text', required: true },
      { name: 'entraTenantId', labelKey: 'admin.fields.entraTenant', type: 'text' },
      { name: 'timezone', labelKey: 'admin.fields.timezone', type: 'text' },
      {
        name: 'localeDefault',
        labelKey: 'admin.fields.locale',
        type: 'select',
        options: [
          { value: 'ca', labelKey: 'language.ca' },
          { value: 'es', labelKey: 'language.es' },
          { value: 'en', labelKey: 'language.en' },
        ],
      },
    ],
  },
  {
    key: 'academic-years',
    path: 'admin/academic-years',
    titleKey: 'admin.academicYears',
    roles: ['CENTER_ADMIN'],
    labelField: 'name',
    columns: [
      { key: 'name', labelKey: 'admin.fields.name', sortable: true },
      { key: 'startDate', labelKey: 'admin.fields.startDate', render: 'date', sortable: true },
      { key: 'endDate', labelKey: 'admin.fields.endDate', render: 'date' },
      {
        key: 'status',
        labelKey: 'admin.fields.status',
        render: 'enum',
        enumPrefix: 'academicYearStatus',
        sortable: true,
      },
    ],
    filters: [
      {
        name: 'status',
        labelKey: 'admin.fields.status',
        options: enumOptions('academicYearStatus', ['draft', 'active', 'closed']),
      },
    ],
    fields: [
      { name: 'name', labelKey: 'admin.fields.name', type: 'text', required: true },
      {
        name: 'status',
        labelKey: 'admin.fields.status',
        type: 'select',
        options: enumOptions('academicYearStatus', ['draft', 'active', 'closed']),
      },
      { name: 'startDate', labelKey: 'admin.fields.startDate', type: 'date', required: true },
      { name: 'endDate', labelKey: 'admin.fields.endDate', type: 'date', required: true },
    ],
  },
  {
    key: 'degrees',
    path: 'admin/degrees',
    titleKey: 'admin.degrees',
    roles: ['CENTER_ADMIN'],
    labelField: 'nameCa',
    columns: [
      ...TRILINGUAL_COLUMNS,
      { key: 'level', labelKey: 'admin.fields.level', render: 'enum', enumPrefix: 'degreeLevel' },
    ],
    filters: [
      {
        name: 'level',
        labelKey: 'admin.fields.level',
        options: enumOptions('degreeLevel', ['bachelor', 'master', 'doctorate', 'own_degree']),
      },
    ],
    fields: [
      { name: 'code', labelKey: 'admin.fields.code', type: 'text', required: true },
      {
        name: 'level',
        labelKey: 'admin.fields.level',
        type: 'select',
        required: true,
        options: enumOptions('degreeLevel', ['bachelor', 'master', 'doctorate', 'own_degree']),
      },
      ...TRILINGUAL_FIELDS,
    ],
  },
  {
    key: 'subjects',
    path: 'admin/subjects',
    titleKey: 'subjects.title',
    roles: ['CENTER_ADMIN'],
    labelField: 'nameCa',
    columns: [
      ...TRILINGUAL_COLUMNS,
      {
        key: 'degreeName',
        labelKey: 'admin.fields.degree',
        render: 'nameWithCode',
        codeKey: 'degreeCode',
      },
      { key: 'ects', labelKey: 'admin.fields.ects', render: 'number', align: 'right' },
      {
        key: 'year',
        labelKey: 'admin.fields.year',
        render: 'number',
        align: 'right',
        sortable: true,
      },
      {
        key: 'term',
        labelKey: 'admin.fields.term',
        render: 'enum',
        enumPrefix: 'term',
        sortable: true,
      },
      { key: 'coordinatorNames', labelKey: 'admin.fields.coordinators' },
    ],
    filters: [
      {
        name: 'term',
        labelKey: 'subjects.term',
        options: enumOptions('term', ['t1', 't2', 't3', 'annual']),
      },
      {
        name: 'type',
        labelKey: 'admin.fields.type',
        options: enumOptions('subjectType', [
          'basic',
          'compulsory',
          'elective',
          'practicum',
          'final_project',
        ]),
      },
    ],
    fields: [
      {
        name: 'academicYearId',
        labelKey: 'admin.fields.academicYear',
        type: 'select',
        required: true,
        optionsFrom: { path: 'admin/academic-years', labelField: 'name' },
      },
      {
        name: 'degreeId',
        labelKey: 'admin.fields.degree',
        type: 'select',
        required: true,
        optionsFrom: { path: 'admin/degrees', labelField: 'nameCa' },
      },
      { name: 'code', labelKey: 'admin.fields.code', type: 'text', required: true },
      { name: 'ects', labelKey: 'admin.fields.ects', type: 'number', required: true, step: '0.5' },
      { name: 'year', labelKey: 'admin.fields.year', type: 'number', required: true },
      {
        name: 'term',
        labelKey: 'admin.fields.term',
        type: 'select',
        required: true,
        options: enumOptions('term', ['t1', 't2', 't3', 'annual']),
      },
      {
        name: 'type',
        labelKey: 'admin.fields.type',
        type: 'select',
        required: true,
        options: enumOptions('subjectType', [
          'basic',
          'compulsory',
          'elective',
          'practicum',
          'final_project',
        ]),
      },
      {
        name: 'teachingLanguage',
        labelKey: 'admin.fields.teachingLanguage',
        type: 'select',
        options: [
          { value: 'ca', labelKey: 'language.ca' },
          { value: 'es', labelKey: 'language.es' },
          { value: 'en', labelKey: 'language.en' },
          { value: 'other', labelKey: 'spaceType.other' },
        ],
      },
      {
        // Coordination is per subject: being on this list is what makes
        // somebody the coordinator of this one.
        name: 'coordinatorIds',
        labelKey: 'admin.fields.coordinators',
        type: 'multiSelect',
        optionsFrom: { path: 'users', labelField: 'name' },
        full: true,
      },
      ...TRILINGUAL_FIELDS,
    ],
  },
  {
    key: 'groups',
    path: 'admin/groups',
    titleKey: 'admin.groups',
    roles: ['CENTER_ADMIN', 'COORDINATOR'],
    labelField: 'code',
    columns: [
      { key: 'code', labelKey: 'admin.fields.code', sortable: true },
      {
        key: 'subjectName',
        labelKey: 'subjects.title',
        render: 'nameWithCode',
        codeKey: 'subjectCode',
      },
      { key: 'type', labelKey: 'admin.fields.type', render: 'enum', enumPrefix: 'groupType' },
      { key: 'spaceName', labelKey: 'admin.fields.space' },
      {
        key: 'plannedHours',
        labelKey: 'admin.fields.plannedHours',
        render: 'number',
        align: 'right',
        sortable: true,
      },
    ],
    filters: [
      {
        name: 'type',
        labelKey: 'admin.fields.type',
        options: enumOptions('groupType', ['theory', 'seminar', 'lab', 'practicum', 'tutoring']),
      },
    ],
    fields: [
      {
        name: 'subjectId',
        labelKey: 'admin.fields.subject',
        type: 'select',
        required: true,
        optionsFrom: { path: 'admin/subjects', labelField: 'nameCa' },
        full: true,
      },
      { name: 'code', labelKey: 'admin.fields.code', type: 'text', required: true },
      {
        name: 'type',
        labelKey: 'admin.fields.type',
        type: 'select',
        required: true,
        options: enumOptions('groupType', ['theory', 'seminar', 'lab', 'practicum', 'tutoring']),
      },
      {
        name: 'plannedHours',
        labelKey: 'admin.fields.plannedHours',
        type: 'number',
        required: true,
        step: '0.5',
      },
      { name: 'capacity', labelKey: 'admin.fields.capacity', type: 'number' },
      {
        // How long one of its classes lasts. Blank keeps the center's own
        // default, which is what most groups want.
        name: 'sessionMinutes',
        labelKey: 'admin.fields.sessionMinutes',
        type: 'number',
        step: '5',
      },
      {
        // The room this group normally meets in: a session placed for it
        // starts there instead of being typed in again every time.
        name: 'spaceId',
        labelKey: 'admin.fields.space',
        type: 'select',
        optionsFrom: { path: 'admin/spaces', labelField: 'name' },
      },
      {
        name: 'requiredSpaceType',
        labelKey: 'admin.fields.requiredSpaceType',
        type: 'select',
        options: enumOptions('spaceType', [
          'classroom',
          'seminar_room',
          'computer_lab',
          'lab',
          'auditorium',
          'other',
        ]),
      },
    ],
  },
  {
    key: 'spaces',
    path: 'admin/spaces',
    titleKey: 'admin.spaces',
    roles: ['CENTER_ADMIN'],
    labelField: 'name',
    columns: [
      { key: 'name', labelKey: 'admin.fields.name', sortable: true },
      { key: 'building', labelKey: 'admin.fields.building', sortable: true },
      {
        key: 'capacity',
        labelKey: 'admin.fields.capacity',
        render: 'number',
        align: 'right',
        sortable: true,
      },
      { key: 'type', labelKey: 'admin.fields.type', render: 'enum', enumPrefix: 'spaceType' },
    ],
    filters: [
      {
        name: 'type',
        labelKey: 'admin.fields.type',
        options: enumOptions('spaceType', [
          'classroom',
          'seminar_room',
          'computer_lab',
          'lab',
          'auditorium',
          'other',
        ]),
      },
    ],
    fields: [
      { name: 'name', labelKey: 'admin.fields.name', type: 'text', required: true },
      { name: 'building', labelKey: 'admin.fields.building', type: 'text' },
      { name: 'capacity', labelKey: 'admin.fields.capacity', type: 'number', required: true },
      {
        name: 'type',
        labelKey: 'admin.fields.type',
        type: 'select',
        required: true,
        options: enumOptions('spaceType', [
          'classroom',
          'seminar_room',
          'computer_lab',
          'lab',
          'auditorium',
          'other',
        ]),
      },
    ],
  },
  {
    key: 'calendar-entries',
    path: 'admin/calendar-entries',
    titleKey: 'admin.calendar',
    roles: ['CENTER_ADMIN'],
    labelField: 'nameCa',
    columns: [
      { key: 'dateFrom', labelKey: 'admin.fields.dateFrom', render: 'date', sortable: true },
      { key: 'dateTo', labelKey: 'admin.fields.dateTo', render: 'date' },
      { key: 'nameCa', labelKey: 'admin.fields.name', sortable: true },
      {
        key: 'type',
        labelKey: 'admin.fields.type',
        render: 'lookup',
        optionsFrom: CALENDAR_TYPES,
        sortable: true,
      },
      { key: 'isTeachingDay', labelKey: 'admin.fields.isTeachingDay', render: 'boolean' },
      { key: 'repeatsYearly', labelKey: 'admin.fields.repeatsYearly', render: 'boolean' },
    ],
    filters: [{ name: 'type', labelKey: 'admin.fields.type', optionsFrom: CALENDAR_TYPES }],
    fields: [
      {
        name: 'academicYearId',
        labelKey: 'admin.fields.academicYear',
        type: 'select',
        required: true,
        optionsFrom: { path: 'admin/academic-years', labelField: 'name' },
        full: true,
      },
      {
        name: 'type',
        labelKey: 'admin.fields.type',
        type: 'select',
        required: true,
        optionsFrom: CALENDAR_TYPES,
        // What counts as a kind of day differs between centers, so the list is
        // the center's own and can be added to from here.
        creatable: { path: 'admin/calendar-types', titleKey: 'admin.calendarTypes.title' },
      },
      { name: 'isTeachingDay', labelKey: 'admin.fields.isTeachingDay', type: 'checkbox' },
      {
        // A note for the next calendar rather than for this one: everything
        // ticked here is copied when a new academic year is opened.
        name: 'repeatsYearly',
        labelKey: 'admin.fields.repeatsYearly',
        type: 'checkbox',
      },
      {
        name: 'dateFrom',
        labelKey: 'admin.fields.dates',
        type: 'dateRange',
        rangeEnd: 'dateTo',
        required: true,
        full: true,
      },
      ...TRILINGUAL_FIELDS,
    ],
  },
]

export function resourceByKey(key: string | undefined): ResourceConfig | undefined {
  return ADMIN_RESOURCES.find((resource) => resource.key === key)
}

export function resourcesForRoles(roles: readonly Role[]): ResourceConfig[] {
  return ADMIN_RESOURCES.filter((resource) => resource.roles.some((role) => roles.includes(role)))
}
