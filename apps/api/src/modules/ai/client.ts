/**
 * The one place that talks to Anthropic.
 *
 * The browser never does (phase 5, first rule): every request is built here,
 * with a context this server scoped and minimised, and the key never leaves
 * the environment.
 *
 * If the key is missing, or the API is down, `assistantAvailable()` says so
 * and the rest of the product carries on untouched. That is deliberate: the
 * assistant is a tool for coordination, not a dependency of the timetable.
 */
import Anthropic from '@anthropic-ai/sdk'

import { env } from '../../config/env.js'

let client: Anthropic | undefined
let override: Anthropic | undefined

/** Test seam: a fake client replaces the SDK wholesale. */
export function setAnthropicClient(value: Anthropic | undefined): void {
  override = value
  client = undefined
}

export function assistantAvailable(): boolean {
  return Boolean(override) || Boolean(env().ANTHROPIC_API_KEY)
}

export function anthropic(): Anthropic {
  if (override) return override
  if (!client) {
    client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY ?? '' })
  }
  return client
}

export function assistantModel(): string {
  return env().ANTHROPIC_MODEL
}
