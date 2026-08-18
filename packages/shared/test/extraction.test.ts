import { describe, expect, it } from 'vitest'

import {
  type ExtractionProposal,
  applyResolutions,
  bulkAcceptable,
  conflictGroups,
  defaultCenterSettings,
  deriveConfidence,
  diffSettings,
  isValidSettingValue,
  manuallyEditedKeys,
  paramsForMessageKey,
  paramsOfBlock,
  readSettingValue,
  reviewProposals,
  settingParam,
  summarize,
  withSettingValue,
} from '../src/index.js'

const DOCUMENT = [
  'Criteris POD 2026-2027',
  '',
  'Article 14.2. La dedicacio docent del professorat a temps complet no excedira de 240 hores lectives anuals,',
  'salvo en el caso de los cargos academicos, que se regiran por el articulo 14.3.',
  '',
  'Article 6.4. La carrega assignada no pot superar el 110 % de la carrega contractada.',
  '',
  'Article 9. La coordinacio de titulacio dona dret a una reduccio de 60 hores.',
].join('\n')

function raw(overrides: Record<string, unknown> = {}) {
  return {
    key: 'capacity.maxTeachingHoursYear',
    proposed_value: 240,
    unit: 'hours/year',
    citation: {
      page: 7,
      section: 'Art. 14.2',
      quote: 'no excedira de 240 hores lectives anuals',
    },
    reasoning: 'General limit; article 14.3 covers academic posts',
    ...overrides,
  }
}

const INPUT = {
  block: 'A' as const,
  documentId: 'doc-1',
  documentText: DOCUMENT,
  current: defaultCenterSettings,
}

describe('confidence comes from the evidence, not from the model', () => {
  it('is high when the quoted text is in the document exactly once', () => {
    expect(deriveConfidence('no excedira de 240 hores lectives anuals', DOCUMENT)).toBe('high')
  })

  it('drops to medium when the same words appear in more than one place', () => {
    const repeated = `${DOCUMENT}\n\nAnnex. La carrega assignada no pot superar el 110 % de la carrega contractada.`
    expect(deriveConfidence('no pot superar el 110 % de la carrega contractada', repeated)).toBe(
      'medium',
    )
  })

  it('is low when only the opening of the quote survives', () => {
    expect(
      deriveConfidence(
        'La coordinacio de titulacio dona dret a una reduccio de 45 hores',
        DOCUMENT,
      ),
    ).toBe('low')
  })

  it('refuses a quote that is not in the document at all', () => {
    expect(deriveConfidence('El professorat impartira 300 hores anuals', DOCUMENT)).toBeNull()
  })
})

describe('reading a block', () => {
  it('accepts a proposal that quotes the document and keeps its citation', () => {
    const result = reviewProposals([raw()], INPUT)

    expect(result.proposals).toHaveLength(1)
    const proposal = result.proposals[0] as ExtractionProposal
    expect(proposal.proposedValue).toBe(240)
    expect(proposal.confidence).toBe('high')
    expect(proposal.citation).toMatchObject({
      documentId: 'doc-1',
      page: 7,
      section: 'Art. 14.2',
    })
    expect(proposal.status).toBe('pending')
  })

  it('keeps the exception as a note instead of losing it', () => {
    const result = reviewProposals(
      [raw({ exception_note: 'salvo en el caso de los cargos academicos' })],
      INPUT,
    )

    expect(result.proposals[0]?.exceptionNote).toContain('cargos academicos')
  })

  it('marks a parameter with no textual support as not found, and proposes nothing', () => {
    const result = reviewProposals(
      [raw({ proposed_value: 250, citation: { page: 7, section: 'Art. 14.2', quote: '' } })],
      INPUT,
    )

    expect(result.proposals).toHaveLength(0)
    expect(result.notFound.map((entry) => entry.key)).toContain('capacity.maxTeachingHoursYear')
    expect(result.notFound[0]?.reasonKey).toContain('noCitation')
  })

  it('discards a citation the document does not contain — the worst failure mode', () => {
    const invented = raw({
      proposed_value: 300,
      citation: { page: 7, section: 'Art. 14.2', quote: 'no excedira de 300 hores anuals' },
    })

    const result = reviewProposals([invented], INPUT)

    expect(result.proposals).toHaveLength(0)
    expect(result.discarded).toEqual([
      { key: 'capacity.maxTeachingHoursYear', reason: 'quoteNotInDocument' },
    ])
  })

  it('discards a value the settings schema would not accept', () => {
    const result = reviewProposals([raw({ proposed_value: 'about 240' })], INPUT)

    expect(result.proposals).toHaveLength(0)
    expect(result.discarded[0]?.reason).toBe('invalidValue')
  })

  it('discards a parameter that is not in the catalogue, or belongs to another block', () => {
    const result = reviewProposals(
      [raw({ key: 'capacity.inventedParameter' }), raw({ key: 'load.maxOverloadPercent' })],
      INPUT,
    )

    expect(result.proposals).toHaveLength(0)
    expect(result.discarded.map((entry) => entry.reason).sort()).toEqual([
      'unknownKey',
      'wrongBlock',
    ])
  })

  it('reports every unanswered parameter of the block, so nothing is silently skipped', () => {
    const result = reviewProposals([raw()], INPUT)

    const expected = paramsOfBlock('A').length - 1
    expect(result.notFound).toHaveLength(expected)
    expect(
      result.notFound.every((entry) => entry.reasonKey.startsWith('settings.extraction.')),
    ).toBe(true)
  })

  it('says when a proposal only confirms what the center already has', () => {
    const result = reviewProposals([raw()], INPUT)
    // 240 is the default, so nothing changes — but the citation is new.
    expect(result.proposals[0]?.unchanged).toBe(true)
  })

  it('flags a parameter somebody edited by hand as a change, not an overwrite', () => {
    const result = reviewProposals([raw()], {
      ...INPUT,
      manualKeys: ['capacity.maxTeachingHoursYear'],
    })

    expect(result.proposals[0]?.manualOverride).toBe(true)
  })
})

describe('contradictions', () => {
  const base = reviewProposals([raw()], INPUT).proposals[0] as ExtractionProposal

  it('are shown with both citations rather than resolved', () => {
    const other: ExtractionProposal = {
      ...base,
      proposedValue: 180,
      citation: { ...base.citation, section: 'Art. 22', page: 11 },
    }

    const groups = conflictGroups([base, other])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.proposals.map((entry) => entry.proposedValue)).toEqual([240, 180])
  })

  it('keep a contradicted parameter out of "accept all high confidence"', () => {
    const other: ExtractionProposal = { ...base, proposedValue: 180 }
    expect(bulkAcceptable([base, other])).toHaveLength(0)
  })

  it('leave a hand-edited parameter out of the bulk accept as well', () => {
    expect(bulkAcceptable([{ ...base, manualOverride: true }])).toHaveLength(0)
  })

  it('only ever bulk-accept a high-confidence reading', () => {
    expect(bulkAcceptable([{ ...base, confidence: 'medium' }])).toHaveLength(0)
    expect(bulkAcceptable([base])).toHaveLength(1)
  })
})

describe('applying what a person confirmed', () => {
  it('writes the value and keeps the citation that justified it', () => {
    const result = applyResolutions(defaultCenterSettings, [
      {
        key: 'capacity.maxTeachingHoursYear',
        status: 'accepted',
        value: 250,
        citation: {
          documentId: 'doc-1',
          page: 7,
          section: 'Art. 14.2',
          quote: 'no excedira de 240 hores lectives anuals',
        },
      },
    ])

    expect(readSettingValue(result.settings, 'capacity.maxTeachingHoursYear')).toBe(250)
    expect(result.provenance).toEqual([
      {
        paramKey: 'capacity.maxTeachingHoursYear',
        documentId: 'doc-1',
        page: 7,
        section: 'Art. 14.2',
        quote: 'no excedira de 240 hores lectives anuals',
      },
    ])
    expect(result.applied).toEqual(['capacity.maxTeachingHoursYear'])
  })

  it('changes nothing for what was rejected or left pending', () => {
    const result = applyResolutions(defaultCenterSettings, [
      { key: 'capacity.creditToHours', status: 'rejected', value: 25 },
      { key: 'schedule.maxDailyHours', status: 'pending', value: 12 },
    ])

    expect(readSettingValue(result.settings, 'capacity.creditToHours')).toBe(
      readSettingValue(defaultCenterSettings, 'capacity.creditToHours'),
    )
    expect(result.rejected).toEqual(['capacity.creditToHours'])
    expect(result.pending).toEqual(['schedule.maxDailyHours'])
  })

  it('refuses an edited value the schema does not accept instead of storing it', () => {
    const result = applyResolutions(defaultCenterSettings, [
      { key: 'schedule.dayStart', status: 'edited', value: '25:00' },
    ])

    expect(result.applied).toHaveLength(0)
    expect(result.rejected).toEqual(['schedule.dayStart'])
  })

  it('accepts a whole collection, which is how categories arrive', () => {
    const result = applyResolutions(defaultCenterSettings, [
      {
        key: 'categories',
        status: 'accepted',
        value: [
          {
            code: 'associat-6-6',
            label: 'Associat 6+6',
            baseCapacityHours: 180,
            maxTeachingHours: 180,
            mapsTo: 'adjunct',
            notes: null,
          },
        ],
      },
    ])

    expect(result.settings.categories).toHaveLength(1)
    expect(result.settings.categories[0]?.label).toBe('Associat 6+6')
  })
})

describe('a new version of the regulation', () => {
  it('is reviewed as a short list of what changed, not as a whole form', () => {
    const before = defaultCenterSettings
    const after = {
      ...before,
      capacity: { ...before.capacity, maxTeachingHoursYear: 250 },
      schedule: { ...before.schedule, maxConsecutiveHours: 5 },
    }

    const changes = diffSettings(before, after)

    expect(changes).toHaveLength(2)
    expect(changes).toContainEqual({
      key: 'capacity.maxTeachingHoursYear',
      before: 240,
      after: 250,
    })
  })

  it('summarises what was applied, refused and left for a human', () => {
    const proposals = reviewProposals([raw()], INPUT)
    const summary = summarize(
      [
        { key: 'capacity.maxTeachingHoursYear', status: 'accepted', value: 240 },
        { key: 'capacity.creditToHours', status: 'rejected', value: 12 },
      ],
      proposals.notFound,
      proposals.proposals,
    )

    expect(summary.applied).toEqual(['capacity.maxTeachingHoursYear'])
    expect(summary.rejected).toEqual(['capacity.creditToHours'])
    expect(summary.pending.length).toBeGreaterThan(0)
    expect(summary.conflicts).toEqual([])
  })
})

describe('the parameter catalogue', () => {
  it('validates a value through the settings schema, so it can never drift', () => {
    expect(isValidSettingValue(defaultCenterSettings, 'schedule.dayStart', '08:30')).toBe(true)
    expect(isValidSettingValue(defaultCenterSettings, 'schedule.dayStart', '8.30')).toBe(false)
    expect(isValidSettingValue(defaultCenterSettings, 'not.a.parameter', 1)).toBe(false)
  })

  it('never mutates the settings it is given', () => {
    const next = withSettingValue(defaultCenterSettings, 'capacity.creditToHours', 25)

    expect((next as { capacity: { creditToHours: number } }).capacity.creditToHours).toBe(25)
    expect(defaultCenterSettings.capacity.creditToHours).toBe(10)
  })

  it('covers every block of the catalogue', () => {
    for (const block of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const) {
      expect(paramsOfBlock(block).length).toBeGreaterThan(0)
    }
    expect(settingParam('capacity.maxTeachingHoursYear')?.unit).toBe('hours/year')
  })

  it('notices a parameter that was set by hand and has no citation behind it', () => {
    const edited = {
      ...defaultCenterSettings,
      schedule: { ...defaultCenterSettings.schedule, maxDailyHours: 6 },
      capacity: { ...defaultCenterSettings.capacity, creditToHours: 25 },
    }

    const manual = manuallyEditedKeys(edited, defaultCenterSettings, ['capacity.creditToHours'])

    // The cited one is the regulation's; the other one is somebody's decision.
    expect(manual).toEqual(['schedule.maxDailyHours'])
  })
})

describe('the walk back from a rule that blocked somebody', () => {
  it('names the parameter behind a planner constraint', () => {
    expect(paramsForMessageKey('planner.hard.teacherCapacity')).toContain(
      'capacity.maxTeachingHoursYear',
    )
    expect(paramsForMessageKey('planner.soft.consecutiveHours')).toContain(
      'schedule.maxConsecutiveHours',
    )
  })

  it('says nothing rather than inventing a parameter for a rule that has none', () => {
    expect(paramsForMessageKey('planner.hard.teacherOverlap')).toEqual([])
    expect(paramsForMessageKey('planner.hard.unknownThing')).toEqual([])
  })
})
