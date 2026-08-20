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

/**
 * Email and password, independent of Microsoft.
 *
 * Every account can have one: a university that has not registered its tenant
 * yet, a lecturer without a work account, and the platform superadmin, whose
 * credential is also the way in on the day Microsoft does not answer.
 */
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

/**
 * What a password has to be, in one place: the rule is quoted on the screen
 * that asks for one, and two different screens ask.
 */
export const passwordSchema = z
  .string()
  .min(12, { message: 'auth.errors.passwordTooShort' })
  .max(200)
  .regex(/[a-z]/, { message: 'auth.errors.passwordTooWeak' })
  .regex(/[A-Z]/, { message: 'auth.errors.passwordTooWeak' })
  .regex(/[0-9]/, { message: 'auth.errors.passwordTooWeak' })

export const localPasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: passwordSchema,
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

/** Asking for a reset link. Answered the same way whoever is asking. */
export const passwordResetRequestSchema = z.object({
  email: z.email().max(255),
})
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>

/**
 * What the activation screen may show before anybody has proved anything.
 *
 * Whoever holds the link already received it by email, so their own name and
 * address tell them nothing they did not know — and seeing them is how they
 * know the link is the right one. Nothing else is disclosed.
 */
export const invitationSummarySchema = z.object({
  email: z.email(),
  firstName: z.string(),
  lastName: z.string(),
  centerName: z.string().nullable(),
  expiresAt: z.iso.datetime(),
  /** Already linked to Microsoft: a password is an addition, not the way in. */
  hasMicrosoftAccount: z.boolean(),
})
export type InvitationSummary = z.infer<typeof invitationSummarySchema>

/** Accepting one: the password is chosen here, and only here. */
export const invitationAcceptSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((body) => body.password === body.confirmPassword, {
    message: 'auth.errors.passwordMismatch',
    path: ['confirmPassword'],
  })
export type InvitationAccept = z.infer<typeof invitationAcceptSchema>

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
  /**
   * Every role this person holds, in every center of every university.
   *
   * The university travels with the center because somebody who works at two
   * of them needs to see which is which — two faculties called "Educació" are
   * not an unusual thing to find on one platform.
   */
  memberships: z.array(
    z.object({
      centerId: uuidSchema,
      centerName: z.string(),
      centerCode: z.string(),
      /** The zone this center's instants are shown in (CLAUDE.md §5). */
      centerTimezone: z.string(),
      universityId: uuidSchema,
      universityName: z.string(),
      /** Shown in the header, so somebody can see whose platform they are in. */
      universityLogoUrl: z.string().nullable(),
      role: roleSchema,
    }),
  ),
  expiresAt: z.iso.datetime(),
})
export type SessionUser = z.infer<typeof sessionUserSchema>

export const SESSION_COOKIE = 'uacademic_session'
