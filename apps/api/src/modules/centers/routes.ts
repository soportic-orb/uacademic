import type { CenterSettings } from '@uacademic/shared'
import {
  centerSettingsPatchSchema,
  centerSettingsSchema,
  settingParam,
  withSettingValue,
} from '@uacademic/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { parseWith } from '../../lib/validate.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'
import {
  currentSettings,
  currentVersionId,
  publishSettingsVersion,
} from '../../services/settings/versions.js'

interface CenterDto {
  id: string
  name: string
  code: string
  timezone: string
  localeDefault: string
}

interface SettingsDto {
  centerId: string
  settings: CenterSettings
  /** R9: where each parameter comes from, so a blocking rule can be explained. */
  provenance: {
    paramKey: string
    documentId: string | null
    documentTitle: string | null
    page: number | null
    section: string | null
    quote: string | null
  }[]
}

export function registerCenterRoutes(app: FastifyInstance): void {
  /** Centers the caller belongs to. SUPERADMIN sees all of them. */
  app.get('/api/v1/centers', async (request): Promise<{ items: CenterDto[] }> => {
    const user = requireUser(request)
    const isSuper = user.memberships.some((membership) => membership.role === 'SUPERADMIN')

    const centers = await prisma().center.findMany({
      where: isSuper ? {} : { id: { in: [...new Set(user.memberships.map((m) => m.centerId))] } },
      orderBy: { name: 'asc' },
    })

    return {
      items: centers.map((center) => ({
        id: center.id,
        name: center.name,
        code: center.code,
        timezone: center.timezone,
        localeDefault: center.localeDefault,
      })),
    }
  })

  /** What the settings screen reads, after a GET and after an edit alike. */
  async function settingsDto(request: FastifyRequest): Promise<SettingsDto> {
    const { centerId, db } = requireCenterScope(request)

    const center = await prisma().center.findUnique({ where: { id: centerId } })
    if (!center) throw AppError.notFound()

    // Only the version in force: a center that has published three of them
    // has three sets of citations, and the older two explain last year.
    const versionId = await currentVersionId(prisma(), centerId)
    const provenance = versionId
      ? await db.settingProvenance.findMany({
          where: { settingsVersionId: versionId },
          include: { document: { select: { title: true } } },
          orderBy: { paramKey: 'asc' },
        })
      : []

    return {
      centerId,
      settings: await currentSettings(prisma(), centerId),
      provenance: provenance.map((record) => ({
        paramKey: record.paramKey,
        documentId: record.documentId,
        documentTitle: record.document?.title ?? null,
        page: record.page,
        section: record.section,
        quote: record.quote,
      })),
    }
  }

  app.get('/api/v1/centers/settings', async (request): Promise<SettingsDto> => settingsDto(request))

  /**
   * Editing the parameters by hand.
   *
   * Reading a regulation with the assistant is the path that carries citations
   * with it, and it is the better one — but it is not the only way a center
   * knows its own rules. A center whose maximum teaching hours are simply
   * known, or whose document the extraction could not read, had no way to say
   * so at all: every parameter on the screen was read-only.
   *
   * Only the parameters named are touched; everything else is carried forward,
   * citations included, by `publishSettingsVersion`.
   */
  app.patch(
    '/api/v1/centers/settings',
    { config: { roles: ['CENTER_ADMIN'] } },
    async (request): Promise<SettingsDto> => {
      const { centerId } = requireCenterScope(request)
      const actor = requireUser(request)
      const input = parseWith(centerSettingsPatchSchema, request.body)
      const client = prisma()

      const unknownKeys = Object.keys(input.values).filter((key) => !settingParam(key))
      if (unknownKeys.length > 0) {
        throw AppError.validation(
          unknownKeys.map((key) => ({ path: `values.${key}`, messageKey: 'validation.unknown' })),
        )
      }

      const current = await currentSettings(client, centerId)
      let draft: unknown = current
      for (const [key, value] of Object.entries(input.values)) {
        draft = withSettingValue(draft as CenterSettings, key, value)
      }

      // The schema is the authority on what a parameter may be (R9): a
      // negative session length or a threshold above 1000 is refused here
      // rather than discovered by the planner three screens later.
      const parsed = centerSettingsSchema.safeParse(draft)
      if (!parsed.success) {
        throw AppError.validation(
          parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            messageKey: issue.message,
          })),
        )
      }

      await publishSettingsVersion(client, {
        centerId,
        settings: parsed.data,
        source: 'manual',
        approvedBy: actor.userId,
        notes: input.notes ?? null,
        ip: request.ip,
      })

      return settingsDto(request)
    },
  )
}
