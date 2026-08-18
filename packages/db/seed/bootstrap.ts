/**
 * Bootstrapping a real installation.
 *
 * `seed/index.ts` builds the demo university — eleven teachers, a timetable, a
 * regulation — which is exactly what a production database must not contain.
 * This creates the minimum a real center needs to be usable on day one and
 * nothing else:
 *
 *   one university · one center with its default parameters · one Entra tenant
 *   (when given) · one SUPERADMIN with a break-glass password
 *
 * Idempotent: run it twice and nothing is duplicated. Everything else — the
 * academic year, the degrees, the subjects, the staff — is created from the
 * interface or through an import, by somebody who knows the institution.
 *
 *   UACADEMIC_BOOTSTRAP_UNIVERSITY="Universitat de Prova" \
 *   UACADEMIC_BOOTSTRAP_CENTER="Facultat de Ciències" \
 *   UACADEMIC_BOOTSTRAP_CENTER_CODE="FC" \
 *   UACADEMIC_BOOTSTRAP_EMAIL="admin@uacademic.cat" \
 *   UACADEMIC_BOOTSTRAP_PASSWORD="…" \
 *   pnpm --filter @uacademic/db bootstrap
 */
import 'dotenv/config'

import { defaultCenterSettings } from '@uacademic/shared'

import { createPrismaClient } from '../src/client.js'
import { encryptSecret, generateTotpSecret, hashPassword } from './local-credentials.js'

const prisma = createPrismaClient()

function required(name: string): string {
  const value = process.env[name]
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required. See the header of seed/bootstrap.ts.`)
  }
  return value.trim()
}

function optional(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim()
}

async function main() {
  const universityName = required('UACADEMIC_BOOTSTRAP_UNIVERSITY')
  const centerName = required('UACADEMIC_BOOTSTRAP_CENTER')
  const centerCode = required('UACADEMIC_BOOTSTRAP_CENTER_CODE').toUpperCase()
  const email = required('UACADEMIC_BOOTSTRAP_EMAIL').toLowerCase()
  const password = required('UACADEMIC_BOOTSTRAP_PASSWORD')

  const firstName = optional('UACADEMIC_BOOTSTRAP_FIRST_NAME', 'Super')
  const lastName = optional('UACADEMIC_BOOTSTRAP_LAST_NAME', 'Admin')
  const timezone = optional('UACADEMIC_BOOTSTRAP_TIMEZONE', 'Europe/Madrid')
  const locale = optional('UACADEMIC_BOOTSTRAP_LOCALE', 'ca') as 'ca' | 'es' | 'en'
  const entraTenantId = optional('UACADEMIC_BOOTSTRAP_ENTRA_TENANT')
  const encryptionKey = process.env.UACADEMIC_APP_ENCRYPTION_KEY

  if (password.length < 12) {
    throw new Error('UACADEMIC_BOOTSTRAP_PASSWORD must be at least 12 characters.')
  }

  // The tenant first: the center points at it, and R3 refuses any token whose
  // `tid` is not registered here.
  if (entraTenantId) {
    await prisma.entraTenant.upsert({
      where: { tenantId: entraTenantId },
      create: {
        tenantId: entraTenantId,
        displayName: universityName,
        issuer: `https://login.microsoftonline.com/${entraTenantId}/v2.0`,
        status: 'active',
      },
      update: { displayName: universityName, status: 'active' },
    })
  }

  const university =
    (await prisma.university.findFirst({ where: { name: universityName } })) ??
    (await prisma.university.create({ data: { name: universityName } }))

  const existingCenter = await prisma.center.findFirst({
    where: { universityId: university.id, code: centerCode },
  })

  const center =
    existingCenter ??
    (await prisma.center.create({
      data: {
        universityId: university.id,
        name: centerName,
        code: centerCode,
        timezone,
        localeDefault: locale,
        entraTenantId: entraTenantId || null,
        settingsJson: defaultCenterSettings as never,
      },
    }))

  // Phase 5C: the configuration in force is resolved from a version, so a new
  // center starts with one instead of with a column nobody can trace.
  if (!center.settingsVersionId) {
    const version = await prisma.centerSettingsVersion.create({
      data: {
        centerId: center.id,
        settingsJson: defaultCenterSettings as never,
        source: 'manual',
        notes: 'Initial configuration (platform defaults).',
      },
    })
    await prisma.center.update({
      where: { id: center.id },
      data: { settingsVersionId: version.id },
    })
  }

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, firstName, lastName, locale, status: 'active' },
    update: { status: 'active' },
  })

  await prisma.userCenterRole.upsert({
    where: { userId_centerId_role: { userId: user.id, centerId: center.id, role: 'SUPERADMIN' } },
    create: { userId: user.id, centerId: center.id, role: 'SUPERADMIN' },
    update: {},
  })

  // The break-glass credential: the platform has to stay reachable when Entra
  // ID is down, and on the first day nobody has signed in through it yet.
  const existingCredential = await prisma.localCredential.findUnique({ where: { userId: user.id } })
  const totpSecret = encryptionKey && !existingCredential ? generateTotpSecret() : null

  if (existingCredential) {
    await prisma.localCredential.update({
      where: { userId: user.id },
      data: { passwordHash: await hashPassword(password) },
    })
  } else {
    await prisma.localCredential.create({
      data: {
        userId: user.id,
        passwordHash: await hashPassword(password),
        ...(totpSecret && encryptionKey
          ? {
              totpSecretEnc: encryptSecret(totpSecret, encryptionKey),
              totpConfirmedAt: new Date(),
            }
          : {}),
      },
    })
  }

  console.log('\nInstallation ready.\n')
  console.log(`  University   ${university.name}`)
  console.log(`  Center       ${center.name} (${center.code})`)
  console.log(`  Entra tenant ${entraTenantId || 'not registered yet — add it from the UI'}`)
  console.log(`  Superadmin   ${email}`)

  if (totpSecret) {
    console.log(`\n  TOTP secret (enrol it in an authenticator now, it is shown once):`)
    console.log(`  ${totpSecret}`)
  } else if (!encryptionKey) {
    console.log('\n  No UACADEMIC_APP_ENCRYPTION_KEY: the second factor was not enrolled.')
  }

  console.log('\nNext: sign in, register the Entra tenants, and create the academic year.\n')
}

try {
  await main()
} finally {
  await prisma.$disconnect()
}
