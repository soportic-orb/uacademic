import type { z } from 'zod'

/**
 * R6: request shapes are validated with the same Zod schemas the web client
 * uses, so the API types are inferred rather than declared twice.
 * A failure throws a `ZodError`, which the error handler turns into a 422 with
 * per-field i18n keys.
 */
export function parseWith<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.infer<Schema> {
  return schema.parse(value) as z.infer<Schema>
}
