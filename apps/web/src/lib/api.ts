import type { ApiError as ApiErrorBody } from '@uacademic/shared'
import { CENTER_HEADER } from '@uacademic/shared'

import { currentLocale } from '../i18n'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

/** Carries the API's localized message so a toast can show it as-is (R1). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly localizedMessage: string,
    readonly traceId?: string,
  ) {
    super(`${code} (${status})`)
    this.name = 'ApiRequestError'
  }
}

export interface RequestContext {
  /** Phase 0 identity: replaced by the Entra ID token in phase 1. */
  mockUserEmail?: string | undefined
  centerId?: string | undefined
}

export async function apiFetch<T>(
  path: string,
  context: RequestContext = {},
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  headers.set('accept-language', currentLocale())
  if (context.mockUserEmail) headers.set('x-mock-user', context.mockUserEmail)
  if (context.centerId) headers.set(CENTER_HEADER, context.centerId)

  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null
    throw new ApiRequestError(
      response.status,
      body?.error.code ?? 'INTERNAL_ERROR',
      body?.error.message ?? 'errors.generic',
      body?.error.traceId,
    )
  }

  return (await response.json()) as T
}
