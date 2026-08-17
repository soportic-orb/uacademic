import { getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/config/env.js'

/**
 * Integration tests need a real MySQL: the tenant guarantees of R2 are only
 * worth something if they hold against the actual query planner. CI starts a
 * MySQL service, runs the migration and the seed, and sets DATABASE_URL.
 */
export const hasDatabase = Boolean(process.env.DATABASE_URL)

export const SEED = {
  centerId: '0198f0d2-8f2a-7000-8000-0b2d05e00001',
  teacherEmail: 'marta.puig@demo.uacademic.test',
  otherTeacherEmail: 'sergi.vila@demo.uacademic.test',
  superadminEmail: 'ona.bertran@demo.uacademic.test',
  adminEmail: 'ferran.aymerich@demo.uacademic.test',
}

/** A second center, so "cross-center access fails" has something to fail on. */
export const FOREIGN = {
  universityId: '0198f0d2-8f2a-7000-8000-0f0000000001',
  centerId: '0198f0d2-8f2a-7000-8000-0f0000000002',
  academicYearId: '0198f0d2-8f2a-7000-8000-0f0000000003',
  degreeId: '0198f0d2-8f2a-7000-8000-0f0000000004',
  subjectId: '0198f0d2-8f2a-7000-8000-0f0000000005',
  userId: '0198f0d2-8f2a-7000-8000-0f0000000006',
  roleId: '0198f0d2-8f2a-7000-8000-0f0000000007',
  userEmail: 'outsider@other-center.test',
}

export async function createTestApp(): Promise<FastifyInstance> {
  const env = loadEnv({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent', AUTH_MODE: 'mock' })
  return buildApp({ env })
}

export async function ensureForeignCenter(): Promise<void> {
  const prisma = getPrismaClient()

  await prisma.university.upsert({
    where: { id: FOREIGN.universityId },
    create: { id: FOREIGN.universityId, name: 'Universitat Veïna' },
    update: {},
  })

  await prisma.center.upsert({
    where: { id: FOREIGN.centerId },
    create: {
      id: FOREIGN.centerId,
      universityId: FOREIGN.universityId,
      name: 'Facultat Veïna',
      code: 'FVE',
      timezone: 'Europe/Madrid',
      localeDefault: 'ca',
    },
    update: {},
  })

  await prisma.academicYear.upsert({
    where: { id: FOREIGN.academicYearId },
    create: {
      id: FOREIGN.academicYearId,
      centerId: FOREIGN.centerId,
      name: '2026-2027',
      startDate: new Date('2026-09-14T00:00:00.000Z'),
      endDate: new Date('2027-07-31T00:00:00.000Z'),
      status: 'active',
    },
    update: {},
  })

  await prisma.degree.upsert({
    where: { id: FOREIGN.degreeId },
    create: {
      id: FOREIGN.degreeId,
      centerId: FOREIGN.centerId,
      code: 'GVE',
      nameCa: 'Grau Veí',
      nameEs: 'Grado Vecino',
      nameEn: 'Neighbour Degree',
      level: 'bachelor',
    },
    update: {},
  })

  await prisma.subject.upsert({
    where: { id: FOREIGN.subjectId },
    create: {
      id: FOREIGN.subjectId,
      centerId: FOREIGN.centerId,
      academicYearId: FOREIGN.academicYearId,
      degreeId: FOREIGN.degreeId,
      code: 'SECRET01',
      nameCa: 'Assignatura del centre veí',
      nameEs: 'Asignatura del centro vecino',
      nameEn: 'Neighbour center subject',
      ects: 6,
      year: 1,
      term: 't1',
      type: 'basic',
      teachingLanguage: 'ca',
    },
    update: {},
  })

  await prisma.user.upsert({
    where: { id: FOREIGN.userId },
    create: {
      id: FOREIGN.userId,
      email: FOREIGN.userEmail,
      firstName: 'Outsider',
      lastName: 'Veí',
      locale: 'ca',
      status: 'active',
    },
    update: {},
  })

  await prisma.userCenterRole.upsert({
    where: { id: FOREIGN.roleId },
    create: {
      id: FOREIGN.roleId,
      userId: FOREIGN.userId,
      centerId: FOREIGN.centerId,
      role: 'CENTER_ADMIN',
      validFrom: new Date('2026-09-14T00:00:00.000Z'),
    },
    update: {},
  })
}

export async function seedCenterId(): Promise<string> {
  const prisma = getPrismaClient()
  const center = await prisma.center.findFirst({ where: { code: 'FEC' } })
  if (!center) throw new Error('Demo center FEC not found. Run `pnpm db:seed` first.')
  return center.id
}
