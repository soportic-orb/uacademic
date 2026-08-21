/**
 * Whether Cady is on, and what she is allowed to spend.
 *
 * A platform choice rather than a center one (R9 draws the line at "anything a
 * center decides for itself"): the support assistant is about how the product
 * works, which is the same product everywhere, and the API key that pays for
 * her belongs to the installation.
 */
import type { PrismaClient } from '@uacademic/db'
import { z } from 'zod'

import { toJson } from '../lib/json.js'

const KEY = 'support'

export const supportSettingsSchema = z.object({
  /** Off until somebody turns it on: it costs money per question. */
  enabled: z.boolean().default(false),
  /** Ceiling for one answer. Support answers are short by design. */
  maxOutputTokens: z.number().int().min(256).max(8_000).default(1_200),
  /** How much of the conversation is replayed, so a follow-up means something. */
  historyMessages: z.number().int().min(0).max(40).default(12),
})

export type SupportSettings = z.infer<typeof supportSettingsSchema>

export async function supportSettings(client: PrismaClient): Promise<SupportSettings> {
  const row = await client.platformSetting.findUnique({ where: { key: KEY } })
  const parsed = supportSettingsSchema.safeParse(row?.valueJson ?? {})
  return parsed.success ? parsed.data : supportSettingsSchema.parse({})
}

export async function setSupportSettings(
  client: PrismaClient,
  values: Partial<SupportSettings>,
  updatedBy: string,
): Promise<SupportSettings> {
  const merged = supportSettingsSchema.parse({ ...(await supportSettings(client)), ...values })

  await client.platformSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, valueJson: toJson(merged), updatedBy },
    update: { valueJson: toJson(merged), updatedBy },
  })

  return merged
}
