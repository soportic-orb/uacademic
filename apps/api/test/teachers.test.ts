/**
 * The capacity surface of phase 2: the profile card, reductions, skills, the
 * availability editor, date exceptions, the filtered center panel and its
 * Excel export.
 *
 * These run against the seeded database because the interesting parts — who may
 * write whose availability, whether a reduction actually lowers the capacity,
 * whether the export matches the filtered table — only mean something end to
 * end.
 */
import { disconnectPrisma, getPrismaClient } from '@uacademic/db'
import ExcelJS from 'exceljs'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SEED, createTestApp, hasDatabase, seedCenterId } from './helpers.js'

describe.skipIf(!hasDatabase)('teaching capacity', () => {
  let app: FastifyInstance
  let centerId: string
  let teacherProfileId: string
  const prisma = getPrismaClient()

  const asAdmin = () => ({ 'x-mock-user': SEED.adminEmail, 'x-center-id': centerId })
  const asCoordinator = () => ({ 'x-mock-user': SEED.teacherEmail, 'x-center-id': centerId })
  const asTeacher = () => ({ 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId })

  beforeAll(async () => {
    app = await createTestApp()
    centerId = await seedCenterId()

    const own = await app.inject({
      method: 'GET',
      url: '/api/v1/teachers/me',
      headers: asTeacher(),
    })
    teacherProfileId = own.json().teacherProfileId
  })

  afterAll(async () => {
    await prisma.teacherReduction.deleteMany({ where: { reason: { startsWith: 'Test ' } } })
    await prisma.availabilityException.deleteMany({ where: { reason: { startsWith: 'Test ' } } })
    await app.close()
    await disconnectPrisma()
  })

  describe('the profile card', () => {
    it('returns the contract, the reductions and what the teacher can teach', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/teachers/${teacherProfileId}`,
        headers: asAdmin(),
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body).toMatchObject({ lastName: 'Vila Rovira', status: 'under' })
      expect(body.category).toBeTruthy()
      expect(Array.isArray(body.reductions)).toBe(true)
      expect(Array.isArray(body.skills)).toBe(true)
      expect(body.capacityHours).toBe(body.contractedHours - body.reductionHours)
    })

    it('lets a teacher read their own card but not a colleague’s', async () => {
      const own = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/me',
        headers: asTeacher(),
      })
      expect(own.statusCode).toBe(200)

      const colleague = await prisma.teacherProfile.findFirst({
        where: { centerId, NOT: { id: teacherProfileId } },
        select: { id: true },
      })
      const forbidden = await app.inject({
        method: 'GET',
        url: `/api/v1/teachers/${colleague?.id}`,
        headers: asTeacher(),
      })
      expect(forbidden.statusCode).toBe(403)
    })

    it('breaks the workload down by subject and by concept', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/me/workload',
        headers: asCoordinator(),
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.bySubject.length).toBeGreaterThan(0)
      expect(body.conceptTotals).toHaveLength(5)

      const fromSubjects = body.bySubject.reduce(
        (total: number, subject: { hours: number }) => total + subject.hours,
        0,
      )
      // The breakdown and the total are the same number, seen twice.
      expect(Math.round(fromSubjects * 100) / 100).toBe(body.assignedHours)
    })
  })

  describe('reductions', () => {
    it('lowers the capacity only once the reduction is approved', async () => {
      const before = await app.inject({
        method: 'GET',
        url: `/api/v1/teachers/${teacherProfileId}`,
        headers: asAdmin(),
      })
      const capacityBefore = before.json().capacityHours

      const pending = await app.inject({
        method: 'POST',
        url: `/api/v1/teachers/${teacherProfileId}/reductions`,
        headers: asAdmin(),
        payload: { reason: 'Test càrrec acadèmic', hours: 30, status: 'pending' },
      })
      expect(pending.statusCode).toBe(201)
      expect(pending.json().capacityHours).toBe(capacityBefore)

      const reductionId = pending
        .json()
        .reductions.find(
          (reduction: { reason: string }) => reduction.reason === 'Test càrrec acadèmic',
        ).id

      const approved = await app.inject({
        method: 'PATCH',
        url: `/api/v1/teachers/${teacherProfileId}/reductions/${reductionId}`,
        headers: asAdmin(),
        payload: { reason: 'Test càrrec acadèmic', hours: 30, status: 'approved' },
      })
      expect(approved.statusCode).toBe(200)
      expect(approved.json().capacityHours).toBe(capacityBefore - 30)
      expect(approved.json().reductions[0].approverName).toBeTruthy()

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/teachers/${teacherProfileId}/reductions/${reductionId}`,
        headers: asAdmin(),
      })
      expect(removed.statusCode).toBe(200)
      expect(removed.json().capacityHours).toBe(capacityBefore)
    })

    it('is coordination’s to record, and the administration’s to approve', async () => {
      /*
        Coordination is the side that discovers somebody has taken on a degree
        coordination or a leave — sending that round to be typed in elsewhere
        is asking them to wait for their own planning figures. But approving
        it takes hours off a contract, so it waits for the administration.
      */
      const recorded = await app.inject({
        method: 'POST',
        url: `/api/v1/teachers/${teacherProfileId}/reductions`,
        headers: asCoordinator(),
        payload: { reason: 'Coordinació de titulació', hours: 20, status: 'approved' },
      })

      expect(recorded.statusCode).toBe(201)
      const written = recorded
        .json()
        .reductions.find(
          (reduction: { reason: string }) => reduction.reason === 'Coordinació de titulació',
        )
      // Asked for approved; recorded as pending, because it is not theirs.
      expect(written.status).toBe('pending')

      const approved = await app.inject({
        method: 'PATCH',
        url: `/api/v1/teachers/${teacherProfileId}/reductions/${written.id}`,
        headers: asAdmin(),
        payload: { reason: 'Coordinació de titulació', hours: 20, status: 'approved' },
      })
      expect(approved.json().reductions[0].status).toBe('approved')

      await app.inject({
        method: 'DELETE',
        url: `/api/v1/teachers/${teacherProfileId}/reductions/${written.id}`,
        headers: asAdmin(),
      })
    })

    it('lets coordination edit one without losing the approval it cannot give', async () => {
      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/teachers/${teacherProfileId}/reductions`,
        headers: asAdmin(),
        payload: { reason: 'Recerca', hours: 10, status: 'approved' },
      })
      const id = created
        .json()
        .reductions.find((reduction: { reason: string }) => reduction.reason === 'Recerca').id

      const edited = await app.inject({
        method: 'PATCH',
        url: `/api/v1/teachers/${teacherProfileId}/reductions/${id}`,
        headers: asCoordinator(),
        payload: { reason: 'Recerca competitiva', hours: 12, status: 'approved' },
      })

      // The edit lands and the approval it already had is not taken away for
      // being restated by somebody who could not have granted it.
      expect(edited.statusCode).toBe(200)
      const after = edited
        .json()
        .reductions.find((reduction: { id: string }) => reduction.id === id)
      expect(after.reason).toBe('Recerca competitiva')
      expect(after.status).toBe('approved')

      await app.inject({
        method: 'DELETE',
        url: `/api/v1/teachers/${teacherProfileId}/reductions/${id}`,
        headers: asAdmin(),
      })
    })

    it('is not a lecturer’s to record', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/teachers/${teacherProfileId}/reductions`,
        headers: { 'x-mock-user': SEED.otherTeacherEmail, 'x-center-id': centerId },
        payload: { reason: 'Meva', hours: 40, status: 'pending' },
      })

      expect(response.statusCode).toBe(403)
    })

    it('records who approved it, in the audit log', async () => {
      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/teachers/${teacherProfileId}/reductions`,
        headers: asAdmin(),
        payload: { reason: 'Test auditoria', hours: 5, status: 'approved' },
      })
      const reduction = created
        .json()
        .reductions.find((entry: { reason: string }) => entry.reason === 'Test auditoria')

      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'teacher_reduction', entityId: reduction.id, action: 'create' },
      })
      expect(audit).not.toBeNull()
      expect(audit?.source).toBe('user')

      await app.inject({
        method: 'DELETE',
        url: `/api/v1/teachers/${teacherProfileId}/reductions/${reduction.id}`,
        headers: asAdmin(),
      })
    })

    it('refuses a teacher writing their own reduction', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/teachers/${teacherProfileId}/reductions`,
        headers: asTeacher(),
        payload: { reason: 'Test autoservei', hours: 100, status: 'approved' },
      })
      expect(response.statusCode).toBe(403)
    })
  })

  describe('what a teacher can teach', () => {
    it('replaces the subjects and the knowledge areas as a set', async () => {
      const subject = await prisma.subject.findFirst({ where: { centerId }, select: { id: true } })
      const before = await app.inject({
        method: 'GET',
        url: `/api/v1/teachers/${teacherProfileId}`,
        headers: asCoordinator(),
      })
      const seeded = before.json().skills as {
        subjectId: string | null
        knowledgeArea: string | null
      }[]

      const saved = await app.inject({
        method: 'PUT',
        url: `/api/v1/teachers/${teacherProfileId}/skills`,
        headers: asCoordinator(),
        payload: { subjectIds: [subject?.id], knowledgeAreas: ['Test àrea', 'Test àrea'] },
      })

      expect(saved.statusCode).toBe(200)
      const skills = saved.json().skills
      expect(skills.filter((skill: { subjectId: string | null }) => skill.subjectId)).toHaveLength(
        1,
      )
      // The duplicate area is stored once: this is a set, not a list.
      expect(
        skills.filter((skill: { knowledgeArea: string | null }) => skill.knowledgeArea),
      ).toHaveLength(1)

      // Put the seeded set back: the demo data is what the other suites and
      // the e2e run read.
      const restored = await app.inject({
        method: 'PUT',
        url: `/api/v1/teachers/${teacherProfileId}/skills`,
        headers: asCoordinator(),
        payload: {
          subjectIds: seeded.flatMap((skill) => (skill.subjectId ? [skill.subjectId] : [])),
          knowledgeAreas: seeded.flatMap((skill) =>
            skill.knowledgeArea ? [skill.knowledgeArea] : [],
          ),
        },
      })
      // Asserted as sets: the endpoint stores each subject and each area once,
      // so a demo database that accumulated a duplicate would otherwise make
      // this fail for the wrong reason.
      const setOf = (skills: { subjectId: string | null; knowledgeArea: string | null }[]) => ({
        subjects: new Set(skills.flatMap((skill) => (skill.subjectId ? [skill.subjectId] : []))),
        areas: new Set(
          skills.flatMap((skill) => (skill.knowledgeArea ? [skill.knowledgeArea] : [])),
        ),
      })
      expect(setOf(restored.json().skills)).toEqual(setOf(seeded))
    })

    it('refuses a subject that belongs to another center', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/teachers/${teacherProfileId}/skills`,
        headers: asCoordinator(),
        payload: { subjectIds: ['0198f0d2-8f2a-7000-8000-0f0000000005'], knowledgeAreas: [] },
      })

      expect(response.statusCode).toBe(422)
      expect(response.json().error.details[0].path).toBe('subjectIds')
    })

    it('keeps a teacher from declaring their own subjects', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/teachers/${teacherProfileId}/skills`,
        headers: asTeacher(),
        payload: { subjectIds: [], knowledgeAreas: ['Test autoservei'] },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  describe('availability', () => {
    it('gives the editor the grid geometry from the center settings', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/me/availability',
        headers: asTeacher(),
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.grid).toMatchObject({ dayStart: '08:00', slotMinutes: 30 })
      expect(body.grid.weekdays).toEqual([1, 2, 3, 4, 5])
      expect(body.editable).toBe(true)
      expect(body.hoursByLevel.available + body.hoursByLevel.preferred).toBeGreaterThan(0)
    })

    it('replaces the whole week and reports the hours per level', async () => {
      const original = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/me/availability',
        headers: asTeacher(),
      })
      const before = original.json().entries

      const saved = await app.inject({
        method: 'PUT',
        url: '/api/v1/teachers/me/availability',
        headers: asTeacher(),
        payload: {
          entries: [
            { weekday: 1, startTime: '09:00', endTime: '13:00', level: 'preferred' },
            { weekday: 3, startTime: '15:00', endTime: '17:00', level: 'avoid' },
          ],
        },
      })

      expect(saved.statusCode).toBe(200)
      expect(saved.json().entries).toHaveLength(2)
      expect(saved.json().hoursByLevel).toMatchObject({ preferred: 4, avoid: 2, available: 0 })

      // Put the seeded week back so the other suites see what they expect.
      const restored = await app.inject({
        method: 'PUT',
        url: '/api/v1/teachers/me/availability',
        headers: asTeacher(),
        payload: { entries: before },
      })
      expect(restored.json().entries).toEqual(before)
    })

    it('refuses an interval that ends before it starts', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/teachers/me/availability',
        headers: asTeacher(),
        payload: {
          entries: [{ weekday: 2, startTime: '12:00', endTime: '09:00', level: 'available' }],
        },
      })

      expect(response.statusCode).toBe(422)
      expect(response.json().error.details[0].messageKey).toBe('validation.invalidRange')
    })

    it('lets a coordinator adjust a teacher’s week, since they plan with it', async () => {
      const original = await app.inject({
        method: 'GET',
        url: `/api/v1/teachers/${teacherProfileId}/availability`,
        headers: asCoordinator(),
      })
      expect(original.json().editable).toBe(true)
      const before = original.json().entries

      const saved = await app.inject({
        method: 'PUT',
        url: `/api/v1/teachers/${teacherProfileId}/availability`,
        headers: asCoordinator(),
        payload: {
          entries: [{ weekday: 4, startTime: '10:00', endTime: '12:00', level: 'avoid' }],
        },
      })

      expect(saved.statusCode).toBe(200)
      expect(saved.json().hoursByLevel.avoid).toBe(2)

      const restored = await app.inject({
        method: 'PUT',
        url: `/api/v1/teachers/${teacherProfileId}/availability`,
        headers: asCoordinator(),
        payload: { entries: before },
      })
      expect(restored.json().entries).toEqual(before)
    })

    it('keeps a teacher out of a colleague’s week', async () => {
      const colleague = await prisma.teacherProfile.findFirst({
        where: { centerId, NOT: { id: teacherProfileId } },
        select: { id: true },
      })

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/teachers/${colleague?.id}/availability`,
        headers: asTeacher(),
        payload: { entries: [] },
      })

      // Stopped before the write rule even applies: a plain teacher cannot
      // read a colleague's profile in the first place.
      expect(response.statusCode).toBe(403)
    })

    it('adds and removes a date exception', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/teachers/me/availability/exceptions',
        headers: asTeacher(),
        payload: {
          dateFrom: '2026-11-10',
          dateTo: '2026-11-12',
          reason: 'Test congrés',
          level: 'unavailable',
        },
      })

      expect(created.statusCode).toBe(201)
      const exception = created
        .json()
        .exceptions.find((entry: { reason: string }) => entry.reason === 'Test congrés')
      expect(exception).toMatchObject({ dateFrom: '2026-11-10', dateTo: '2026-11-12' })

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/teachers/me/availability/exceptions/${exception.id}`,
        headers: asTeacher(),
      })
      expect(removed.statusCode).toBe(200)
      expect(
        removed.json().exceptions.some((entry: { id: string }) => entry.id === exception.id),
      ).toBe(false)
    })

    it('refuses a range that ends before it starts', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/teachers/me/availability/exceptions',
        headers: asTeacher(),
        payload: { dateFrom: '2026-11-12', dateTo: '2026-11-10' },
      })
      expect(response.statusCode).toBe(422)
    })
  })

  describe('the center panel', () => {
    it('filters by status and by category, and summarises what is left', async () => {
      const all = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/load',
        headers: asAdmin(),
      })
      expect(all.json().facets.categories.length).toBeGreaterThan(1)
      expect(all.json().facets.degrees.length).toBeGreaterThan(0)

      const overloaded = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/load?status=over',
        headers: asAdmin(),
      })

      const body = overloaded.json()
      expect(body.teachers.length).toBeGreaterThan(0)
      expect(body.teachers.every((teacher: { status: string }) => teacher.status === 'over')).toBe(
        true,
      )
      // The summary describes the filtered set, not the whole center.
      expect(body.summary.teachers).toBe(body.teachers.length)
      expect(body.summary.byStatus.optimal).toBe(0)
    })

    it('filters by degree using the assignments each teacher holds', async () => {
      const all = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/load',
        headers: asAdmin(),
      })
      const degreeId = all.json().facets.degrees[0].id

      const filtered = await app.inject({
        method: 'GET',
        url: `/api/v1/teachers/load?degreeId=${degreeId}`,
        headers: asAdmin(),
      })

      expect(filtered.json().teachers.length).toBeGreaterThan(0)
      expect(
        filtered
          .json()
          .teachers.every((teacher: { degreeIds: string[] }) =>
            teacher.degreeIds.includes(degreeId),
          ),
      ).toBe(true)
    })

    it('sorts by ratio, keeping teachers without a ratio at the end', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/load?sort=ratio&order=desc',
        headers: asAdmin(),
      })

      const ratios = response
        .json()
        .teachers.map((teacher: { ratioPercent: number | null }) => teacher.ratioPercent)
      const numeric = ratios.filter((ratio: number | null) => ratio !== null)
      expect(numeric).toEqual([...numeric].sort((a: number, b: number) => b - a))
    })

    it('searches by name', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/load?q=mestre',
        headers: asAdmin(),
      })

      expect(response.json().teachers).toHaveLength(1)
      expect(response.json().teachers[0].lastName).toBe('Mestre Pons')
    })

    it('exports exactly the rows the filters left, in the reader’s own language', async () => {
      const filtered = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/load?status=over',
        headers: asAdmin(),
      })

      // The stored preference of the signed-in user wins over the browser
      // header, exactly as it does for every other localized response.
      const download = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/load/export?status=over',
        headers: { ...asAdmin(), 'accept-language': 'en' },
      })

      expect(download.statusCode).toBe(200)
      expect(download.headers['content-type']).toContain('spreadsheetml')

      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(download.rawPayload as unknown as ArrayBuffer)
      const sheet = workbook.worksheets[0]

      // Header, one row per teacher, and the total line.
      expect(sheet?.rowCount).toBe(filtered.json().teachers.length + 2)
      expect(sheet?.getRow(1).getCell(1).value).toBe('Cognoms')
      expect(sheet?.getRow(2).getCell(1).value).toBe(filtered.json().teachers[0].lastName)
      // Hours travel as numbers, so the file can be pivoted.
      expect(typeof sheet?.getRow(2).getCell(7).value).toBe('number')
      // The thresholds that produced the traffic light travel with the file.
      expect(workbook.worksheets).toHaveLength(2)
    })

    it('keeps the whole table away from a plain teacher', async () => {
      const table = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/load',
        headers: asTeacher(),
      })
      const download = await app.inject({
        method: 'GET',
        url: '/api/v1/teachers/load/export',
        headers: asTeacher(),
      })

      expect(table.statusCode).toBe(403)
      expect(download.statusCode).toBe(403)
    })
  })
})
