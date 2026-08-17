/**
 * The three catalogs are the single source of truth for user-facing text (R1):
 * the web app, the API error messages, the emails and the push notifications
 * all read from here. `test/i18n-coverage.test.ts` fails the build if a key
 * exists in one language and not in the others.
 */
import ca from './locales/ca.json' with { type: 'json' }
import en from './locales/en.json' with { type: 'json' }
import es from './locales/es.json' with { type: 'json' }

export const SUPPORTED_LOCALES = ['ca', 'es', 'en'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

/** Catalan is the institutional default; a center can override it. */
export const DEFAULT_LOCALE: AppLocale = 'ca'

export type TranslationCatalog = typeof ca

export const catalogs: Record<AppLocale, TranslationCatalog> = {
  ca,
  es: es as TranslationCatalog,
  en: en as TranslationCatalog,
}

/** Shape expected by i18next's `resources` option. */
export const i18nResources = {
  ca: { translation: catalogs.ca },
  es: { translation: catalogs.es },
  en: { translation: catalogs.en },
} as const

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * Picks the first supported locale from a list of candidates, matching on the
 * language subtag so that `es-ES` or `en-GB` resolve too.
 */
export function resolveLocale(
  candidates: readonly (string | null | undefined)[],
  fallback: AppLocale = DEFAULT_LOCALE,
): AppLocale {
  for (const candidate of candidates) {
    if (!candidate) continue
    const language = candidate.split('-')[0]?.toLowerCase()
    if (isAppLocale(language)) return language
  }
  return fallback
}

/** Parses an `Accept-Language` header into an ordered list of language tags. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return []
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const quality = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='))
        ?.slice(2)
      return { tag: (tag ?? '').trim(), quality: quality ? Number(quality) : 1 }
    })
    .filter((entry) => entry.tag.length > 0 && !Number.isNaN(entry.quality))
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.tag)
}

/**
 * Minimal catalog lookup for contexts without i18next (API errors, emails,
 * push payloads). Supports `{{placeholders}}`.
 */
export function translate(
  locale: AppLocale,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const raw = lookup(catalogs[locale], key) ?? lookup(catalogs[DEFAULT_LOCALE], key)
  if (raw === undefined) return key
  return raw.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

function lookup(catalog: TranslationCatalog, key: string): string | undefined {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined,
      catalog,
    )
  return typeof value === 'string' ? value : undefined
}
