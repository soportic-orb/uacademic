/**
 * The handful of choices that belong to the installation rather than to a
 * center.
 *
 * Anything a center decides for itself lives in `centers.settings_json` (R9);
 * this is for what the platform decides once — today, which of the three
 * languages it offers people.
 */
import type { PrismaClient } from '@uacademic/db'
import {
  DEFAULTED_ROLES,
  type DefaultedRole,
  type MenuEntry,
  SUPPORTED_LOCALES,
  type AppLocale,
  menuDefaultsSchema,
} from '@uacademic/shared'

import { toJson } from '../lib/json.js'

const ENABLED_LOCALES = 'enabledLocales'
const MENU_DEFAULTS = 'menuDefaults'

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

/**
 * The menu each of the three center roles starts with.
 *
 * A platform decision rather than a center one: the shape of the menu is the
 * shape of the product, which is the same everywhere. It is a starting point
 * and nothing more — anybody may then arrange their own, and a person who has
 * follows their own arrangement rather than a changed default.
 *
 * An empty list for a role means "the order the product declares", which is
 * also what an installation nobody has configured has.
 */
export type MenuDefaults = Partial<Record<DefaultedRole, MenuEntry[]>>

export async function menuDefaults(client: PrismaClient): Promise<MenuDefaults> {
  const row = await client.platformSetting.findUnique({ where: { key: MENU_DEFAULTS } })
  const parsed = menuDefaultsSchema.safeParse(row?.valueJson ?? { defaults: {} })
  // A stored value we cannot read falls back to the product's own order rather
  // than leaving everybody without a menu.
  return parsed.success ? parsed.data.defaults : {}
}

export async function menuDefaultFor(client: PrismaClient, role: string): Promise<MenuEntry[]> {
  if (!(DEFAULTED_ROLES as readonly string[]).includes(role)) return []
  return (await menuDefaults(client))[role as DefaultedRole] ?? []
}

export async function setMenuDefaults(
  client: PrismaClient,
  defaults: MenuDefaults,
  updatedBy: string,
): Promise<MenuDefaults> {
  const parsed = menuDefaultsSchema.parse({ defaults })

  await client.platformSetting.upsert({
    where: { key: MENU_DEFAULTS },
    create: { key: MENU_DEFAULTS, valueJson: toJson(parsed), updatedBy },
    update: { valueJson: toJson(parsed), updatedBy },
  })

  return parsed.defaults
}
