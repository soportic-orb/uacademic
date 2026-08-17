import type { Role } from '@uacademic/shared'
import { listQuerySchema, paginate, toListResult } from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { writeAuditLog } from './audit.js'
import { AppError } from './errors.js'
import { type PrismaClient, prisma } from './prisma.js'
import { parseWith } from './validate.js'
import { requireCenterScope, requireUser } from '../plugins/context.js'

/**
 * One CRUD implementation for every admin table.
 *
 * Writing ten near-identical route files is how pagination ends up in the
 * browser on the eleventh one and how a tenant filter goes missing on the
 * twelfth. Instead each resource is a description, and this factory gives it
 * server-side list, filtering, sorting, validation, role checks and audit.
 */
interface Delegate {
  findMany(args: unknown): Promise<Record<string, unknown>[]>
  count(args: unknown): Promise<number>
  findUnique(args: unknown): Promise<Record<string, unknown> | null>
  create(args: unknown): Promise<Record<string, unknown>>
  update(args: unknown): Promise<Record<string, unknown>>
  delete(args: unknown): Promise<Record<string, unknown>>
}

/**
 * Prisma's per-model delegates are structurally identical for the operations
 * used here, but their argument types are model-specific. The single cast is
 * confined to this function; every route above it stays typed.
 */
function delegate(client: PrismaClient, model: string): Delegate {
  const found = (client as unknown as Record<string, Delegate | undefined>)[model]
  if (!found) throw new Error(`Unknown Prisma model "${model}"`)
  return found
}

export interface CrudResource<Input extends z.ZodType> {
  /** URL segment, e.g. `subjects` → `/api/v1/subjects`. */
  path: string
  /** Prisma model accessor, e.g. `subject`. */
  model: string
  /** Entity name written to the audit log. */
  entity: string
  /**
   * `center` resources are read and written through the tenant-scoped client;
   * `platform` ones (universities, tenants, centers) are superadmin-only.
   */
  scope: 'center' | 'platform'
  roles: {
    read: readonly Role[]
    write: readonly Role[]
  }
  inputSchema: Input
  /** Columns the client may sort by. Anything else is rejected. */
  sortable: readonly [string, ...string[]]
  defaultSort: string
  /** Columns covered by the `q` free-text parameter. */
  searchFields: readonly string[]
  /** Extra equality filters accepted as query parameters. */
  filterFields?: readonly string[]
  include?: Record<string, unknown>
  /** Maps a database row to the shape the client sees. */
  serialize: (row: Record<string, unknown>) => unknown
  /** Business rules that a Zod schema cannot express (cross-table checks). */
  beforeWrite?: (
    input: z.infer<Input>,
    context: { client: PrismaClient; centerId: string | null; id?: string },
  ) => Promise<Record<string, unknown>> | Record<string, unknown>
}

function buildWhere(
  resource: CrudResource<z.ZodType>,
  query: Record<string, unknown>,
): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = []

  const search = typeof query.q === 'string' ? query.q.trim() : ''
  if (search.length > 0 && resource.searchFields.length > 0) {
    conditions.push({
      OR: resource.searchFields.map((field) => ({ [field]: { contains: search } })),
    })
  }

  for (const field of resource.filterFields ?? []) {
    const value = query[field]
    if (value !== undefined && value !== '') conditions.push({ [field]: value })
  }

  return conditions.length === 0 ? {} : { AND: conditions }
}

function clientFor(
  resource: CrudResource<z.ZodType>,
  request: FastifyRequest,
): { client: PrismaClient; centerId: string | null } {
  if (resource.scope === 'center') {
    const { centerId, db } = requireCenterScope(request)
    return { client: db, centerId }
  }
  requireUser(request)
  return { client: prisma(), centerId: null }
}

export function registerCrudRoutes<Input extends z.ZodType>(
  app: FastifyInstance,
  resource: CrudResource<Input>,
): void {
  const base = `/api/v1/${resource.path}`
  type RouteConfig = { superadminOnly?: boolean; roles?: Role[] }
  const readConfig: RouteConfig =
    resource.scope === 'platform'
      ? { superadminOnly: true }
      : { roles: [...resource.roles.read] }
  const writeConfig: RouteConfig =
    resource.scope === 'platform'
      ? { superadminOnly: true }
      : { roles: [...resource.roles.write] }

  // Filters arrive as strings on the query string; each resource declares
  // which ones it accepts, so an arbitrary column can never be filtered on.
  const filterShape: z.ZodRawShape = Object.fromEntries(
    (resource.filterFields ?? []).map((field) => [field, z.string().trim().min(1).optional()]),
  )
  const querySchema = listQuerySchema(resource.sortable, filterShape)

  app.get(base, { config: readConfig }, async (request) => {
    const { client } = clientFor(resource, request)
    const query = parseWith(querySchema, request.query) as Record<string, unknown> & {
      page: number
      pageSize: number
      sort?: string
      order: 'asc' | 'desc'
    }

    const where = buildWhere(resource, { ...(request.query as Record<string, unknown>), ...query })
    const { skip, take } = paginate(query.page, query.pageSize)
    const model = delegate(client, resource.model)

    const [rows, total] = await Promise.all([
      model.findMany({
        where,
        orderBy: { [query.sort ?? resource.defaultSort]: query.order },
        skip,
        take,
        ...(resource.include ? { include: resource.include } : {}),
      }),
      model.count({ where }),
    ])

    return toListResult(rows.map(resource.serialize), total, query.page, query.pageSize)
  })

  app.get(`${base}/:id`, { config: readConfig }, async (request) => {
    const { client } = clientFor(resource, request)
    const { id } = request.params as { id: string }

    const row = await delegate(client, resource.model).findUnique({
      where: { id },
      ...(resource.include ? { include: resource.include } : {}),
    })
    if (!row) throw AppError.notFound()

    return resource.serialize(row)
  })

  app.post(base, { config: writeConfig }, async (request, reply) => {
    const { client, centerId } = clientFor(resource, request)
    const user = requireUser(request)
    const input = parseWith(resource.inputSchema, request.body)

    const data = resource.beforeWrite
      ? await resource.beforeWrite(input, { client, centerId })
      : (input as Record<string, unknown>)

    const row = await delegate(client, resource.model).create({ data })

    await writeAuditLog(prisma(), {
      centerId,
      userId: user.userId,
      entity: resource.entity,
      entityId: String(row.id),
      action: 'create',
      after: row,
      source: 'user',
      ip: request.ip,
    })

    void reply.status(201)
    return resource.serialize(row)
  })

  app.patch(`${base}/:id`, { config: writeConfig }, async (request) => {
    const { client, centerId } = clientFor(resource, request)
    const user = requireUser(request)
    const { id } = request.params as { id: string }

    const model = delegate(client, resource.model)
    const before = await model.findUnique({ where: { id } })
    if (!before) throw AppError.notFound()

    // Partial update: only the fields present in the body are validated.
    const schema = resource.inputSchema as unknown as z.ZodObject
    const input = parseWith(schema.partial(), request.body)

    const data = resource.beforeWrite
      ? await resource.beforeWrite(input as z.infer<Input>, { client, centerId, id })
      : (input as Record<string, unknown>)

    const after = await model.update({ where: { id }, data })

    await writeAuditLog(prisma(), {
      centerId,
      userId: user.userId,
      entity: resource.entity,
      entityId: id,
      action: 'update',
      before,
      after,
      source: 'user',
      ip: request.ip,
    })

    return resource.serialize(after)
  })

  app.delete(`${base}/:id`, { config: writeConfig }, async (request) => {
    const { client, centerId } = clientFor(resource, request)
    const user = requireUser(request)
    const { id } = request.params as { id: string }

    const model = delegate(client, resource.model)
    const before = await model.findUnique({ where: { id } })
    if (!before) throw AppError.notFound()

    try {
      await model.delete({ where: { id } })
    } catch {
      // Foreign keys are Restrict on purpose: refuse rather than cascade away
      // a degree with subjects hanging off it.
      throw AppError.conflict('errors.conflict')
    }

    await writeAuditLog(prisma(), {
      centerId,
      userId: user.userId,
      entity: resource.entity,
      entityId: id,
      action: 'delete',
      before,
      source: 'user',
      ip: request.ip,
    })

    return { ok: true }
  })
}
