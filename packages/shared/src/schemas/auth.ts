/**
 * Authentication contracts (phase 1). The browser never sees a role it was not
 * given by the server, and never sends one either.
 */
import { z } from 'zod'

import { localeSchema, roleSchema, themeSchema, uuidSchema } from './common.js'

/** Exchanges a Microsoft access token for a server session cookie. */
export const entraSessionRequestSchema = z.object({
  accessToken: z.string().min(20),
})
export type EntraSessionRequest = z.infer<typeof entraSessionRequestSchema>

/** Break-glass path for SUPERADMIN, independent of Microsoft. */
export const localLoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
  /** Six-digit TOTP code. Required once the second factor is enrolled. */
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, { message: 'auth.errors.invalidTotp' })
    .optional(),
})
export type LocalLoginRequest = z.infer<typeof localLoginRequestSchema>

export const localPasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z
      .string()
      .min(12, { message: 'auth.errors.passwordTooShort' })
      .max(200)
      .regex(/[a-z]/, { message: 'auth.errors.passwordTooWeak' })
      .regex(/[A-Z]/, { message: 'auth.errors.passwordTooWeak' })
      .regex(/[0-9]/, { message: 'auth.errors.passwordTooWeak' }),
    confirmPassword: z.string(),
  })
  .refine((body) => body.newPassword === body.confirmPassword, {
    message: 'auth.errors.passwordMismatch',
    path: ['confirmPassword'],
  })
  .refine((body) => body.newPassword !== body.currentPassword, {
    message: 'auth.errors.passwordReused',
    path: ['newPassword'],
  })
export type LocalPasswordChange = z.infer<typeof localPasswordChangeSchema>

export const sessionUserSchema = z.object({
  id: uuidSchema,
  email: z.email(),
  firstName: z.string(),
  lastName: z.string(),
  locale: localeSchema,
  theme: themeSchema,
  avatarUrl: z.string().nullable(),
  status: z.enum(['active', 'invited', 'pending_activation', 'suspended']),
  /** How this session was opened; drives what the profile screen offers. */
  authMethod: z.enum(['entra', 'local']),
  /** The linked Microsoft account, shown instead of a password section. */
  microsoftAccount: z
    .object({
      objectId: z.string(),
      tenantId: z.string(),
      username: z.email().nullable(),
    })
    .nullable(),
  memberships: z.array(
    z.object({
      centerId: uuidSchema,
      centerName: z.string(),
      centerCode: z.string(),
      /** The zone this center's instants are shown in (CLAUDE.md §5). */
      centerTimezone: z.string(),
      role: roleSchema,
    }),
  ),
  expiresAt: z.iso.datetime(),
})
export type SessionUser = z.infer<typeof sessionUserSchema>

export const SESSION_COOKIE = 'uacademic_session'
