import { DEFAULT_LOCALE, SUPPORTED_LOCALES, i18nResources, isAppLocale } from '@uacademic/shared'
import type { AppLocale } from '@uacademic/shared'
import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

export const LOCALE_STORAGE_KEY = 'uacademic.locale'

/**
 * R1: the catalogs come from `@uacademic/shared`, so the API, the emails and
 * this app all read the same keys. Nothing is defined here.
 */
export async function initI18n(initialLocale?: AppLocale) {
  if (i18next.isInitialized) return i18next

  await i18next
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: i18nResources,
      supportedLngs: [...SUPPORTED_LOCALES],
      fallbackLng: DEFAULT_LOCALE,
      ...(initialLocale ? { lng: initialLocale } : {}),
      detection: {
        order: ['localStorage', 'navigator', 'htmlTag'],
        lookupLocalStorage: LOCALE_STORAGE_KEY,
        caches: ['localStorage'],
      },
      interpolation: { escapeValue: false },
      returnNull: false,
    })

  syncDocumentLanguage(currentLocale())
  return i18next
}

export function currentLocale(): AppLocale {
  const language = i18next.resolvedLanguage ?? i18next.language
  return isAppLocale(language) ? language : DEFAULT_LOCALE
}

/** Hot language switching: no reload, no lost form state. */
export async function changeLocale(locale: AppLocale): Promise<void> {
  await i18next.changeLanguage(locale)
  syncDocumentLanguage(locale)
}

function syncDocumentLanguage(locale: AppLocale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

export { i18next }
