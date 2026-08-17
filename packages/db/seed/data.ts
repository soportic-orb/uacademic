/**
 * Demo dataset: one university, one center, one academic year, two degrees,
 * eight subjects, twelve teachers with realistic contracts and availability,
 * and three spaces.
 *
 * The contracted hours and the assignments are chosen so the load traffic
 * light shows all four states — an empty-looking demo hides the bugs that
 * matter in this product.
 */
import type { AvailabilityLevel } from '@uacademic/shared'

export interface TeacherSeed {
  index: number
  firstName: string
  lastName: string
  email: string
  category:
    | 'full_professor'
    | 'associate_professor'
    | 'assistant_professor'
    | 'lecturer'
    | 'adjunct'
    | 'visiting'
    | 'external'
  dedication: 'full_time' | 'part_time' | 'hourly'
  contractedHours: number
  /** Approved reductions (research, management…), in hours. */
  reduction?: { reason: string; hours: number }
  isCoordinator?: boolean
  availability: { weekday: number; startTime: string; endTime: string; level: AvailabilityLevel }[]
  knowledgeAreas: string[]
}

const MORNINGS = (weekdays: number[], level: AvailabilityLevel = 'preferred') =>
  weekdays.map((weekday) => ({ weekday, startTime: '08:00', endTime: '14:00', level }))

const AFTERNOONS = (weekdays: number[], level: AvailabilityLevel = 'available') =>
  weekdays.map((weekday) => ({ weekday, startTime: '15:00', endTime: '20:00', level }))

export const TEACHERS: TeacherSeed[] = [
  {
    index: 1,
    firstName: 'Marta',
    lastName: 'Puig Serra',
    email: 'marta.puig@demo.uacademic.test',
    category: 'associate_professor',
    dedication: 'full_time',
    contractedHours: 120,
    reduction: { reason: 'Coordinació de titulació', hours: 20 },
    isCoordinator: true,
    availability: [...MORNINGS([1, 2, 3, 4, 5]), ...AFTERNOONS([2, 4])],
    knowledgeAreas: ['Física aplicada'],
  },
  {
    index: 2,
    firstName: 'Jordi',
    lastName: 'Roca Vidal',
    email: 'jordi.roca@demo.uacademic.test',
    category: 'full_professor',
    dedication: 'full_time',
    contractedHours: 100,
    reduction: { reason: 'Direcció de departament', hours: 10 },
    isCoordinator: true,
    availability: [...MORNINGS([1, 2, 3, 4]), ...AFTERNOONS([1, 3], 'avoid')],
    knowledgeAreas: ['Llenguatges i sistemes informàtics'],
  },
  {
    index: 3,
    firstName: 'Núria',
    lastName: 'Camps Oliva',
    email: 'nuria.camps@demo.uacademic.test',
    category: 'assistant_professor',
    dedication: 'full_time',
    contractedHours: 100,
    availability: [...MORNINGS([1, 2, 3, 4, 5]), ...AFTERNOONS([1, 2, 3, 4, 5])],
    knowledgeAreas: ['Algorísmica', 'Matemàtica discreta'],
  },
  {
    index: 4,
    firstName: 'Pau',
    lastName: 'Ferrer Mas',
    email: 'pau.ferrer@demo.uacademic.test',
    category: 'lecturer',
    dedication: 'part_time',
    contractedHours: 60,
    availability: [...MORNINGS([2, 4]), ...AFTERNOONS([2, 4])],
    knowledgeAreas: ['Programació'],
  },
  {
    index: 5,
    firstName: 'Laia',
    lastName: 'Soler Bosch',
    email: 'laia.soler@demo.uacademic.test',
    category: 'adjunct',
    dedication: 'hourly',
    contractedHours: 30,
    availability: [...AFTERNOONS([1, 3], 'preferred')],
    knowledgeAreas: ['Física experimental'],
  },
  {
    index: 6,
    firstName: 'Andreu',
    lastName: 'Mestre Pons',
    email: 'andreu.mestre@demo.uacademic.test',
    category: 'associate_professor',
    dedication: 'full_time',
    contractedHours: 90,
    availability: [...MORNINGS([1, 2, 3, 4, 5]), ...AFTERNOONS([3, 5])],
    knowledgeAreas: ['Bases de dades'],
  },
  {
    index: 7,
    firstName: 'Clara',
    lastName: 'Ribas Font',
    email: 'clara.ribas@demo.uacademic.test',
    category: 'assistant_professor',
    dedication: 'part_time',
    contractedHours: 60,
    availability: [...MORNINGS([1, 3, 5]), ...AFTERNOONS([1], 'avoid')],
    knowledgeAreas: ['Xarxes i sistemes distribuïts'],
  },
  {
    index: 8,
    firstName: 'Sergi',
    lastName: 'Vila Rovira',
    email: 'sergi.vila@demo.uacademic.test',
    category: 'adjunct',
    dedication: 'hourly',
    contractedHours: 40,
    availability: [...AFTERNOONS([2, 4], 'preferred')],
    knowledgeAreas: ['Algorísmica'],
  },
  {
    index: 9,
    firstName: 'Anna',
    lastName: 'Torres Gil',
    email: 'anna.torres@demo.uacademic.test',
    category: 'associate_professor',
    dedication: 'full_time',
    contractedHours: 90,
    availability: [...MORNINGS([1, 2, 3, 4, 5]), ...AFTERNOONS([2, 4])],
    knowledgeAreas: ['Estadística'],
  },
  {
    index: 10,
    firstName: 'Marc',
    lastName: 'Serrano Prat',
    email: 'marc.serrano@demo.uacademic.test',
    category: 'lecturer',
    dedication: 'part_time',
    contractedHours: 75,
    availability: [...MORNINGS([2, 3, 4]), ...AFTERNOONS([3])],
    knowledgeAreas: ['Aprenentatge automàtic'],
  },
  {
    index: 11,
    firstName: 'Elena',
    lastName: 'Navarro Ruiz',
    email: 'elena.navarro@demo.uacademic.test',
    category: 'full_professor',
    dedication: 'full_time',
    contractedHours: 80,
    reduction: { reason: 'Projecte de recerca competitiu', hours: 20 },
    availability: [...MORNINGS([1, 2, 4, 5]), ...AFTERNOONS([5], 'avoid')],
    knowledgeAreas: ['Estadística', 'Ciència de dades'],
  },
  {
    index: 12,
    firstName: 'Guillem',
    lastName: 'Riera Costa',
    email: 'guillem.riera@demo.uacademic.test',
    category: 'adjunct',
    dedication: 'hourly',
    contractedHours: 30,
    availability: [...AFTERNOONS([1, 2, 3], 'preferred')],
    knowledgeAreas: ['Programació'],
  },
]

export interface SubjectSeed {
  index: number
  degreeCode: 'GEI' | 'GCD'
  code: string
  nameCa: string
  nameEs: string
  nameEn: string
  ects: number
  year: number
  term: 't1' | 't2' | 't3' | 'annual'
  type: 'basic' | 'compulsory' | 'elective' | 'practicum' | 'final_project'
  teachingLanguage: 'ca' | 'es' | 'en' | 'other'
  coordinatorTeacherIndex: number
  groups: {
    code: string
    type: 'theory' | 'seminar' | 'lab' | 'practicum' | 'tutoring'
    plannedHours: number
    capacity: number
    requiredSpaceType: 'classroom' | 'seminar_room' | 'computer_lab' | 'lab' | 'auditorium'
  }[]
}

const theory = (code: string, capacity = 60) =>
  ({ code, type: 'theory', plannedHours: 45, capacity, requiredSpaceType: 'classroom' }) as const

const lab = (code: string, capacity = 25) =>
  ({ code, type: 'lab', plannedHours: 22.5, capacity, requiredSpaceType: 'computer_lab' }) as const

export const SUBJECTS: SubjectSeed[] = [
  {
    index: 1,
    degreeCode: 'GEI',
    code: 'FIS101',
    nameCa: 'Fonaments de Física',
    nameEs: 'Fundamentos de Física',
    nameEn: 'Physics Foundations',
    ects: 6,
    year: 1,
    term: 't1',
    type: 'basic',
    teachingLanguage: 'ca',
    coordinatorTeacherIndex: 1,
    groups: [theory('T1'), theory('T2'), lab('L1'), lab('L2')],
  },
  {
    index: 2,
    degreeCode: 'GEI',
    code: 'PRO102',
    nameCa: 'Programació I',
    nameEs: 'Programación I',
    nameEn: 'Programming I',
    ects: 6,
    year: 1,
    term: 't1',
    type: 'basic',
    teachingLanguage: 'ca',
    coordinatorTeacherIndex: 2,
    groups: [theory('T1'), theory('T2'), lab('L1'), lab('L2')],
  },
  {
    index: 3,
    degreeCode: 'GEI',
    code: 'ALG201',
    nameCa: 'Algorísmica',
    nameEs: 'Algorítmica',
    nameEn: 'Algorithms',
    ects: 6,
    year: 2,
    term: 't1',
    type: 'compulsory',
    teachingLanguage: 'ca',
    coordinatorTeacherIndex: 2,
    groups: [theory('T1'), theory('T2'), lab('L1')],
  },
  {
    index: 4,
    degreeCode: 'GEI',
    code: 'BDA202',
    nameCa: 'Bases de Dades',
    nameEs: 'Bases de Datos',
    nameEn: 'Databases',
    ects: 6,
    year: 2,
    term: 't2',
    type: 'compulsory',
    teachingLanguage: 'ca',
    coordinatorTeacherIndex: 1,
    groups: [theory('T1'), theory('T2'), lab('L1')],
  },
  {
    index: 5,
    degreeCode: 'GEI',
    code: 'XAR301',
    nameCa: 'Xarxes de Computadors',
    nameEs: 'Redes de Computadores',
    nameEn: 'Computer Networks',
    ects: 6,
    year: 3,
    term: 't1',
    type: 'compulsory',
    teachingLanguage: 'en',
    coordinatorTeacherIndex: 1,
    groups: [theory('T1'), lab('L1')],
  },
  {
    index: 6,
    degreeCode: 'GCD',
    code: 'EST101',
    nameCa: 'Estadística Aplicada',
    nameEs: 'Estadística Aplicada',
    nameEn: 'Applied Statistics',
    ects: 6,
    year: 1,
    term: 't2',
    type: 'basic',
    teachingLanguage: 'es',
    coordinatorTeacherIndex: 2,
    groups: [theory('T1'), theory('T2'), lab('L1')],
  },
  {
    index: 7,
    degreeCode: 'GCD',
    code: 'APR301',
    nameCa: 'Aprenentatge Automàtic',
    nameEs: 'Aprendizaje Automático',
    nameEn: 'Machine Learning',
    ects: 6,
    year: 3,
    term: 't1',
    type: 'compulsory',
    teachingLanguage: 'en',
    coordinatorTeacherIndex: 2,
    groups: [theory('T1'), lab('L1')],
  },
  {
    index: 8,
    degreeCode: 'GCD',
    code: 'TFG401',
    nameCa: 'Treball de Fi de Grau',
    nameEs: 'Trabajo de Fin de Grado',
    nameEn: 'Final Degree Project',
    ects: 12,
    year: 4,
    term: 'annual',
    type: 'final_project',
    teachingLanguage: 'ca',
    coordinatorTeacherIndex: 1,
    groups: [
      {
        code: 'TU1',
        type: 'tutoring',
        plannedHours: 60,
        capacity: 20,
        requiredSpaceType: 'seminar_room',
      },
    ],
  },
]

export interface AssignmentSeed {
  teacherIndex: number
  subjectCode: string
  groupCode: string
  hours: number
  concept: 'lecture' | 'tutoring' | 'coordination' | 'tfg' | 'other'
}

/**
 * Hand-built so the twelve teachers land on every load status:
 * three under-loaded, five optimal, two at the limit and two overloaded.
 */
export const ASSIGNMENTS: AssignmentSeed[] = [
  { teacherIndex: 1, subjectCode: 'FIS101', groupCode: 'T1', hours: 45, concept: 'lecture' },
  { teacherIndex: 1, subjectCode: 'FIS101', groupCode: 'T2', hours: 45, concept: 'lecture' },

  { teacherIndex: 2, subjectCode: 'PRO102', groupCode: 'T1', hours: 45, concept: 'lecture' },
  { teacherIndex: 2, subjectCode: 'PRO102', groupCode: 'L1', hours: 22.5, concept: 'lecture' },
  {
    teacherIndex: 2,
    subjectCode: 'TFG401',
    groupCode: 'TU1',
    hours: 12.5,
    concept: 'coordination',
  },

  { teacherIndex: 3, subjectCode: 'ALG201', groupCode: 'T1', hours: 45, concept: 'lecture' },
  { teacherIndex: 3, subjectCode: 'ALG201', groupCode: 'T2', hours: 45, concept: 'lecture' },
  { teacherIndex: 3, subjectCode: 'TFG401', groupCode: 'TU1', hours: 15, concept: 'tfg' },

  { teacherIndex: 4, subjectCode: 'PRO102', groupCode: 'T2', hours: 45, concept: 'lecture' },
  { teacherIndex: 4, subjectCode: 'PRO102', groupCode: 'L2', hours: 5, concept: 'lecture' },

  { teacherIndex: 5, subjectCode: 'FIS101', groupCode: 'L1', hours: 22.5, concept: 'lecture' },
  { teacherIndex: 5, subjectCode: 'TFG401', groupCode: 'TU1', hours: 7.5, concept: 'tfg' },

  { teacherIndex: 6, subjectCode: 'BDA202', groupCode: 'T1', hours: 45, concept: 'lecture' },
  { teacherIndex: 6, subjectCode: 'BDA202', groupCode: 'T2', hours: 45, concept: 'lecture' },
  { teacherIndex: 6, subjectCode: 'BDA202', groupCode: 'L1', hours: 15, concept: 'lecture' },

  { teacherIndex: 7, subjectCode: 'XAR301', groupCode: 'T1', hours: 45, concept: 'lecture' },
  { teacherIndex: 7, subjectCode: 'XAR301', groupCode: 'L1', hours: 12.5, concept: 'lecture' },

  { teacherIndex: 8, subjectCode: 'ALG201', groupCode: 'L1', hours: 22.5, concept: 'lecture' },

  { teacherIndex: 9, subjectCode: 'EST101', groupCode: 'T1', hours: 45, concept: 'lecture' },
  { teacherIndex: 9, subjectCode: 'EST101', groupCode: 'T2', hours: 45, concept: 'lecture' },
  { teacherIndex: 9, subjectCode: 'EST101', groupCode: 'T1', hours: 2.5, concept: 'coordination' },

  { teacherIndex: 10, subjectCode: 'APR301', groupCode: 'T1', hours: 45, concept: 'lecture' },
  { teacherIndex: 10, subjectCode: 'APR301', groupCode: 'L1', hours: 15, concept: 'lecture' },

  { teacherIndex: 11, subjectCode: 'EST101', groupCode: 'L1', hours: 22.5, concept: 'lecture' },
  {
    teacherIndex: 11,
    subjectCode: 'EST101',
    groupCode: 'L1',
    hours: 12.5,
    concept: 'coordination',
  },
  { teacherIndex: 11, subjectCode: 'TFG401', groupCode: 'TU1', hours: 25, concept: 'tfg' },

  { teacherIndex: 12, subjectCode: 'FIS101', groupCode: 'L2', hours: 22.5, concept: 'lecture' },
  { teacherIndex: 12, subjectCode: 'PRO102', groupCode: 'L2', hours: 12.5, concept: 'lecture' },
]

export const SPACES = [
  {
    index: 1,
    building: 'Edifici A',
    name: 'Aula 1.1',
    capacity: 60,
    type: 'classroom' as const,
    equipment: ['projector', 'whiteboard'],
  },
  {
    index: 2,
    building: 'Edifici A',
    name: 'Laboratori 2.3',
    capacity: 30,
    type: 'computer_lab' as const,
    equipment: ['projector', 'workstations', 'linux'],
  },
  {
    index: 3,
    building: 'Edifici B',
    name: 'Sala de seminaris 0.5',
    capacity: 25,
    type: 'seminar_room' as const,
    equipment: ['videoconference', 'whiteboard'],
  },
]

/** Two-hour teaching slots, mornings first: the center's usual grid. */
export const SESSION_SLOTS = [
  { startTime: '09:00', endTime: '11:00' },
  { startTime: '11:00', endTime: '13:00' },
  { startTime: '15:00', endTime: '17:00' },
  { startTime: '17:00', endTime: '19:00' },
]
