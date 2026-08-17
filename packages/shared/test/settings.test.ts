import { describe, expect, it } from 'vitest'

import { computeTeacherLoad, loadStatusFromRatio } from '../src/domain/capacity.js'
import {
  SETTING_PARAM_KEYS,
  centerSettingsSchema,
  defaultCenterSettings,
  flattenSettings,
  getSettingValue,
  isSettingParamKey,
  parseCenterSettings,
  settingProvenanceSchema,
} from '../src/domain/settings.js'

describe('center settings', () => {
  it('produces a complete object from an empty configuration', () => {
    const settings = parseCenterSettings({})
    expect(settings.load.thresholds).toEqual({ underBelow: 85, optimalUpTo: 100, limitUpTo: 110 })
    expect(settings.schedule.dayStart).toBe('08:00')
    expect(settings.schedule.workingWeekdays).toEqual([1, 2, 3, 4, 5])
    expect(settings.formats.firstDayOfWeek).toBe(1)
  })

  it('parses null (a center that was never configured)', () => {
    expect(parseCenterSettings(null)).toEqual(defaultCenterSettings)
  })

  it('keeps stored values and fills only what is missing', () => {
    const settings = parseCenterSettings({
      load: { thresholds: { underBelow: 70 } },
      schedule: { dayEnd: '22:00' },
    })
    expect(settings.load.thresholds.underBelow).toBe(70)
    expect(settings.load.thresholds.optimalUpTo).toBe(100)
    expect(settings.schedule.dayEnd).toBe('22:00')
    expect(settings.schedule.dayStart).toBe('08:00')
  })

  it('rejects invalid values instead of silently defaulting', () => {
    expect(centerSettingsSchema.safeParse({ schedule: { dayStart: '8:00' } }).success).toBe(false)
    expect(centerSettingsSchema.safeParse({ schedule: { slotMinutes: 4 } }).success).toBe(false)
    expect(centerSettingsSchema.safeParse({ schedule: { workingWeekdays: [] } }).success).toBe(
      false,
    )
    expect(centerSettingsSchema.safeParse({ formats: { timeFormat: '48h' } }).success).toBe(false)
  })

  it('drives the traffic light from configuration, not from constants', () => {
    const settings = parseCenterSettings({ load: { thresholds: { underBelow: 50 } } })
    expect(loadStatusFromRatio(60, settings.load.thresholds)).toBe('optimal')

    const load = computeTeacherLoad(
      { contractedHours: 100, assignments: [{ concept: 'lecture', hours: 60 }] },
      settings.load.thresholds,
    )
    expect(load.status).toBe('optimal')
  })
})

describe('parameter keys and provenance', () => {
  it('exposes every parameter as a dot path', () => {
    expect(SETTING_PARAM_KEYS).toContain('load.thresholds.underBelow')
    expect(SETTING_PARAM_KEYS).toContain('schedule.maxConsecutiveHours')
    expect(SETTING_PARAM_KEYS).toContain('engine.weights.avoidSlot')
    expect(SETTING_PARAM_KEYS).toContain('schedule.teachingWeeks')
    expect(SETTING_PARAM_KEYS).toContain('workflow.coordinatorApprovesChanges')
  })

  it('derives the key list from the schema, so it cannot drift', () => {
    expect([...SETTING_PARAM_KEYS].sort()).toEqual(
      Object.keys(flattenSettings(defaultCenterSettings)).sort(),
    )
    expect(isSettingParamKey('load.thresholds.limitUpTo')).toBe(true)
    expect(isSettingParamKey('load.thresholds.invented')).toBe(false)
  })

  it('reads a single parameter by key', () => {
    expect(getSettingValue(defaultCenterSettings, 'schedule.slotMinutes')).toBe(30)
    expect(getSettingValue(defaultCenterSettings, 'schedule.workingWeekdays')).toEqual([
      1, 2, 3, 4, 5,
    ])
    expect(getSettingValue(defaultCenterSettings, 'nope')).toBeUndefined()
  })

  it('validates a provenance record with its citation', () => {
    const provenance = settingProvenanceSchema.parse({
      paramKey: 'schedule.maxConsecutiveHours',
      documentId: '0198f0d2-8f2a-7c3e-9c1a-6b0e6d2f4a11',
      page: 12,
      section: 'Article 8.2',
      quote: 'No more than four consecutive teaching hours may be scheduled.',
    })
    expect(provenance.paramKey).toBe('schedule.maxConsecutiveHours')
    expect(settingProvenanceSchema.parse({ paramKey: 'x' }).documentId).toBeNull()
  })
})
