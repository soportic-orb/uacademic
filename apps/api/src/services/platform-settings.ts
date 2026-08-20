/**
 * The handful of choices that belong to the installation rather than to a
 * center.
 *
 * Anything a center decides for itself lives in `centers.settings_json` (R9);
 * this is for what the platform decides once — today, which of the three
 * languages it offers people.
 */
import type { PrismaClient } from '@uacademic/db'
import { SUPPORTED_LOCALES, type AppLocale } from '@uacademic/shared'

import { toJson } from '../lib/json.js'

const ENABLED_LOCALES = 'enabledLocales'

/**
 * The languages on offer.
 *
 * Every catalogue always carries all three (R1) — a language is switched off
 * for the people choosing one, never for the translations, so nothing ever
 * falls back to a key. An installation that has never been asked offers them
 * all, and one whose stored list has gone empty does too: a platform nobody
 * can read is not a state worth honouring.
 */
export async function enabledLocales(client: PrismaClient): Promise<AppLocale[]> {
  const row = await client.platformSetting.findUnique({ where: { key: ENABLED_LOCALES } })
  const stored = Array.isArray(row?.valueJson) ? (row.valueJson as unknown[]) : null
  if (!stored) return [...SUPPORTED_LOCALES]

  const kept = SUPPORTED_LOCALES.filter((locale) => stored.includes(locale))
  return kept.length > 0 ? [...kept] : [...SUPPORTED_LOCALES]
}

export async function setEnabledLocales(
  client: PrismaClient,
  locales: readonly AppLocale[],
  updatedBy: string,
): Promise<AppLocale[]> {
  // Ordered as the platform orders them, not as the request happened to.
  const kept = SUPPORTED_LOCALES.filter((locale) => locales.includes(locale))

  await client.platformSetting.upsert({
    where: { key: ENABLED_LOCALES },
    create: { key: ENABLED_LOCALES, valueJson: toJson(kept), updatedBy },
    update: { valueJson: toJson(kept), updatedBy },
  })

  return [...kept]
}
