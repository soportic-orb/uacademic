import type { Prisma } from '@uacademic/db'

/**
 * Prisma's JSON input type only accepts plain structures with an index
 * signature, so a typed interface — a validated row, an import summary — needs
 * a widening step. Keeping it in one named helper makes every JSON write
 * greppable instead of scattering casts through the modules.
 */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}
