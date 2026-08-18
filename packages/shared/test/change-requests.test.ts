import { describe, expect, it } from 'vitest'

import {
  type ChangeRequestStatus,
  type ChangeTransitionRules,
  type ProposedSession,
  applyProposal,
  audienceFor,
  availableActions,
  availableActionsFor,
  evaluateChangeTransition,
  evaluateChangeTransitionAs,
  expiresAt,
  hasExpired,
  statusAfterSubmit,
  swapSlots,
} from '../src/domain/change-requests.js'

const STRICT: ChangeTransitionRules = { coordinatorApproves: true, requiresTeacherAcceptance: true }
const INFORMATIVE: ChangeTransitionRules = {
  coordinatorApproves: false,
  requiresTeacherAcceptance: true,
}

const move = (
  status: ChangeRequestStatus,
  action: Parameters<typeof evaluateChangeTransition>[0]['action'],
  actor: Parameters<typeof evaluateChangeTransition>[0]['actor'],
  rules: ChangeTransitionRules = STRICT,
) => evaluateChangeTransition({ ...rules, status, action, actor })

describe('the change-request ladder', () => {
  it('walks draft → requested → accepted → approved → applied', () => {
    expect(move('draft', 'submit', 'requester').status).toBe('requested')
    expect(move('requested', 'accept', 'target').status).toBe('accepted_by_teacher')
    expect(move('accepted_by_teacher', 'approve', 'coordinator').status).toBe(
      'approved_by_coordinator',
    )
    expect(move('approved_by_coordinator', 'apply', 'coordinator').status).toBe('applied')
  })

  it('lets the counterpart or coordination refuse, at their own step', () => {
    expect(move('requested', 'reject', 'target').status).toBe('rejected')
    expect(move('accepted_by_teacher', 'reject', 'coordinator').status).toBe('rejected')
    // A teacher cannot reject a request that is no longer theirs to answer.
    expect(move('accepted_by_teacher', 'reject', 'target')).toMatchObject({
      allowed: false,
      messageKey: 'changes.errors.notYours',
    })
  })

  it('keeps the requester able to withdraw until it is applied', () => {
    for (const status of [
      'draft',
      'requested',
      'accepted_by_teacher',
      'approved_by_coordinator',
    ] as const) {
      expect(move(status, 'cancel', 'requester').status).toBe('cancelled')
    }
    expect(move('applied', 'cancel', 'requester')).toMatchObject({
      allowed: false,
      messageKey: 'changes.errors.closed',
    })
  })

  it('skips the approval step when coordination is only informed', () => {
    expect(move('accepted_by_teacher', 'apply', 'coordinator', INFORMATIVE).status).toBe('applied')
    expect(move('accepted_by_teacher', 'approve', 'coordinator', INFORMATIVE)).toMatchObject({
      allowed: false,
      messageKey: 'changes.errors.approvalNotRequired',
    })
  })

  it('refuses to apply before approval when the center demands it', () => {
    expect(move('accepted_by_teacher', 'apply', 'coordinator', STRICT)).toMatchObject({
      allowed: false,
      messageKey: 'changes.errors.approvalRequired',
    })
  })

  it('never moves a request that is already history', () => {
    for (const status of ['applied', 'rejected', 'cancelled', 'expired'] as const) {
      expect(move(status, 'apply', 'coordinator').allowed).toBe(false)
      expect(move(status, 'accept', 'target').messageKey).toBe('changes.errors.closed')
    }
  })

  it('only the system expires a request', () => {
    expect(move('requested', 'expire', 'system').status).toBe('expired')
    expect(move('requested', 'expire', 'coordinator')).toMatchObject({
      allowed: false,
      messageKey: 'changes.errors.notYours',
    })
  })

  it('lands a submitted request where the center’s rules put it', () => {
    expect(statusAfterSubmit(STRICT)).toBe('requested')
    // Nothing to accept and nothing to approve: it is ready immediately.
    expect(
      statusAfterSubmit({ coordinatorApproves: false, requiresTeacherAcceptance: false }),
    ).toBe('applied')
    expect(statusAfterSubmit({ coordinatorApproves: true, requiresTeacherAcceptance: false })).toBe(
      'accepted_by_teacher',
    )
  })

  it('offers each actor only the buttons that would work', () => {
    expect(availableActions('requested', 'target', STRICT).sort()).toEqual(['accept', 'reject'])
    expect(availableActions('requested', 'requester', STRICT)).toEqual(['cancel'])
    expect(availableActions('accepted_by_teacher', 'coordinator', STRICT).sort()).toEqual([
      'approve',
      'reject',
    ])
    expect(availableActions('accepted_by_teacher', 'coordinator', INFORMATIVE).sort()).toEqual([
      'apply',
      'reject',
    ])
    expect(availableActions('applied', 'coordinator', STRICT)).toEqual([])
  })

  it('tells the people the step concerns, and nobody else', () => {
    expect(audienceFor('requested')).toEqual(['target', 'coordinator'])
    expect(audienceFor('accepted_by_teacher')).toEqual(['requester', 'coordinator'])
    expect(audienceFor('applied')).toEqual(['requester', 'target'])
    expect(audienceFor('draft')).toEqual([])
  })
})

describe('expiry', () => {
  const created = new Date('2026-10-01T09:00:00Z')

  it('counts from when the request was made', () => {
    expect(expiresAt({ createdAt: created, expiryHours: 72 })).toEqual(
      new Date('2026-10-04T09:00:00Z'),
    )
  })

  it('can be switched off for a center that never wants it', () => {
    expect(expiresAt({ createdAt: created, expiryHours: 0 })).toBeNull()
  })

  it('only expires what is still open', () => {
    const deadline = new Date('2026-10-04T09:00:00Z')
    expect(hasExpired({ status: 'requested', expiresAt: deadline }, deadline)).toBe(true)
    expect(
      hasExpired({ status: 'requested', expiresAt: deadline }, new Date('2026-10-03T09:00:00Z')),
    ).toBe(false)
    expect(
      hasExpired({ status: 'applied', expiresAt: deadline }, new Date('2026-11-01T09:00:00Z')),
    ).toBe(false)
    expect(hasExpired({ status: 'requested', expiresAt: null }, deadline)).toBe(false)
  })
})

describe('what a request proposes', () => {
  const session: ProposedSession = {
    id: 'session-1',
    groupId: 'g1',
    teacherProfileId: 'p1',
    spaceId: 's1',
    weekday: 1,
    startTime: '09:00',
    endTime: '11:00',
    dateFrom: new Date('2026-09-14'),
    dateTo: new Date('2026-12-18'),
    recurrence: 'weekly',
  }

  it('changes only what it mentions', () => {
    expect(applyProposal(session, { spaceId: 's2' })).toMatchObject({
      spaceId: 's2',
      weekday: 1,
      startTime: '09:00',
      teacherProfileId: 'p1',
    })
  })

  it('can free a room or leave a class unassigned', () => {
    expect(applyProposal(session, { spaceId: null }).spaceId).toBeNull()
    expect(applyProposal(session, { teacherProfileId: null }).teacherProfileId).toBeNull()
  })

  it('exchanges the slots of a swap, keeping each class its own group', () => {
    const other: ProposedSession = {
      ...session,
      id: 'session-2',
      groupId: 'g2',
      teacherProfileId: 'p2',
      weekday: 4,
      startTime: '15:00',
      endTime: '17:00',
    }

    const [first, second] = swapSlots(session, other)
    expect(first).toMatchObject({ id: 'session-1', groupId: 'g1', weekday: 4, startTime: '15:00' })
    expect(second).toMatchObject({ id: 'session-2', groupId: 'g2', weekday: 1, startTime: '09:00' })
  })
})

describe('somebody who plays more than one part', () => {
  it('lets a coordinator who filed the request also approve it', () => {
    // The audit log records who acted; refusing the step would only mean
    // asking a colleague to click the same button.
    expect(
      evaluateChangeTransitionAs({
        ...STRICT,
        status: 'accepted_by_teacher',
        action: 'approve',
        actors: ['requester', 'coordinator'],
      }),
    ).toMatchObject({ allowed: true, status: 'approved_by_coordinator' })
  })

  it('still refuses a step none of the parts may take', () => {
    expect(
      evaluateChangeTransitionAs({
        ...STRICT,
        status: 'requested',
        action: 'accept',
        actors: ['requester', 'coordinator'],
      }),
    ).toMatchObject({ allowed: false, messageKey: 'changes.errors.notYours' })
  })

  it('prefers the refusal that explains the request over "not yours"', () => {
    expect(
      evaluateChangeTransitionAs({
        ...STRICT,
        status: 'applied',
        action: 'accept',
        actors: ['requester', 'coordinator'],
      }),
    ).toMatchObject({ messageKey: 'changes.errors.closed' })
  })

  it('offers the union of what each part may do', () => {
    expect(
      availableActionsFor('accepted_by_teacher', ['requester', 'coordinator'], STRICT).sort(),
    ).toEqual(['approve', 'cancel', 'reject'])
  })
})
