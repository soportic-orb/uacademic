import type { ApiErrorCode } from '@uacademic/shared'

/**
 * Every failure the API returns is one of these. The message the user reads is
 * resolved from the i18n catalogs at the edge (R1), so the error itself only
 * carries a code and a key.
 */
export class AppError extends Error {
  readonly statusCode: number
  readonly code: ApiErrorCode
  readonly messageKey: string
  readonly details?: { path: string; messageKey: string }[]

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    messageKey: string,
    details?: { path: string; messageKey: string }[],
  ) {
    super(`${code}: ${messageKey}`)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.messageKey = messageKey
    if (details) this.details = details
  }

  static badRequest(messageKey = 'errors.validation') {
    return new AppError(400, 'BAD_REQUEST', messageKey)
  }

  static unauthorized(messageKey = 'errors.unauthorized') {
    return new AppError(401, 'UNAUTHORIZED', messageKey)
  }

  static forbidden(messageKey = 'errors.forbidden') {
    return new AppError(403, 'FORBIDDEN', messageKey)
  }

  static notFound(messageKey = 'errors.notFound') {
    return new AppError(404, 'NOT_FOUND', messageKey)
  }

  static conflict(messageKey = 'errors.conflict') {
    return new AppError(409, 'CONFLICT', messageKey)
  }

  static validation(details: { path: string; messageKey: string }[]) {
    return new AppError(422, 'VALIDATION_FAILED', 'errors.validation', details)
  }

  static tenantRequired() {
    return new AppError(400, 'TENANT_REQUIRED', 'errors.tenantRequired')
  }

  static tenantMismatch() {
    return new AppError(403, 'TENANT_MISMATCH', 'errors.tenantMismatch')
  }

  /** R3: the token's `tid` is not one of the registered Entra tenants. */
  static unknownTenant() {
    return new AppError(403, 'UNKNOWN_TENANT', 'errors.unknownTenant')
  }

  static internal(messageKey = 'errors.generic') {
    return new AppError(500, 'INTERNAL_ERROR', messageKey)
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
