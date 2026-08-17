/**
 * R1: this test is the build gate. A key added to one catalog and forgotten in
 * another fails CI instead of shipping a missing translation to a user.
 */
import { describe, expect, it } from 'vitest'

import { SUPPORTED_LOCALES, catalogs, resolveLocale, translate } from '../src/i18n/index.js'
import { parseAcceptLanguage } from '../src/i18n/index.js'

type Catalog = Record<string, unknown>

function flatten(node: Catalog, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return flatten(value as Catalog, path)
    }
    return [path]
  })
}

function entries(node: Catalog, prefix = ''): [string, unknown][] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return entries(value as Catalog, path)
    }
    return [[path, value] as [string, unknown]]
  })
}

const keysByLocale = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale, flatten(catalogs[locale]).sort()]),
) as Record<(typeof SUPPORTED_LOCALES)[number], string[]>

describe('i18n catalog coverage', () => {
  const reference = keysByLocale.ca

  it.each(SUPPORTED_LOCALES)('%s has exactly the same keys as the reference catalog', (locale) => {
    const missing = reference.filter((key) => !keysByLocale[locale].includes(key))
    const extra = keysByLocale[locale].filter((key) => !reference.includes(key))

    expect({ locale, missing, extra }).toEqual({ locale, missing: [], extra: [] })
  })

  it.each(SUPPORTED_LOCALES)('%s has no empty or non-string values', (locale) => {
    const invalid = entries(catalogs[locale])
      .filter(([, value]) => typeof value !== 'string' || value.trim().length === 0)
      .map(([key]) => key)

    expect(invalid).toEqual([])
  })

  it.each(SUPPORTED_LOCALES)('%s uses the same interpolation placeholders', (locale) => {
    const placeholdersOf = (catalog: Catalog, key: string): string[] => {
      const value = entries(catalog).find(([path]) => path === key)?.[1]
      return typeof value === 'string' ? [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort() : []
    }

    const mismatched = reference.filter((key) => {
      const expected = placeholdersOf(catalogs.ca, key)
      const actual = placeholdersOf(catalogs[locale], key)
      return JSON.stringify(expected) !== JSON.stringify(actual)
    })

    expect(mismatched).toEqual([])
  })
})

describe('locale resolution', () => {
  it('matches on the language subtag', () => {
    expect(resolveLocale(['es-ES'])).toBe('es')
    expect(resolveLocale(['en-GB'])).toBe('en')
    expect(resolveLocale(['ca-ES'])).toBe('ca')
  })

  it('falls back when nothing matches', () => {
    expect(resolveLocale(['de-DE', null, undefined])).toBe('ca')
    expect(resolveLocale([], 'en')).toBe('en')
  })

  it('reads Accept-Language in quality order', () => {
    expect(parseAcceptLanguage('en-GB;q=0.7, es-ES;q=0.9, de')).toEqual(['de', 'es-ES', 'en-GB'])
    expect(resolveLocale(parseAcceptLanguage('de, es-ES;q=0.9'))).toBe('es')
    expect(parseAcceptLanguage(null)).toEqual([])
  })
})

describe('catalog lookup outside i18next', () => {
  it('resolves keys and interpolates parameters', () => {
    expect(translate('es', 'errors.forbidden')).toBe('No tienes permisos para esta acción.')
    expect(translate('en', 'email.greeting', { name: 'Mar' })).toBe('Hello Mar')
    expect(translate('ca', 'push.changeRequestBody', { requester: 'Anna', subject: 'Física' })).toBe(
      'Anna proposa un canvi a Física.',
    )
  })

  it('returns the key itself when it does not exist', () => {
    expect(translate('ca', 'nope.missing')).toBe('nope.missing')
  })
})
