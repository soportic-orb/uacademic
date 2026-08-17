/**
 * Server-side list contract shared by every admin table: pagination, sorting,
 * free-text search and per-resource filters all travel as query parameters and
 * are resolved in SQL. Nothing paginates in the browser.
 */
import { z } from 'zod'

export const sortOrderSchema = z.enum(['asc', 'desc'])
export type SortOrder = z.infer<typeof sortOrderSchema>

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

/**
 * Builds the query schema for a resource, restricting `sort` to columns the
 * server can actually order by — an open string would be an injection surface
 * and a performance trap.
 */
export function listQuerySchema<
  const Sortable extends readonly [string, ...string[]],
  Filters extends z.ZodRawShape = Record<string, never>,
>(sortable: Sortable, filters: Filters = {} as Filters) {
  return z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
      sort: z.enum(sortable).optional(),
      order: sortOrderSchema.default('asc'),
      /** Free-text search; each resource decides which columns it covers. */
      q: z.string().trim().max(200).optional(),
    })
    .extend(filters)
}

export interface ListResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export function listResultSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  })
}

export function paginate(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize }
}

export function toListResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): ListResult<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  }
}
