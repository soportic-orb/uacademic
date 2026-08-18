import { describe, expect, it } from 'vitest'

import {
  AI_READ_TOOLS,
  AI_TOOLS,
  AI_WRITE_TOOLS,
  type AiProposal,
  aiTool,
  budgetStatus,
  findPersonalData,
  isConfirmable,
  isWriteTool,
  minimizeForModel,
} from '../src/index.js'

function proposal(overrides: Partial<AiProposal> = {}): AiProposal {
  return {
    tool: 'move_session',
    summary: 'Move MAT1 A to Thursday',
    changes: [
      {
        entity: 'class_session',
        entityId: 'session-1',
        label: 'MAT1 A',
        before: { weekday: 2 },
        after: { weekday: 4 },
      },
    ],
    violations: [],
    warnings: [],
    ...overrides,
  }
}

describe('the tool catalog', () => {
  it('separates what may run from what may only propose', () => {
    expect(AI_READ_TOOLS.map((tool) => tool.name)).toEqual([
      'get_teacher_workload',
      'get_teacher_availability',
      'get_subject_schedule',
      'list_conflicts',
      'get_space_occupancy',
      'get_change_history',
      'find_eligible_substitutes',
    ])
    expect(AI_WRITE_TOOLS.map((tool) => tool.name)).toEqual([
      'propose_schedule',
      'assign_teacher_to_group',
      'move_session',
      'rebalance_workload',
      'draft_announcement',
    ])
  })

  it('says of every write tool that it only proposes', () => {
    for (const tool of AI_WRITE_TOOLS) {
      expect(tool.description.toLowerCase()).toMatch(/proposal|propose/)
      expect(isWriteTool(tool.name)).toBe(true)
    }
    for (const tool of AI_READ_TOOLS) expect(isWriteTool(tool.name)).toBe(false)
  })

  it('gives every tool a schema and a label the UI can show', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.labelKey).toBe(`assistant.tools.${tool.name}`)
      expect(tool.schema.safeParse({}).success || tool.kind === 'write').toBe(true)
    }
    expect(aiTool('nope')).toBeUndefined()
  })
})

describe('a proposal', () => {
  it('can be confirmed when it changes something and breaks nothing', () => {
    expect(isConfirmable(proposal())).toBe(true)
  })

  it('cannot be confirmed while a hard constraint says no', () => {
    expect(
      isConfirmable(
        proposal({
          violations: [{ messageKey: 'planner.hard.teacherOverlap', params: { name: 'Marta' } }],
        }),
      ),
    ).toBe(false)
  })

  it('cannot be confirmed when there is nothing to apply', () => {
    expect(isConfirmable(proposal({ changes: [] }))).toBe(false)
  })
})

describe('the token budget', () => {
  it('warns before it runs out, not after', () => {
    expect(budgetStatus(700_000, 1_000_000).level).toBe('ok')
    expect(budgetStatus(800_000, 1_000_000).level).toBe('warning')
    expect(budgetStatus(999_999, 1_000_000).level).toBe('warning')
    expect(budgetStatus(1_000_000, 1_000_000).level).toBe('exceeded')
  })

  it('honours a center’s own threshold', () => {
    expect(budgetStatus(600_000, 1_000_000, 50).level).toBe('warning')
    expect(budgetStatus(600_000, 1_000_000, 90).level).toBe('ok')
  })

  it('treats no budget as no ceiling', () => {
    expect(budgetStatus(5_000_000, 0)).toEqual({
      usedTokens: 5_000_000,
      budgetTokens: 0,
      percent: 0,
      level: 'ok',
    })
  })

  it('reports the percentage the UI shows', () => {
    expect(budgetStatus(432_100, 1_000_000).percent).toBe(43.2)
  })
})

describe('what may reach the model', () => {
  const teacher = {
    teacherProfileId: 'profile-1',
    name: 'Marta Puig',
    contractedHours: 240,
    dni: '12345678Z',
    phone: '+34600000000',
    address: 'Carrer Gran 1',
    email: 'marta@example.edu',
    medicalReason: 'baixa mèdica',
    nested: [{ iban: 'ES00', groupCode: 'A' }],
  }

  it('keeps names, identifiers and hours', () => {
    const minimized = minimizeForModel(teacher) as Record<string, unknown>

    expect(minimized.teacherProfileId).toBe('profile-1')
    expect(minimized.name).toBe('Marta Puig')
    expect(minimized.contractedHours).toBe(240)
  })

  it('drops identity documents, contact details and anything medical', () => {
    const minimized = minimizeForModel(teacher) as Record<string, unknown>

    expect(minimized.dni).toBeUndefined()
    expect(minimized.phone).toBeUndefined()
    expect(minimized.address).toBeUndefined()
    expect(minimized.medicalReason).toBeUndefined()
    expect(findPersonalData(minimized)).toEqual([])
  })

  it('reaches inside arrays and nested objects', () => {
    const minimized = minimizeForModel(teacher) as { nested: Record<string, unknown>[] }

    expect(minimized.nested[0]?.iban).toBeUndefined()
    expect(minimized.nested[0]?.groupCode).toBe('A')
  })

  it('never lets a secret through under any spelling', () => {
    const payload = { access_token: 'x', refreshTokenEnc: 'y', totpSecret: 'z', PasswordHash: 'w' }

    expect(findPersonalData(payload)).toHaveLength(4)
    expect(minimizeForModel(payload)).toEqual({})
  })

  it('names where it found something, so a test can point at it', () => {
    expect(findPersonalData({ teachers: [{ name: 'A', phone: '600' }] })).toEqual([
      'teachers[0].phone',
    ])
  })
})
