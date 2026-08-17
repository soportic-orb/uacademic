import { describe, expect, it } from 'vitest'

import {
  type Principal,
  accessibleCenterIds,
  canAccessCenter,
  canManageCenter,
  canPlanSchedule,
  canUseAiAssistant,
  hasRole,
  isSuperadmin,
  rolesInCenter,
} from '../src/domain/access.js'

const CENTER_A = '0198f0d2-8f2a-7c3e-9c1a-000000000001'
const CENTER_B = '0198f0d2-8f2a-7c3e-9c1a-000000000002'

const teacher: Principal = {
  userId: 'u-teacher',
  memberships: [{ centerId: CENTER_A, role: 'TEACHER' }],
}

const dualRole: Principal = {
  userId: 'u-dual',
  memberships: [
    { centerId: CENTER_A, role: 'COORDINATOR' },
    { centerId: CENTER_B, role: 'TEACHER' },
  ],
}

const superadmin: Principal = {
  userId: 'u-super',
  memberships: [{ centerId: CENTER_A, role: 'SUPERADMIN' }],
}

describe('roles per center', () => {
  it('keeps roles scoped to the center they were granted in', () => {
    expect(rolesInCenter(dualRole, CENTER_A)).toEqual(['COORDINATOR'])
    expect(rolesInCenter(dualRole, CENTER_B)).toEqual(['TEACHER'])
    expect(canPlanSchedule(dualRole, CENTER_A)).toBe(true)
    expect(canPlanSchedule(dualRole, CENTER_B)).toBe(false)
  })

  it('denies access to centers the user has no membership in', () => {
    expect(canAccessCenter(teacher, CENTER_A)).toBe(true)
    expect(canAccessCenter(teacher, CENTER_B)).toBe(false)
    expect(hasRole(teacher, CENTER_B, ['TEACHER'])).toBe(false)
  })

  it('lets only SUPERADMIN cross centers', () => {
    expect(isSuperadmin(superadmin)).toBe(true)
    expect(canAccessCenter(superadmin, CENTER_B)).toBe(true)
    expect(canManageCenter(superadmin, CENTER_B)).toBe(true)
    expect(isSuperadmin(dualRole)).toBe(false)
  })
})

describe('AI assistant access', () => {
  it('is limited to coordinators of that center', () => {
    expect(canUseAiAssistant(dualRole, CENTER_A)).toBe(true)
    expect(canUseAiAssistant(dualRole, CENTER_B)).toBe(false)
    expect(canUseAiAssistant(teacher, CENTER_A)).toBe(false)
    // Crossing centers does not grant the assistant: it is a coordination tool.
    expect(canUseAiAssistant(superadmin, CENTER_A)).toBe(false)
  })
})

describe('accessible centers', () => {
  it('deduplicates memberships', () => {
    expect(
      accessibleCenterIds({
        userId: 'u',
        memberships: [
          { centerId: CENTER_A, role: 'TEACHER' },
          { centerId: CENTER_A, role: 'COORDINATOR' },
          { centerId: CENTER_B, role: 'TEACHER' },
        ],
      }),
    ).toEqual([CENTER_A, CENTER_B])
  })
})
