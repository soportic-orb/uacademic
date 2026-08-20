import { describe, expect, it } from 'vitest'

import { ROLES } from '../src/domain/access.js'
import { GUIDE_STEPS, guideFor } from '../src/domain/guide.js'
import { translate } from '../src/i18n/index.js'
import { SUPPORTED_LOCALES } from '../src/i18n/index.js'

/**
 * The guide is the answer to "I have signed in and I do not know what to do
 * first". A step whose text is missing, or a role with no guide at all, is
 * worse than no guide: it is a promise of help that is not there.
 */
describe('the getting-started guide', () => {
  it('has something to say to every role', () => {
    for (const role of ROLES) {
      expect(guideFor(role).length, `${role} has no guide`).toBeGreaterThan(3)
    }
  })

  it('is written in all three languages, title and body (R1)', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const step of GUIDE_STEPS) {
        // A title is a few words; a body has to actually explain something.
        // Both must exist, and a key echoed back is what a missing one looks
        // like.
        for (const [part, minimum] of [
          ['title', 8],
          ['body', 60],
        ] as const) {
          const key = `guide.steps.${step.key}.${part}`
          const text = translate(locale, key)
          expect(text, `${key} missing in ${locale}`).not.toBe(key)
          expect(text.length, `${key} is too short to be useful`).toBeGreaterThan(minimum)
        }
      }
    }
  })

  it('names each step once, so two roles read the same words about it', () => {
    const keys = GUIDE_STEPS.map((step) => step.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('puts the account before the work, for everybody', () => {
    for (const role of ROLES) {
      expect(guideFor(role)[0]?.key).toBe('profile')
    }
  })

  it('keeps the platform order: a year before the subjects that need one', () => {
    const admin = guideFor('CENTER_ADMIN').map((step) => step.key)

    expect(admin.indexOf('academicYear')).toBeLessThan(admin.indexOf('subjects'))
    expect(admin.indexOf('subjects')).toBeLessThan(admin.indexOf('groups'))
    // Contracts before anybody is asked to plan around them.
    expect(admin.indexOf('people')).toBeLessThan(admin.indexOf('staff'))
  })

  it('sends a coordinator to a version before asking them to place anything', () => {
    const coordinator = guideFor('COORDINATOR').map((step) => step.key)

    expect(coordinator.indexOf('version')).toBeLessThan(coordinator.indexOf('place'))
    expect(coordinator.indexOf('place')).toBeLessThan(coordinator.indexOf('publish'))
  })
})
