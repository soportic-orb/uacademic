import type { ApiError } from '@uacademic/shared'
import { translate } from '@uacademic/shared'
import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

import { AppError, isAppError } from '../lib/errors.js'
import { TenantViolationError } from '../lib/tenant-scope.js'

/**
 * One shape for every failure, with the message already resolved in the
 * caller's language (R1) and a trace id that matches the log line.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const error = AppError.notFound()
    void reply.status(error.statusCode).send(toBody(error, request.id, request.locale))
  })

  app.setErrorHandler((error, request, reply) => {
    const appError = normalize(error)

    if (appError.statusCode >= 500) {
      request.log.error({ err: error, traceId: request.id }, 'request failed')
    } else {
      request.log.warn(
        { code: appError.code, traceId: request.id, url: request.url },
        'request rejected',
      )
    }

    void reply.status(appError.statusCode).send(toBody(appError, request.id, request.locale))
  })
}

function normalize(error: unknown): AppError {
  if (isAppError(error)) return error

  if (error instanceof ZodError) {
    return AppError.validation(
      error.issues.map((issue) => ({
        path: issue.path.join('.'),
        messageKey: issue.message,
      })),
    )
  }

  // A tenant violation is a bug or an attack; never leak which center it was.
  if (error instanceof TenantViolationError) return AppError.tenantMismatch()

  const withStatus = error as { statusCode?: number; code?: string }
  if (withStatus?.statusCode === 429) {
    return new AppError(429, 'RATE_LIMITED', 'errors.rateLimited')
  }
  if (withStatus?.statusCode === 400) {
    return AppError.badRequest()
  }

  return AppError.internal()
}

function toBody(
  error: AppError,
  traceId: string,
  locale: Parameters<typeof translate>[0],
): ApiError {
  return {
    error: {
      code: error.code,
      messageKey: error.messageKey,
      message: translate(locale, error.messageKey),
      ...(error.details ? { details: error.details } : {}),
      traceId,
    },
  }
}
