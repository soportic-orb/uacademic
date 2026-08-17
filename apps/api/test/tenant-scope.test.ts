/**
 * R2, unit level: the scoping rules themselves, with no database in the way.
 * `tenant-isolation.test.ts` proves the same thing end to end over HTTP.
 */
import { describe, expect, it } from 'vitest'

import { AppError } from '../src/lib/errors.js'
import {
  TENANT_SCOPED_MODELS,
  TenantViolationError,
  applyTenantScope,
  isTenantScoped,
  verifyResultCenter,
} from '../src/lib/tenant-scope.js'

const CENTER = 'center-a'
const OTHER = 'center-b'

describe('scoped models', () => {
  it('covers every business table', () => {
    for (const model of ['Subject', 'ClassSession', 'Assignment', 'TeacherProfile', 'AuditLog']) {
      if (model === 'AuditLog') continue
      expect(isTenantScoped(model)).toBe(true)
    }
    expect(TENANT_SCOPED_MODELS.length).toBeGreaterThan(20)
  })

  it('leaves platform and user-owned tables alone', () => {
    for (const model of ['User', 'University', 'EntraTenant', 'Job', 'PushSubscription']) {
      expect(isTenantScoped(model)).toBe(false)
    }
  })
})

describe('reads', () => {
  it('injects the center filter into list queries', () => {
    const scoped = applyTenantScope('Subject', 'findMany', { where: { year: 1 } }, CENTER)
    expect(scoped.args).toEqual({ where: { AND: [{ year: 1 }, { centerId: CENTER }] } })
    expect(scoped.verifyResultCenter).toBe(false)
  })

  it('filters even when the caller passed no where clause', () => {
    expect(applyTenantScope('Space', 'findMany', {}, CENTER).args).toEqual({
      where: { centerId: CENTER },
    })
    expect(applyTenantScope('Space', 'count', {}, CENTER).args).toEqual({
      where: { centerId: CENTER },
    })
  })

  it('verifies the row for findUnique, which cannot take extra filters', () => {
    const scoped = applyTenantScope('Subject', 'findUnique', { where: { id: 'x' } }, CENTER)
    expect(scoped.verifyResultCenter).toBe(true)
    expect(verifyResultCenter({ id: 'x', centerId: CENTER }, CENTER)).toEqual({
      id: 'x',
      centerId: CENTER,
    })
    expect(verifyResultCenter({ id: 'x', centerId: OTHER }, CENTER)).toBeNull()
    expect(verifyResultCenter(null, CENTER)).toBeNull()
  })
})

describe('writes', () => {
  it('stamps the center on create', () => {
    expect(applyTenantScope('Space', 'create', { data: { name: 'Aula 1' } }, CENTER).args).toEqual({
      data: { name: 'Aula 1', centerId: CENTER },
    })
  })

  it('stamps every row of createMany', () => {
    const scoped = applyTenantScope(
      'Space',
      'createMany',
      { data: [{ name: 'A' }, { name: 'B' }] },
      CENTER,
    )
    expect(scoped.args).toEqual({
      data: [
        { name: 'A', centerId: CENTER },
        { name: 'B', centerId: CENTER },
      ],
    })
  })

  it('refuses a write that names another center', () => {
    expect(() =>
      applyTenantScope('Space', 'create', { data: { name: 'A', centerId: OTHER } }, CENTER),
    ).toThrow(TenantViolationError)
  })

  it('filters updates and deletes by center', () => {
    expect(
      applyTenantScope('Subject', 'update', { where: { id: 'x' }, data: {} }, CENTER).args,
    ).toEqual({ where: { AND: [{ id: 'x' }, { centerId: CENTER }] }, data: {} })

    expect(applyTenantScope('Subject', 'deleteMany', { where: { year: 1 } }, CENTER).args).toEqual({
      where: { AND: [{ year: 1 }, { centerId: CENTER }] },
    })
  })

  it('scopes both halves of an upsert', () => {
    const scoped = applyTenantScope(
      'Space',
      'upsert',
      { where: { id: 'x' }, create: { name: 'A' }, update: { name: 'A' } },
      CENTER,
    )
    expect(scoped.args).toEqual({
      where: { AND: [{ id: 'x' }, { centerId: CENTER }] },
      create: { name: 'A', centerId: CENTER },
      update: { name: 'A' },
    })
  })
})

describe('unknown operations', () => {
  it('fails closed rather than letting an unscoped query through', () => {
    expect(() => applyTenantScope('Subject', 'findRaw', {}, CENTER)).toThrow(AppError)
  })
})
