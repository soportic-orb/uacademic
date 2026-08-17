import { type CenterSettings, parseCenterSettings } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'

import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { requireCenterScope, requireUser } from '../../plugins/context.js'

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

  app.get('/api/v1/centers/settings', async (request): Promise<SettingsDto> => {
    const { centerId, db } = requireCenterScope(request)

    const center = await prisma().center.findUnique({ where: { id: centerId } })
    if (!center) throw AppError.notFound()

    const provenance = await db.settingProvenance.findMany({
      include: { document: { select: { title: true } } },
      orderBy: { paramKey: 'asc' },
    })

    return {
      centerId,
      settings: parseCenterSettings(center.settingsJson),
      provenance: provenance.map((record) => ({
        paramKey: record.paramKey,
        documentTitle: record.document?.title ?? null,
        page: record.page,
        section: record.section,
        quote: record.quote,
      })),
    }
  })
}
