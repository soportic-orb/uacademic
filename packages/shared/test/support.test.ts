/**
 * What Cady is allowed to say, and how the platform finds out what she could
 * not answer.
 */
import { describe, expect, it } from 'vitest'

import type { SupportArticleEntry } from '../src/domain/support.js'
import {
  cadySystemPrompt,
  splitCoverage,
  stripPartialMarker,
  supportCorpus,
  supportTitle,
} from '../src/domain/support.js'

const article = (overrides: Partial<SupportArticleEntry> = {}): SupportArticleEntry => ({
  slug: 'password',
  roles: ['TEACHER'],
  enabled: true,
  content: {
    ca: { title: 'Contrasenya', body: 'Demana una invitació nova.' },
    es: { title: 'Contraseña', body: 'Pide una invitación nueva.' },
    en: { title: 'Password', body: 'Ask for a fresh invitation.' },
  },
  ...overrides,
})

describe('the material Cady answers from', () => {
  it('carries the guide for the role, in the reader’s language', () => {
    const corpus = supportCorpus({ role: 'TEACHER', locale: 'ca', articles: [] })

    expect(corpus).toContain('Guia pas a pas')
    // A lecturer's guide names their availability and not the Entra tenants.
    expect(corpus).toContain('/availability')
    expect(corpus).not.toContain('/admin/entra-tenants')
  })

  it('gives each role its own guide, not everybody’s', () => {
    const admin = supportCorpus({ role: 'CENTER_ADMIN', locale: 'ca', articles: [] })

    expect(admin).toContain('/admin/subjects')
    expect(admin).not.toContain('/admin/entra-tenants')
  })

  it('adds the articles written for that role', () => {
    const corpus = supportCorpus({ role: 'TEACHER', locale: 'es', articles: [article()] })

    expect(corpus).toContain('Contraseña')
    expect(corpus).toContain('Pide una invitación nueva.')
  })

  it('leaves out an article meant for somebody else', () => {
    const corpus = supportCorpus({
      role: 'TEACHER',
      locale: 'ca',
      articles: [article({ roles: ['CENTER_ADMIN'] })],
    })

    expect(corpus).not.toContain('Contrasenya')
  })

  it('leaves out an article that has been switched off', () => {
    const corpus = supportCorpus({
      role: 'TEACHER',
      locale: 'ca',
      articles: [article({ enabled: false })],
    })

    expect(corpus).not.toContain('Contrasenya')
  })
})

describe('what Cady is told', () => {
  const prompt = (locale: 'ca' | 'es' | 'en' = 'ca') =>
    cadySystemPrompt({
      role: 'TEACHER',
      locale,
      userName: 'Marta',
      centerName: 'Facultat d’Educació',
      corpus: 'MATERIAL',
    })

  it('names her, the person and the center', () => {
    expect(prompt()).toContain('You are Cady')
    expect(prompt()).toContain('Marta')
    expect(prompt()).toContain('Facultat d’Educació')
  })

  it('pins the answer to one language, whatever the question is written in', () => {
    expect(prompt('es')).toContain('Answer in Spanish, always')
  })

  it('forbids inventing, and says what to do instead', () => {
    expect(prompt()).toContain('Do not invent')
    expect(prompt()).toContain('help material')
  })

  it('puts the whole corpus in, delimited', () => {
    expect(prompt()).toContain('--- HELP MATERIAL ---\nMATERIAL\n--- END OF HELP MATERIAL ---')
  })

  it('works for a platform administrator, who is in no center', () => {
    const platform = cadySystemPrompt({
      role: 'SUPERADMIN',
      locale: 'en',
      userName: 'Ona',
      centerName: null,
      corpus: '',
    })

    expect(platform).not.toContain('They are working in')
  })
})

describe('the coverage marker', () => {
  it('takes the marker off and reports the answer as covered', () => {
    const { text, covered } = splitCoverage('Ves a Planificació.\n[[covered]]')

    expect(text).toBe('Ves a Planificació.')
    expect(covered).toBe(true)
  })

  it('reports a question the help does not cover', () => {
    const { text, covered } = splitCoverage('No ho tinc a la meva ajuda.\n\n[[uncovered]]\n')

    expect(text).toBe('No ho tinc a la meva ajuda.')
    expect(covered).toBe(false)
  })

  it('counts a forgotten marker as covered rather than as a gap', () => {
    // A model that did not write one has not thereby reported a gap, and the
    // gap list is only useful while everything on it is really missing.
    expect(splitCoverage('Ves a Planificació.')).toEqual({
      text: 'Ves a Planificació.',
      covered: true,
    })
  })

  it('leaves a marker in the middle of the answer alone', () => {
    const { text, covered } = splitCoverage('El text [[covered]] enmig segueix.')

    expect(text).toBe('El text [[covered]] enmig segueix.')
    expect(covered).toBe(true)
  })

  it('hides half a marker while the answer is still arriving', () => {
    expect(stripPartialMarker('Ves a Planificació.\n[[cov')).toBe('Ves a Planificació.')
    expect(stripPartialMarker('Ves a Planificació.\n[[uncovered]]')).toBe('Ves a Planificació.')
    expect(stripPartialMarker('Ves a Planificació.')).toBe('Ves a Planificació.')
  })
})

describe('naming a conversation', () => {
  it('is the first line of the first question', () => {
    expect(supportTitle('Com canvio la contrasenya?\nGràcies')).toBe('Com canvio la contrasenya?')
  })

  it('cuts a long one rather than overflowing the column', () => {
    expect(supportTitle('a'.repeat(300))).toHaveLength(118)
  })

  it('falls back to her name when there is nothing to go on', () => {
    expect(supportTitle('   ')).toBe('Cady')
  })
})
