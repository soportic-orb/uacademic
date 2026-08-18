import { describe, expect, it } from 'vitest'

import {
  type Citation,
  type DocumentRef,
  byPrecedence,
  canReadDocument,
  canUploadDocument,
  checkUpload,
  chunkPages,
  citationHref,
  cosineSimilarity,
  estimateTokens,
  expiresWithin,
  formatCitation,
  isExpired,
  isInForce,
  precedenceNotes,
  reciprocalRankFusion,
  selectRelevant,
  shouldInjectFully,
  sniffMime,
} from '../src/index.js'

function doc(overrides: Partial<DocumentRef> = {}): DocumentRef {
  return {
    id: 'doc-1',
    title: 'Normativa POD',
    scope: 'center',
    scopeId: null,
    type: 'regulation',
    academicYearId: null,
    validFrom: null,
    validTo: null,
    ...overrides,
  }
}

describe('precedence', () => {
  it('lets the most specific scope speak loudest', () => {
    const ordered = byPrecedence([
      doc({ id: 'university', scope: 'university' }),
      doc({ id: 'subject', scope: 'subject' }),
      doc({ id: 'center', scope: 'center' }),
      doc({ id: 'degree', scope: 'degree' }),
    ])

    expect(ordered.map((entry) => entry.id)).toEqual(['subject', 'degree', 'center', 'university'])
  })

  it('prefers the most recent among equals', () => {
    const ordered = byPrecedence([
      doc({ id: 'old', validFrom: new Date('2024-09-01') }),
      doc({ id: 'new', validFrom: new Date('2026-09-01') }),
    ])

    expect(ordered[0]?.id).toBe('new')
  })

  it('says a contradiction out loud instead of resolving it quietly', () => {
    const notes = precedenceNotes([
      doc({ id: 'center', scope: 'center', title: 'Criteris del centre' }),
      doc({ id: 'subject', scope: 'subject', title: 'Guia docent' }),
    ])

    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      winnerId: 'subject',
      loserId: 'center',
      messageKey: 'documents.precedence.moreSpecific',
    })
    expect(notes[0]?.params).toMatchObject({ winner: 'Guia docent', loser: 'Criteris del centre' })
  })
})

describe('validity', () => {
  const plan = doc({
    validFrom: new Date('2024-09-01'),
    validTo: new Date('2025-08-31'),
  })

  it('keeps a 2024-25 plan out of a 2026-27 decision', () => {
    expect(isInForce(plan, new Date('2025-01-15'))).toBe(true)
    expect(isInForce(plan, new Date('2026-11-02'))).toBe(false)
    expect(isExpired(plan, new Date('2026-11-02'))).toBe(true)
  })

  it('does not call next year’s regulation expired just because it has not started', () => {
    const next = doc({ validFrom: new Date('2026-09-01'), validTo: new Date('2027-08-31') })

    // Filed in August, in force in September.
    expect(isInForce(next, new Date('2026-08-18'))).toBe(false)
    expect(isExpired(next, new Date('2026-08-18'))).toBe(false)
  })

  it('treats an open end date as still in force', () => {
    const framework = doc({ validFrom: new Date('2020-01-01'), validTo: null })

    expect(isInForce(framework, new Date('2030-01-01'))).toBe(true)
    expect(isExpired(framework, new Date('2030-01-01'))).toBe(false)
  })

  it('warns before something runs out, not after', () => {
    expect(expiresWithin(plan, 45, new Date('2025-08-01'))).toBe(true)
    expect(expiresWithin(plan, 45, new Date('2025-01-01'))).toBe(false)
    // Already expired is not "about to expire": it is a different warning.
    expect(expiresWithin(plan, 45, new Date('2025-09-15'))).toBe(false)
  })

  it('drops what is out of force and what belongs to another year', () => {
    const selected = selectRelevant(
      [
        doc({ id: 'current', academicYearId: 'year-2026' }),
        doc({ id: 'other-year', academicYearId: 'year-2024' }),
        doc({ id: 'expired', validTo: new Date('2024-01-01') }),
        doc({ id: 'any-year', academicYearId: null }),
      ],
      { academicYearId: 'year-2026', onDate: new Date('2026-10-01') },
    )

    expect(selected.map((entry) => entry.id).sort()).toEqual(['any-year', 'current'])
  })

  it('keeps a subject document out of another subject’s answer', () => {
    const selected = selectRelevant(
      [
        doc({ id: 'mine', scope: 'subject', scopeId: 'subject-1' }),
        doc({ id: 'theirs', scope: 'subject', scopeId: 'subject-2' }),
        doc({ id: 'center-wide', scope: 'center', scopeId: null }),
      ],
      { scopeIds: ['subject-1'] },
    )

    expect(selected.map((entry) => entry.id)).toEqual(['mine', 'center-wide'])
  })
})

describe('chunking', () => {
  const pages = [
    {
      page: 1,
      text: [
        '# Normativa POD',
        '',
        'Aquest document regula la dedicacio docent.',
        '',
        '## 1. Dedicacio',
        '',
        'El professorat a temps complet imparteix 240 hores.',
      ].join('\n'),
    },
    {
      page: 2,
      text: ['## 2. Reduccions', '', 'La coordinacio de titulacio dona dret a 60 hores.'].join(
        '\n',
      ),
    },
  ]

  it('keeps a section with its own heading', () => {
    const chunks = chunkPages(pages, { maxTokens: 60, overlapTokens: 5 })

    expect(chunks.length).toBeGreaterThan(1)
    const reductions = chunks.find((chunk) => chunk.content.includes('60 hores'))
    expect(reductions?.headingPath).toContain('2. Reduccions')
  })

  it('records the pages a fragment came from, so it can be cited', () => {
    const chunks = chunkPages(pages, { maxTokens: 60 })

    for (const chunk of chunks) {
      expect(chunk.pageFrom).not.toBeNull()
      expect(chunk.pageTo).toBeGreaterThanOrEqual(chunk.pageFrom as number)
    }
    expect(chunks.some((chunk) => chunk.pageFrom === 2)).toBe(true)
  })

  it('never loses the text: every line survives somewhere', () => {
    const chunks = chunkPages(pages, { maxTokens: 40, overlapTokens: 8 })
    const joined = chunks.map((chunk) => chunk.content).join('\n')

    expect(joined).toContain('240 hores')
    expect(joined).toContain('60 hores')
    expect(joined).toContain('Aquest document regula')
  })

  it('numbers its output in order', () => {
    const chunks = chunkPages(pages, { maxTokens: 30 })
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index))
  })

  it('returns nothing for an empty document rather than an empty chunk', () => {
    expect(chunkPages([{ page: 1, text: '   \n\n  ' }])).toEqual([])
  })

  it('estimates tokens closely enough to budget with', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100)
    expect(estimateTokens('   ')).toBe(0)
  })
})

describe('hybrid search', () => {
  it('fuses two orders that do not share a scale', () => {
    const semantic = [
      { chunkId: 'a', score: 0.91 },
      { chunkId: 'b', score: 0.88 },
      { chunkId: 'c', score: 0.4 },
    ]
    const fullText = [
      { chunkId: 'c', score: 1 },
      { chunkId: 'd', score: 0.5 },
    ]

    const fused = reciprocalRankFusion([semantic, fullText], { limit: 3 })

    // `c` is mid-table for the vectors and top for the exact terms, which is
    // exactly the case hybrid search exists for.
    expect(fused[0]?.chunkId).toBe('c')
    expect(fused.map((entry) => entry.chunkId)).toContain('a')
  })

  it('is unmoved by one half returning nothing', () => {
    const fused = reciprocalRankFusion([[{ chunkId: 'a', score: 1 }], []])
    expect(fused).toEqual([{ chunkId: 'a', score: 1 / 61 }])
  })

  it('measures similarity, and refuses to compare different shapes', () => {
    const a = Float32Array.from([1, 0, 0])
    const b = Float32Array.from([1, 0, 0])
    const c = Float32Array.from([0, 1, 0])

    expect(cosineSimilarity(a, b)).toBeCloseTo(1)
    expect(cosineSimilarity(a, c)).toBeCloseTo(0)
    expect(cosineSimilarity(a, Float32Array.from([1, 0]))).toBe(0)
  })

  it('injects whole documents until they stop fitting', () => {
    expect(shouldInjectFully(40_000)).toBe(true)
    expect(shouldInjectFully(150_000)).toBe(true)
    expect(shouldInjectFully(150_001)).toBe(false)
    expect(shouldInjectFully(40_000, 20_000)).toBe(false)
  })
})

describe('citations', () => {
  const citation: Citation = {
    documentId: 'doc-1',
    title: 'Normativa POD 2026',
    page: 14,
    section: null,
    chunkId: 'chunk-9',
  }

  it('reads as a person would write it', () => {
    expect(formatCitation(citation)).toBe('Normativa POD 2026, p. 14')
    expect(formatCitation({ ...citation, page: null, section: '3.2 Avaluacio' })).toBe(
      'Normativa POD 2026, 3.2 Avaluacio',
    )
    expect(formatCitation({ ...citation, page: null, section: null })).toBe('Normativa POD 2026')
  })

  it('opens the viewer at the fragment it rests on', () => {
    expect(citationHref(citation)).toBe('/documents?doc=doc-1&page=14&chunk=chunk-9')
    expect(citationHref({ ...citation, page: null, chunkId: null })).toBe('/documents?doc=doc-1')
  })
})

describe('what a file actually is', () => {
  const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
  const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
  const text = new TextEncoder().encode('# Normativa\n\nArticle 14. Dedicacio.')

  it('reads the first bytes, not the extension', () => {
    expect(sniffMime(pdf).mime).toBe('application/pdf')
    expect(sniffMime(zip).mime).toBe('application/zip')
    expect(sniffMime(text).mime).toBe('text/plain')
  })

  it('refuses a file whose content is not what it claims', () => {
    const check = checkUpload({
      declaredMime: 'application/pdf',
      sniffed: sniffMime(zip),
      sizeBytes: 1_000,
      maxBytes: 10_000,
      usedBytes: 0,
      quotaBytes: 100_000,
    })

    expect(check).toEqual({ ok: false, rejection: 'mismatchedType' })
  })

  it('checks the type, then the size, then the quota, then the duplicate', () => {
    const base = {
      declaredMime: 'application/pdf',
      sniffed: sniffMime(pdf),
      sizeBytes: 1_000,
      maxBytes: 10_000,
      usedBytes: 0,
      quotaBytes: 100_000,
    }

    expect(checkUpload(base).ok).toBe(true)
    expect(checkUpload({ ...base, declaredMime: 'application/x-msdownload' }).rejection).toBe(
      'unsupportedType',
    )
    expect(checkUpload({ ...base, sizeBytes: 20_000 }).rejection).toBe('tooLarge')
    expect(checkUpload({ ...base, usedBytes: 99_999 }).rejection).toBe('quotaExceeded')
    expect(checkUpload({ ...base, checksum: 'abc', existingChecksums: ['abc'] }).rejection).toBe(
      'duplicate',
    )
  })

  it('accepts the office formats by what a zip really is', () => {
    expect(
      checkUpload({
        declaredMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sniffed: sniffMime(zip),
        sizeBytes: 100,
        maxBytes: 10_000,
        usedBytes: 0,
        quotaBytes: 100_000,
      }).ok,
    ).toBe(true)
  })
})

describe('who may upload what', () => {
  it('reserves the framework for the platform', () => {
    expect(canUploadDocument({ scope: 'university', roles: ['SUPERADMIN'] })).toBe(true)
    expect(canUploadDocument({ scope: 'university', roles: ['CENTER_ADMIN'] })).toBe(false)
  })

  it('gives the center and the degree to its administration', () => {
    expect(canUploadDocument({ scope: 'center', roles: ['CENTER_ADMIN'] })).toBe(true)
    expect(canUploadDocument({ scope: 'degree', roles: ['CENTER_ADMIN'] })).toBe(true)
    expect(canUploadDocument({ scope: 'center', roles: ['COORDINATOR'] })).toBe(false)
  })

  it('gives a subject only to whoever coordinates that subject', () => {
    expect(
      canUploadDocument({
        scope: 'subject',
        roles: ['COORDINATOR'],
        coordinatedSubjectIds: ['subject-1'],
        scopeId: 'subject-1',
      }),
    ).toBe(true)

    expect(
      canUploadDocument({
        scope: 'subject',
        roles: ['COORDINATOR'],
        coordinatedSubjectIds: ['subject-1'],
        scopeId: 'subject-2',
      }),
    ).toBe(false)

    expect(canUploadDocument({ scope: 'subject', roles: ['TEACHER'], scopeId: 'subject-1' })).toBe(
      false,
    )
  })

  it('keeps an assistant-only document out of the repository', () => {
    expect(canReadDocument({ audience: 'ai_only', roles: ['TEACHER'] })).toBe(false)
    expect(canReadDocument({ audience: 'ai_only', roles: ['COORDINATOR'] })).toBe(true)
    expect(canReadDocument({ audience: 'center', roles: ['TEACHER'] })).toBe(true)
  })
})
