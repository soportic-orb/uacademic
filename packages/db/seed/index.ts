/**
 * Demo seed. Idempotent: every write is an upsert on a deterministic id, so
 * running it twice leaves the database in the same state.
 *
 * The timetable is not hand-placed: sessions are allocated with the very same
 * conflict detection and availability logic the planner uses
 * (`@uacademic/shared`), and the seed refuses to finish if it produced a
 * conflict.
 */
import 'dotenv/config'

import {
  type AvailabilityEntry,
  type SessionLike,
  type Weekday,
  computeTeacherLoad,
  defaultCenterSettings,
  detectSessionConflicts,
  effectiveAvailability,
  findConflictsFor,
  isAssignable,
} from '@uacademic/shared'

import { createPrismaClient } from '../src/client.js'
import { ASSIGNMENTS, SESSION_SLOTS, SPACES, SUBJECTS, TEACHERS } from './data.js'
import { seedId } from './ids.js'
import { encryptSecret, generateTotpSecret, hashPassword } from './local-credentials.js'

const prisma = createPrismaClient()

const UNIVERSITY_ID = seedId('university', 1)
const TENANT_ID = seedId('tenant', 1)
const CENTER_ID = seedId('center', 1)
const ACADEMIC_YEAR_ID = seedId('academicYear', 1)
const SCHEDULE_VERSION_ID = seedId('scheduleVersion', 1)

const YEAR_START = new Date('2026-09-14T00:00:00.000Z')
const YEAR_END = new Date('2027-07-31T00:00:00.000Z')

const TERM_DATES: Record<string, { from: Date; to: Date }> = {
  t1: { from: new Date('2026-09-14T00:00:00.000Z'), to: new Date('2026-12-18T00:00:00.000Z') },
  t2: { from: new Date('2027-01-26T00:00:00.000Z'), to: new Date('2027-05-14T00:00:00.000Z') },
  t3: { from: new Date('2027-01-26T00:00:00.000Z'), to: new Date('2027-05-14T00:00:00.000Z') },
  annual: { from: new Date('2026-09-14T00:00:00.000Z'), to: new Date('2027-05-14T00:00:00.000Z') },
}

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5]

async function seedOrganization() {
  await prisma.university.upsert({
    where: { id: UNIVERSITY_ID },
    create: {
      id: UNIVERSITY_ID,
      name: 'Universitat Exemple de Catalunya',
      logoUrl: null,
      settingsJson: { brandColor: '#0072CE' },
    },
    update: { name: 'Universitat Exemple de Catalunya' },
  })

  await prisma.entraTenant.upsert({
    where: { id: TENANT_ID },
    create: {
      id: TENANT_ID,
      // Demo tenant GUID. R3: only tenants listed here pass `tid` validation.
      tenantId: '11111111-2222-3333-4444-555555555555',
      displayName: 'Universitat Exemple (demo tenant)',
      issuer: 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0',
      status: 'active',
    },
    update: { displayName: 'Universitat Exemple (demo tenant)' },
  })

  await prisma.center.upsert({
    where: { id: CENTER_ID },
    create: {
      id: CENTER_ID,
      universityId: UNIVERSITY_ID,
      name: 'Facultat d’Enginyeria i Ciències',
      code: 'FEC',
      entraTenantId: '11111111-2222-3333-4444-555555555555',
      timezone: 'Europe/Madrid',
      localeDefault: 'ca',
      settingsJson: {
        ...defaultCenterSettings,
        schedule: { ...defaultCenterSettings.schedule, dayEnd: '20:00' },
      },
    },
    update: {},
  })

  await prisma.academicYear.upsert({
    where: { id: ACADEMIC_YEAR_ID },
    create: {
      id: ACADEMIC_YEAR_ID,
      centerId: CENTER_ID,
      name: '2026-2027',
      startDate: YEAR_START,
      endDate: YEAR_END,
      status: 'active',
    },
    update: { status: 'active' },
  })
}

interface PlatformUserSeed {
  index: number
  firstName: string
  lastName: string
  email: string
  role: 'SUPERADMIN' | 'CENTER_ADMIN'
}

const PLATFORM_USERS: PlatformUserSeed[] = [
  {
    index: 100,
    firstName: 'Ona',
    lastName: 'Bertran Lluch',
    email: 'ona.bertran@demo.uacademic.test',
    role: 'SUPERADMIN',
  },
  {
    index: 101,
    firstName: 'Ferran',
    lastName: 'Aymerich Sala',
    email: 'ferran.aymerich@demo.uacademic.test',
    role: 'CENTER_ADMIN',
  },
]

async function upsertUser(
  index: number,
  data: { firstName: string; lastName: string; email: string; locale?: 'ca' | 'es' | 'en' },
) {
  const id = seedId('user', index)
  return prisma.user.upsert({
    where: { id },
    create: {
      id,
      // Demo accounts have no Entra identity yet: `oid` arrives on first login.
      entraOid: null,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      locale: data.locale ?? 'ca',
      theme: 'system',
      status: 'active',
    },
    update: { email: data.email, firstName: data.firstName, lastName: data.lastName },
  })
}

async function upsertRole(index: number, userId: string, role: string) {
  const id = seedId('role', index)
  await prisma.userCenterRole.upsert({
    where: { id },
    create: {
      id,
      userId,
      centerId: CENTER_ID,
      role: role as 'SUPERADMIN' | 'CENTER_ADMIN' | 'COORDINATOR' | 'TEACHER',
      validFrom: YEAR_START,
    },
    update: {},
  })
}

async function seedPlatformUsers() {
  for (const person of PLATFORM_USERS) {
    const user = await upsertUser(person.index, person)
    await upsertRole(person.index, user.id, person.role)

    if (person.role === 'SUPERADMIN') await seedLocalCredential(user.id)
  }
}

/**
 * The break-glass credential: the platform must stay reachable when Entra ID
 * is down. Only the superadmin gets one — everyone else signs in through SSO.
 *
 * The TOTP secret is only seeded when APP_ENCRYPTION_KEY is set, because it is
 * stored encrypted and there is no sane fallback for that.
 */
async function seedLocalCredential(userId: string) {
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? 'Superadmin-2026-demo'
  const encryptionKey = process.env.APP_ENCRYPTION_KEY
  const existing = await prisma.localCredential.findUnique({ where: { userId } })
  if (existing) return

  const totpSecret = encryptionKey ? generateTotpSecret() : null

  await prisma.localCredential.create({
    data: {
      userId,
      passwordHash: await hashPassword(password),
      ...(totpSecret && encryptionKey
        ? {
            totpSecretEnc: encryptSecret(totpSecret, encryptionKey),
            totpConfirmedAt: new Date(),
          }
        : {}),
    },
  })

  console.log(`\nLocal superadmin credential created (password from SEED_SUPERADMIN_PASSWORD).`)
  if (totpSecret) {
    console.log(`  TOTP secret (demo only, enrol it in an authenticator): ${totpSecret}`)
  } else {
    console.log('  TOTP not enrolled: set APP_ENCRYPTION_KEY and re-seed to enable it.')
  }
}

async function seedDegrees() {
  const degrees = [
    {
      index: 1,
      code: 'GEI',
      nameCa: 'Grau en Enginyeria Informàtica',
      nameEs: 'Grado en Ingeniería Informática',
      nameEn: 'Bachelor in Computer Engineering',
    },
    {
      index: 2,
      code: 'GCD',
      nameCa: 'Grau en Ciència de Dades',
      nameEs: 'Grado en Ciencia de Datos',
      nameEn: 'Bachelor in Data Science',
    },
  ]

  const byCode = new Map<string, string>()
  for (const degree of degrees) {
    const id = seedId('degree', degree.index)
    await prisma.degree.upsert({
      where: { id },
      create: {
        id,
        centerId: CENTER_ID,
        code: degree.code,
        nameCa: degree.nameCa,
        nameEs: degree.nameEs,
        nameEn: degree.nameEn,
        level: 'bachelor',
      },
      update: {},
    })
    byCode.set(degree.code, id)
  }
  return byCode
}

async function seedTeachers() {
  const profileByIndex = new Map<number, string>()

  for (const teacher of TEACHERS) {
    const user = await upsertUser(teacher.index, teacher)
    await upsertRole(teacher.index, user.id, 'TEACHER')
    if (teacher.isCoordinator) {
      await upsertRole(200 + teacher.index, user.id, 'COORDINATOR')
    }

    const profileId = seedId('profile', teacher.index)
    await prisma.teacherProfile.upsert({
      where: { id: profileId },
      create: {
        id: profileId,
        userId: user.id,
        centerId: CENTER_ID,
        academicYearId: ACADEMIC_YEAR_ID,
        category: teacher.category,
        dedication: teacher.dedication,
        contractedHours: teacher.contractedHours,
      },
      update: { contractedHours: teacher.contractedHours },
    })
    profileByIndex.set(teacher.index, profileId)

    if (teacher.reduction) {
      const reductionId = seedId('reduction', teacher.index)
      await prisma.teacherReduction.upsert({
        where: { id: reductionId },
        create: {
          id: reductionId,
          centerId: CENTER_ID,
          teacherProfileId: profileId,
          reason: teacher.reduction.reason,
          hours: teacher.reduction.hours,
          status: 'approved',
          approvedAt: YEAR_START,
        },
        update: {},
      })
    }

    for (const [position, area] of teacher.knowledgeAreas.entries()) {
      const skillId = seedId('skill', teacher.index * 10 + position)
      await prisma.teacherSkill.upsert({
        where: { id: skillId },
        create: {
          id: skillId,
          centerId: CENTER_ID,
          teacherProfileId: profileId,
          knowledgeArea: area,
        },
        update: {},
      })
    }

    for (const [position, window] of teacher.availability.entries()) {
      const availabilityId = seedId('availability', teacher.index * 100 + position)
      await prisma.availability.upsert({
        where: { id: availabilityId },
        create: {
          id: availabilityId,
          centerId: CENTER_ID,
          teacherProfileId: profileId,
          weekday: window.weekday,
          startTime: window.startTime,
          endTime: window.endTime,
          level: window.level,
        },
        update: { level: window.level },
      })
    }
  }

  return profileByIndex
}

async function seedSubjects(
  degreeByCode: Map<string, string>,
  profileByIndex: Map<number, string>,
) {
  const subjectByCode = new Map<string, string>()
  const groupByKey = new Map<
    string,
    { id: string; plannedHours: number; requiredSpaceType: string }
  >()

  for (const subject of SUBJECTS) {
    const subjectId = seedId('subject', subject.index)
    const degreeId = degreeByCode.get(subject.degreeCode)
    if (!degreeId) throw new Error(`Unknown degree ${subject.degreeCode}`)

    await prisma.subject.upsert({
      where: { id: subjectId },
      create: {
        id: subjectId,
        centerId: CENTER_ID,
        academicYearId: ACADEMIC_YEAR_ID,
        degreeId,
        code: subject.code,
        nameCa: subject.nameCa,
        nameEs: subject.nameEs,
        nameEn: subject.nameEn,
        ects: subject.ects,
        year: subject.year,
        term: subject.term,
        type: subject.type,
        teachingLanguage: subject.teachingLanguage,
      },
      update: {},
    })
    subjectByCode.set(subject.code, subjectId)

    const coordinator = TEACHERS.find(
      (teacher) => teacher.index === subject.coordinatorTeacherIndex,
    )
    if (coordinator) {
      await prisma.subjectCoordinator.upsert({
        where: {
          subjectId_userId: { subjectId, userId: seedId('user', coordinator.index) },
        },
        create: {
          subjectId,
          userId: seedId('user', coordinator.index),
          centerId: CENTER_ID,
        },
        update: {},
      })
    }

    for (const [position, group] of subject.groups.entries()) {
      const groupId = seedId('group', subject.index * 10 + position)
      await prisma.group.upsert({
        where: { id: groupId },
        create: {
          id: groupId,
          centerId: CENTER_ID,
          subjectId,
          type: group.type,
          code: group.code,
          plannedHours: group.plannedHours,
          capacity: group.capacity,
          requiredSpaceType: group.requiredSpaceType,
        },
        update: { plannedHours: group.plannedHours },
      })
      groupByKey.set(`${subject.code}#${group.code}`, {
        id: groupId,
        plannedHours: group.plannedHours,
        requiredSpaceType: group.requiredSpaceType,
      })
    }
  }

  // Profiles are needed to build assignments; the caller passes them in so the
  // teacher seed can run first.
  return { subjectByCode, groupByKey, profileByIndex }
}

async function seedSpaces() {
  const spaceIds: { id: string; type: string; capacity: number }[] = []
  for (const space of SPACES) {
    const id = seedId('space', space.index)
    await prisma.space.upsert({
      where: { id },
      create: {
        id,
        centerId: CENTER_ID,
        building: space.building,
        name: space.name,
        capacity: space.capacity,
        type: space.type,
        equipmentJson: space.equipment,
      },
      update: {},
    })
    spaceIds.push({ id, type: space.type, capacity: space.capacity })
  }
  return spaceIds
}

async function seedAssignments(
  groupByKey: Map<string, { id: string }>,
  profileByIndex: Map<number, string>,
) {
  for (const [position, assignment] of ASSIGNMENTS.entries()) {
    const group = groupByKey.get(`${assignment.subjectCode}#${assignment.groupCode}`)
    const teacherProfileId = profileByIndex.get(assignment.teacherIndex)
    if (!group || !teacherProfileId) {
      throw new Error(
        `Assignment ${position} points at missing data: ${assignment.subjectCode}#${assignment.groupCode}`,
      )
    }

    const id = seedId('assignment', position + 1)
    await prisma.assignment.upsert({
      where: { id },
      create: {
        id,
        centerId: CENTER_ID,
        groupId: group.id,
        teacherProfileId,
        academicYearId: ACADEMIC_YEAR_ID,
        assignedHours: assignment.hours,
        concept: assignment.concept,
      },
      update: { assignedHours: assignment.hours },
    })
  }
}

interface PlacementInput {
  groupId: string
  subjectCode: string
  groupCode: string
  term: string
  teacherProfileId: string
  teacherIndex: number
  requiredSpaceType: string
}

/**
 * Places one weekly session per group: first pass honouring the teacher's
 * availability, second pass ignoring it so a demo timetable is always complete.
 * Every candidate is checked with the shared conflict detector.
 */
function allocateSessions(
  placements: PlacementInput[],
  spaces: { id: string; type: string }[],
  availabilityByTeacher: Map<number, AvailabilityEntry[]>,
): { sessions: SessionLike[]; unplaced: PlacementInput[]; outsideAvailability: string[] } {
  const sessions: SessionLike[] = []
  const unplaced: PlacementInput[] = []
  const outsideAvailability: string[] = []

  for (const placement of placements) {
    const dates = TERM_DATES[placement.term] ?? TERM_DATES.annual!
    const candidateSpaces = spaces.filter((space) => space.type === placement.requiredSpaceType)
    const availability = availabilityByTeacher.get(placement.teacherIndex) ?? []

    let placed = false
    for (const respectAvailability of [true, false]) {
      if (placed) break
      for (const weekday of WEEKDAYS) {
        if (placed) break
        for (const slot of SESSION_SLOTS) {
          if (placed) break
          if (respectAvailability) {
            const level = effectiveAvailability(
              { weekday, start: slot.startTime, end: slot.endTime },
              availability,
            )
            if (!isAssignable(level)) continue
          }

          for (const space of candidateSpaces) {
            const candidate: SessionLike = {
              id: `${placement.subjectCode}#${placement.groupCode}`,
              weekday,
              startTime: slot.startTime,
              endTime: slot.endTime,
              dateFrom: dates.from,
              dateTo: dates.to,
              recurrence: 'weekly',
              teacherProfileId: placement.teacherProfileId,
              spaceId: space.id,
              groupId: placement.groupId,
            }

            if (findConflictsFor(candidate, sessions).length > 0) continue

            sessions.push(candidate)
            if (!respectAvailability) outsideAvailability.push(candidate.id)
            placed = true
            break
          }
        }
      }
    }

    if (!placed) unplaced.push(placement)
  }

  return { sessions, unplaced, outsideAvailability }
}

async function seedSchedule(
  groupByKey: Map<string, { id: string; requiredSpaceType: string }>,
  profileByIndex: Map<number, string>,
  spaces: { id: string; type: string }[],
) {
  await prisma.scheduleVersion.upsert({
    where: { id: SCHEDULE_VERSION_ID },
    create: {
      id: SCHEDULE_VERSION_ID,
      centerId: CENTER_ID,
      academicYearId: ACADEMIC_YEAR_ID,
      name: 'Versió inicial 2026-2027',
      status: 'draft',
    },
    update: {},
  })

  // One session per group, taught by whoever holds the largest lecture
  // assignment on it.
  const placements: PlacementInput[] = []
  for (const subject of SUBJECTS) {
    for (const group of subject.groups) {
      const key = `${subject.code}#${group.code}`
      const groupRow = groupByKey.get(key)
      if (!groupRow) continue

      const main = ASSIGNMENTS.filter(
        (assignment) =>
          assignment.subjectCode === subject.code &&
          assignment.groupCode === group.code &&
          assignment.concept === 'lecture',
      ).sort((a, b) => b.hours - a.hours)[0]
      if (!main) continue

      const teacherProfileId = profileByIndex.get(main.teacherIndex)
      if (!teacherProfileId) continue

      placements.push({
        groupId: groupRow.id,
        subjectCode: subject.code,
        groupCode: group.code,
        term: subject.term,
        teacherProfileId,
        teacherIndex: main.teacherIndex,
        requiredSpaceType: groupRow.requiredSpaceType,
      })
    }
  }

  const availabilityByTeacher = new Map<number, AvailabilityEntry[]>(
    TEACHERS.map((teacher) => [
      teacher.index,
      teacher.availability.map((window) => ({
        weekday: window.weekday as Weekday,
        startTime: window.startTime,
        endTime: window.endTime,
        level: window.level,
      })),
    ]),
  )

  const { sessions, unplaced, outsideAvailability } = allocateSessions(
    placements,
    spaces,
    availabilityByTeacher,
  )

  const conflicts = detectSessionConflicts(sessions)
  if (conflicts.length > 0) {
    throw new Error(`Seed produced ${conflicts.length} timetable conflicts; refusing to write.`)
  }

  for (const [position, session] of sessions.entries()) {
    const id = seedId('session', position + 1)
    await prisma.classSession.upsert({
      where: { id },
      create: {
        id,
        centerId: CENTER_ID,
        scheduleVersionId: SCHEDULE_VERSION_ID,
        groupId: session.groupId!,
        teacherProfileId: session.teacherProfileId,
        spaceId: session.spaceId,
        weekday: session.weekday,
        startTime: session.startTime,
        endTime: session.endTime,
        dateFrom: session.dateFrom,
        dateTo: session.dateTo,
        recurrence: 'weekly',
      },
      update: {},
    })
  }

  return { placed: sessions.length, unplaced, outsideAvailability }
}

/**
 * A regulation document plus the settings version it justifies: this is what
 * the "why does this rule apply?" link reads (R9).
 */
async function seedSettingsProvenance() {
  const documentId = seedId('document', 1)
  const settingsVersionId = seedId('settingsVersion', 1)
  const admin = PLATFORM_USERS.find((person) => person.role === 'CENTER_ADMIN')

  await prisma.document.upsert({
    where: { id: documentId },
    create: {
      id: documentId,
      centerId: CENTER_ID,
      scope: 'center',
      scopeId: CENTER_ID,
      title: 'Normativa d’ordenació docent 2026-2027',
      type: 'regulation',
      academicYearId: ACADEMIC_YEAR_ID,
      language: 'ca',
      validFrom: YEAR_START,
      validTo: YEAR_END,
      visibility: 'center',
      filePath: 'demo/normativa-ordenacio-docent-2026-2027.pdf',
      mime: 'application/pdf',
      sizeBytes: 248_320,
      checksum: 'f'.repeat(64),
      status: 'indexed',
      uploadedBy: admin ? seedId('user', admin.index) : null,
    },
    update: {},
  })

  await prisma.centerSettingsVersion.upsert({
    where: { id: settingsVersionId },
    create: {
      id: settingsVersionId,
      centerId: CENTER_ID,
      academicYearId: ACADEMIC_YEAR_ID,
      settingsJson: {
        ...defaultCenterSettings,
        schedule: { ...defaultCenterSettings.schedule, dayEnd: '20:00' },
      },
      source: 'manual',
      sourceDocumentId: documentId,
      approvedBy: admin ? seedId('user', admin.index) : null,
      notes: 'Configuració inicial del centre a partir de la normativa vigent.',
    },
    update: {},
  })

  const provenance = [
    {
      index: 1,
      paramKey: 'schedule.maxConsecutiveHours',
      page: 12,
      section: 'Article 8.2',
      quote:
        'No es poden programar més de quatre hores lectives consecutives per a un mateix docent.',
    },
    {
      index: 2,
      paramKey: 'load.thresholds.limitUpTo',
      page: 9,
      section: 'Article 6.4',
      quote:
        'La dedicació docent assignada no pot superar el 110 % de la càrrega contractada sense autorització expressa.',
    },
  ]

  for (const record of provenance) {
    const id = seedId('provenance', record.index)
    await prisma.settingProvenance.upsert({
      where: { id },
      create: {
        id,
        centerId: CENTER_ID,
        paramKey: record.paramKey,
        settingsVersionId,
        documentId,
        page: record.page,
        section: record.section,
        quote: record.quote,
      },
      update: {},
    })
  }
}

async function report(profileByIndex: Map<number, string>) {
  console.log('\nTeaching load per teacher (computed with @uacademic/shared):')
  const statusCount = { under: 0, optimal: 0, limit: 0, over: 0 }

  for (const teacher of TEACHERS) {
    const profileId = profileByIndex.get(teacher.index)
    if (!profileId) continue

    const assignments = ASSIGNMENTS.filter(
      (assignment) => assignment.teacherIndex === teacher.index,
    ).map((assignment) => ({ concept: assignment.concept, hours: assignment.hours }))

    const load = computeTeacherLoad({
      contractedHours: teacher.contractedHours,
      reductions: teacher.reduction ? [{ hours: teacher.reduction.hours, approved: true }] : [],
      assignments,
    })
    statusCount[load.status] += 1

    console.log(
      `  ${`${teacher.firstName} ${teacher.lastName}`.padEnd(24)} ` +
        `capacity ${String(load.capacityHours).padStart(6)} h · ` +
        `assigned ${String(load.assignedHours).padStart(6)} h · ` +
        `${String(load.ratioPercent ?? '—').padStart(6)} % · ${load.status}`,
    )
  }

  console.log(
    `\n  traffic light → under ${statusCount.under} · optimal ${statusCount.optimal} · ` +
      `limit ${statusCount.limit} · over ${statusCount.over}`,
  )
}

async function main() {
  console.log('Seeding UAcademic demo data…')

  await seedOrganization()
  await seedPlatformUsers()
  const degreeByCode = await seedDegrees()
  const profileByIndex = await seedTeachers()
  const { groupByKey } = await seedSubjects(degreeByCode, profileByIndex)
  const spaces = await seedSpaces()
  await seedAssignments(groupByKey, profileByIndex)
  const schedule = await seedSchedule(groupByKey, profileByIndex, spaces)
  await seedSettingsProvenance()

  console.log(
    `\nSeeded: 1 university · 1 center · 1 academic year · ${SUBJECTS.length} subjects · ` +
      `${TEACHERS.length} teachers · ${SPACES.length} spaces · ${ASSIGNMENTS.length} assignments`,
  )
  console.log(
    `Timetable: ${schedule.placed} sessions placed, ${schedule.unplaced.length} unplaced, ` +
      `${schedule.outsideAvailability.length} outside the teacher's declared availability`,
  )
  if (schedule.unplaced.length > 0) {
    console.warn(
      `  unplaced groups: ${schedule.unplaced.map((p) => `${p.subjectCode}#${p.groupCode}`).join(', ')}`,
    )
  }

  await report(profileByIndex)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error: unknown) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
