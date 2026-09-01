/**
 * Adding a teacher without a spreadsheet.
 *
 * The account and the contract are two different things, created at different
 * moments — invited when somebody joins, contracted when the year is planned.
 * The second half had no route at all: the only way to write it was a bulk
 * import, so a center could not add a single lecturer by hand.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase } from './helpers.js'

describe.skipIf(!hasDatabase)('contracting a teacher', () => {
  const prisma = getPrismaClient()
  let app: FastifyInstance
  let centerId: string
  let universityId: string
  let headers: Record<string, string>
  let academicYearId: string
  const madeUsers: string[] = []

  /*
    A center of its own rather than the seeded one.

    These tests add teaching staff, and the seeded center's numbers are what
    the planner suite asserts against — twenty sessions placed, one pending.
    Test files run in parallel, so borrowing that center makes this suite's
    lecturers appear in the middle of somebody else's assertions.
  */
  beforeAll(async () => {
    app = await createTestApp()

    const university = await prisma.university.create({ data: { name: 'Universitat Docent' } })
    universityId = university.id
    const center = await prisma.center.create({
      data: { universityId, name: 'Centre Docent', code: 'DOC', settingsJson: {} },
    })
    centerId = center.id

    const year = await prisma.academicYear.create({
      data: {
        centerId,
        name: '2026-2027',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-07-31'),
        status: 'active',
      },
    })
    academicYearId = year.id

    const admin = await prisma.user.findFirstOrThrow({ where: { email: SEED.adminEmail } })
    await prisma.userCenterRole.create({
      data: { userId: admin.id, centerId, role: 'CENTER_ADMIN' },
    })

    headers = { 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId }
  })

  afterAll(async () => {
    await prisma.teacherProfile.deleteMany({ where: { centerId } })
    await prisma.userCenterRole.deleteMany({ where: { centerId } })
    await prisma.userInvitation.deleteMany({ where: { userId: { in: madeUsers } } })
    await prisma.user.deleteMany({ where: { id: { in: madeUsers } } })
    await prisma.academicYear.deleteMany({ where: { centerId } })
    // The contracts written above each left an audit entry, and the log is
    // INSERT-only by design (R4) — so tidying up here means deleting them.
    await prisma.auditLog.deleteMany({ where: { centerId } })
    await prisma.center.delete({ where: { id: centerId } })
    await prisma.university.delete({ where: { id: universityId } })
    await app.close()
    await disconnectPrisma()
  })

  /** Somebody with the lecturer role here and no contract for the year. */
  async function lecturerWithoutContract(email: string) {
    const user = await prisma.user.create({
      data: { email, firstName: 'Nova', lastName: 'Docent', status: 'invited' },
    })
    madeUsers.push(user.id)
    await prisma.userCenterRole.create({ data: { userId: user.id, centerId, role: 'TEACHER' } })
    return user
  }

  interface NewContract {
    userId: string
    category: string
    dedication: string
    contractedHours: number
  }

  const contract = (payload: NewContract) =>
    app.inject({ method: 'POST', url: '/api/v1/teachers', headers, payload })

  it('lists the lecturers who have no contract for this year', async () => {
    const user = await lecturerWithoutContract('sense.contracte@demo.uacademic.test')

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/teachers/candidates',
      headers,
    })

    expect(response.statusCode).toBe(200)
    const ids = response.json().items.map((row: { userId: string }) => row.userId)
    expect(ids).toContain(user.id)
  })

  it('gives one a contract, and drops them from the list of who needs one', async () => {
    const user = await lecturerWithoutContract('amb.contracte@demo.uacademic.test')

    const created = await contract({
      userId: user.id,
      category: 'associate_professor',
      dedication: 'full_time',
      contractedHours: 240,
    })

    expect(created.statusCode).toBe(201)
    expect(created.json().contractedHours).toBe(240)

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/teachers/candidates',
      headers,
    })
    expect(after.json().items.map((row: { userId: string }) => row.userId)).not.toContain(user.id)

    // And they are in the load table, which is the screen that was empty.
    const load = await app.inject({ method: 'GET', url: '/api/v1/teachers/load', headers })
    expect(load.json().teachers.map((row: { userId: string }) => row.userId)).toContain(user.id)
  })

  it('refuses to contract somebody who is not a lecturer here', async () => {
    const outsider = await prisma.user.create({
      data: { email: 'no.docent@demo.uacademic.test', firstName: 'No', lastName: 'Docent' },
    })
    madeUsers.push(outsider.id)

    const response = await contract({
      userId: outsider.id,
      category: 'adjunct',
      dedication: 'part_time',
      contractedHours: 120,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.messageKey).toBe('teachers.errors.notALecturer')
  })

  it('refuses a second contract for the same year, and says why', async () => {
    const user = await lecturerWithoutContract('dos.cops@demo.uacademic.test')
    const body = {
      userId: user.id,
      category: 'lecturer',
      dedication: 'part_time',
      contractedHours: 120,
    }

    expect((await contract(body)).statusCode).toBe(201)

    const again = await contract(body)
    expect(again.statusCode).toBe(409)
    expect(again.json().error.messageKey).toBe('teachers.errors.alreadyContracted')
  })

  it('changes the hours of a contract that already exists', async () => {
    const user = await lecturerWithoutContract('canvi.hores@demo.uacademic.test')
    const created = await contract({
      userId: user.id,
      category: 'lecturer',
      dedication: 'part_time',
      contractedHours: 100,
    })
    const profileId = created.json().teacherProfileId ?? created.json().id

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teachers/${profileId}`,
      headers,
      payload: { contractedHours: 180, dedication: 'full_time' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().contractedHours).toBe(180)

    const stored = await prisma.teacherProfile.findFirstOrThrow({
      where: { userId: user.id, academicYearId },
    })
    expect(Number(stored.contractedHours)).toBe(180)
    expect(stored.dedication).toBe('full_time')
  })

  /**
   * Assigning somebody to a group had no route: the only thing that could
   * write one was the assistant's execute step, so a center with the
   * assistant switched off could not staff a subject at all.
   */
  describe('giving a teacher something to teach', () => {
    it('assigns a group, and takes it away again', async () => {
      const user = await lecturerWithoutContract('amb.grups@demo.uacademic.test')
      const created = await contract({
        userId: user.id,
        category: 'lecturer',
        dedication: 'full_time',
        contractedHours: 200,
      })
      const profileId = String(created.json().teacherProfileId ?? created.json().id)

      // A subject and a group of its own in this year.
      const degree = await prisma.degree.create({
        data: {
          centerId,
          code: 'DOC',
          nameCa: 'Grau de prova',
          nameEs: 'Grado de prueba',
          nameEn: 'Test degree',
          level: 'bachelor',
        },
      })
      const subject = await prisma.subject.create({
        data: {
          centerId,
          academicYearId,
          degreeId: degree.id,
          code: 'PRV101',
          nameCa: 'Assignatura de prova',
          nameEs: 'Asignatura de prueba',
          nameEn: 'Test subject',
          ects: 6,
          year: 1,
          term: 't1',
          type: 'compulsory',
        },
      })
      const group = await prisma.group.create({
        data: { centerId, subjectId: subject.id, code: 'A1', plannedHours: 60 },
      })

      const offered = await app.inject({
        method: 'GET',
        url: `/api/v1/teachers/${profileId}/assignable-groups`,
        headers,
      })
      expect(offered.json().items.map((row: { id: string }) => row.id)).toContain(group.id)

      const assigned = await app.inject({
        method: 'POST',
        url: `/api/v1/teachers/${profileId}/assignments`,
        headers,
        payload: { groupId: group.id, concept: 'lecture', assignedHours: 60 },
      })
      expect(assigned.statusCode).toBe(201)
      expect(assigned.json().assignedHours).toBe(60)

      const assignmentId = assigned
        .json()
        .assignments.find((row: { groupId: string }) => row.groupId === group.id).id

      const again = await app.inject({
        method: 'POST',
        url: `/api/v1/teachers/${profileId}/assignments`,
        headers,
        payload: { groupId: group.id, concept: 'lecture', assignedHours: 60 },
      })
      expect(again.statusCode).toBe(409)
      expect(again.json().error.messageKey).toBe('teachers.errors.alreadyAssigned')

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/teachers/${profileId}/assignments/${assignmentId}`,
        headers,
      })
      expect(removed.statusCode).toBe(200)
      expect(removed.json().assignedHours).toBe(0)

      await prisma.group.delete({ where: { id: group.id } })
      await prisma.subject.delete({ where: { id: subject.id } })
      await prisma.degree.delete({ where: { id: degree.id } })
    })
  })

  it('is not something a lecturer can do to themselves', async () => {
    const lecturerEmail = 'jo.mateix@demo.uacademic.test'
    const user = await lecturerWithoutContract(lecturerEmail)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/teachers',
      headers: { 'x-mock-user': lecturerEmail, 'x-center-id': centerId },
      payload: {
        userId: user.id,
        category: 'full_professor',
        dedication: 'full_time',
        contractedHours: 999,
      },
    })

    expect(response.statusCode).toBe(403)
  })
})
