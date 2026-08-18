import type { ApiError as ApiErrorBody } from '@uacademic/shared'
import { CENTER_HEADER } from '@uacademic/shared'

import { currentLocale } from '../i18n'
import { API_BASE_URL } from './api-base'
import { useSessionStore } from '../stores/session'

/** Development and e2e only; the API refuses this mode in production. */
const MOCK_AUTH = import.meta.env.VITE_UACADEMIC_AUTH_MODE === 'mock'

/**
 * Carries the API's localized message so a toast can show it as-is (R1), and
 * its key, which is what a caller matches on: several failures share a status
 * and a code — a wrong password and a missing second factor are both a 401
 * UNAUTHORIZED — and only the key tells them apart.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly localizedMessage: string,
    readonly messageKey: string = '',
    readonly details: { path: string; messageKey: string }[] = [],
    readonly traceId?: string,
  ) {
    super(`${code} (${status})`)
    this.name = 'ApiRequestError'
  }
}

/**
 * Every call carries the session cookie (`credentials: 'include'`) and the
 * active center. The session itself is httpOnly, so there is nothing here to
 * read, attach or accidentally log.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  headers.set('accept-language', currentLocale())

  const centerId = useSessionStore.getState().centerId
  if (centerId) headers.set(CENTER_HEADER, centerId)

  if (MOCK_AUTH) {
    const mockUserEmail = useSessionStore.getState().mockUserEmail
    if (mockUserEmail) headers.set('x-mock-user', mockUserEmail)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null
    throw new ApiRequestError(
      response.status,
      body?.error.code ?? 'INTERNAL_ERROR',
      body?.error.message ?? 'errors.generic',
      body?.error.messageKey ?? '',
      body?.error.details ?? [],
      body?.error.traceId,
    )
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/**
 * Binary download (the Excel export). It goes through the same headers as every
 * other call — session cookie, active center, locale — so the server can scope
 * and translate it exactly as it does the table on screen.
 */
export async function apiDownload(path: string): Promise<Blob> {
  const headers = new Headers({ 'accept-language': currentLocale() })

  const centerId = useSessionStore.getState().centerId
  if (centerId) headers.set(CENTER_HEADER, centerId)

  if (MOCK_AUTH) {
    const mockUserEmail = useSessionStore.getState().mockUserEmail
    if (mockUserEmail) headers.set('x-mock-user', mockUserEmail)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { headers, credentials: 'include' })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null
    throw new ApiRequestError(
      response.status,
      body?.error.code ?? 'INTERNAL_ERROR',
      body?.error.message ?? 'errors.generic',
      body?.error.messageKey ?? '',
    )
  }

  return response.blob()
}

/** Multipart upload: the browser sets the boundary, so no content-type here. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: form })
}

export function apiJson<T>(path: string, method: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
