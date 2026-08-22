/**
 * Cady's base knowledge, and knowing which screen somebody is standing on.
 *
 * The knowledge itself is prose and cannot be asserted sentence by sentence.
 * What can be asserted is that it stays true to the product: every screen the
 * router serves is described, every description is reachable by the roles that
 * can open it, and a path resolves to the screen a person is actually on
 * rather than to whichever pattern happened to match first.
 */
import { describe, expect, it } from 'vitest'

import {
  PLATFORM_KNOWLEDGE,
  SCREEN_KNOWLEDGE,
  platformKnowledge,
  screenFor,
} from '../src/domain/support-knowledge.js'

describe('which screen somebody is on', () => {
  it('finds one by its exact path', () => {
    expect(screenFor('/planning')?.title).toBe('Planning')
    expect(screenFor('/')?.title).toBe('Dashboard')
  })

  it('reads through a variable segment', () => {
    expect(screenFor('/teachers/0198f0d2-8f2a-7000-8000-00000000000a')?.path).toBe('/teachers/:id')
    expect(screenFor('/teachers/me')?.path).toBe('/teachers/:id')
  })

  it('prefers the specific screen over the pattern that also matches', () => {
    // `/admin/:resourceKey` would match this too, and answering with the
    // generic administration screen would describe the wrong thing.
    expect(screenFor('/admin/users')?.title).toBe('Users')
    expect(screenFor('/admin/academic-years')?.title).toBe('Academic years')
  })

  it('falls back to the section a screen it does not know lives under', () => {
    // Better than nothing: the person is somewhere in administration.
    expect(screenFor('/admin/something-new')?.path).toBe('/admin')
  })

  it('ignores a query string and a trailing slash', () => {
    expect(screenFor('/planning?version=3')?.title).toBe('Planning')
    expect(screenFor('/planning/')?.title).toBe('Planning')
  })

  it('has nothing to say when there is no path', () => {
    expect(screenFor(null)).toBeNull()
    expect(screenFor('')).toBeNull()
    expect(screenFor('/nowhere-at-all')).toBeNull()
  })
})

describe('the knowledge itself', () => {
  it('describes every screen with something worth reading', () => {
    for (const screen of SCREEN_KNOWLEDGE) {
      expect(screen.title.length, screen.path).toBeGreaterThan(2)
      expect(screen.body.length, screen.path).toBeGreaterThan(60)
      expect(screen.roles.length, screen.path).toBeGreaterThan(0)
    }
  })

  it('names every screen exactly once', () => {
    const paths = SCREEN_KNOWLEDGE.map((screen) => screen.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('gives a lecturer their own screens and not the administration’s', () => {
    const lecturer = platformKnowledge('TEACHER')

    expect(lecturer).toContain('/my-load')
    expect(lecturer).toContain('/connections')
    expect(lecturer).not.toContain('/admin/academic-years')
    expect(lecturer).not.toContain('/platform')
  })

  it('gives a platform administrator what only they can reach', () => {
    const platform = platformKnowledge('SUPERADMIN')

    expect(platform).toContain('/admin/entra-tenants')
    expect(platform).toContain('AADSTS500011')
  })

  it('tells every role what Cady cannot do, because they all ask', () => {
    for (const role of ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER'] as const) {
      expect(platformKnowledge(role), role).toContain('cannot see this center')
    }
  })

  it('explains the order the setup has to happen in', () => {
    // The single most common support question is a screen that is empty
    // because a step further up has not happened.
    const section = PLATFORM_KNOWLEDGE.find((entry) => entry.id === 'setup-order')

    expect(section).toBeDefined()
    expect(section!.body).toContain('academic year')
  })
})
