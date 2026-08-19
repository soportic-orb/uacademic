import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * The break-glass path, driven through the real UI: the platform superadmin
 * signs in with email and password, no Microsoft involved. The Entra ID path
 * cannot be exercised here without Microsoft, so it is covered by the API
 * tests, which mint real RS256 tokens against a local JWKS.
 *
 * TOTP is enrolled only when the seed had an encryption key; the e2e database
 * is seeded without one, so this checks the password stage.
 */
const SUPERADMIN = {
  email: 'ona.bertran@demo.uacademic.test',
  password: process.env.UACADEMIC_SEED_SUPERADMIN_PASSWORD ?? 'Superadmin-2026-demo',
}

/**
 * The e2e build runs with the phase 0 demo identity switcher enabled, which
 * keeps the browser permanently signed in. These tests clear it first so the
 * app behaves exactly as it does in production: no cookie, no session.
 */
async function withoutDemoIdentity(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'uacademic.session',
      JSON.stringify({ state: { mockUserEmail: '', centerId: undefined }, version: 0 }),
    )
  })
}

/** A real 1×1 PNG: the upload route reads the bytes, not the file name. */
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Picks one of the seeded demo roles from the header switcher. */
async function asRole(page: Page, label: string) {
  await page.goto('/')
  await page.getByLabel('Usuari de demostració').selectOption({ label })
}

test.describe('local sign-in', () => {
  test('refuses a wrong password without saying whether the account exists', async ({ page }) => {
    await withoutDemoIdentity(page)
    await page.goto('/login')
    await page.getByRole('button', { name: "Accés d'administració de plataforma" }).click()

    // A non-existent account on purpose: the answer must be the same as for a
    // wrong password, and this way the real account never gets locked out by
    // the test run.
    await page.getByLabel('Correu electrònic').fill('ningu@demo.uacademic.test')
    await page.getByLabel('Contrasenya').fill('not-the-password')
    await page.getByRole('button', { name: 'Entra', exact: true }).click()

    // The API answers in the caller's language, which is Catalan here.
    await expect(page.getByRole('status')).toContainText('Les credencials no són correctes.')
  })

  test('signs in, lands on the dashboard and signs out again', async ({ page }) => {
    await withoutDemoIdentity(page)
    await page.goto('/login')
    await page.getByRole('button', { name: "Accés d'administració de plataforma" }).click()

    await page.getByLabel('Correu electrònic').fill(SUPERADMIN.email)
    await page.getByLabel('Contrasenya').fill(SUPERADMIN.password)
    await page.getByRole('button', { name: 'Entra', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Tauler' })).toBeVisible()

    await page.getByRole('button', { name: 'Tanca la sessió' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('redirects an anonymous visitor to the sign-in page', async ({ page }) => {
    await withoutDemoIdentity(page)
    await page.goto('/teachers')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Inicia la sessió' })).toBeVisible()
  })

  test('shows the profile with the roles the server resolved', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/profile')

    await expect(page.getByRole('heading', { name: 'Perfil', exact: true })).toBeVisible()
    await expect(page.locator('#main').getByText('Coordinació')).toBeVisible()
  })

  /**
   * The photograph, from picking a file to seeing the face in the header —
   * which is the whole point of it: it replaces the generic person icon
   * everywhere the user is drawn.
   */
  test('takes a profile photograph and shows it beside the name', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/profile')

    await page.getByLabel('Puja una fotografia').setInputFiles({
      name: 'retrat.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ONE_PIXEL_PNG, 'base64'),
    })

    await expect(page.getByText('Fotografia de perfil actualitzada')).toBeVisible()
    await expect(page.locator('header img[alt^="Fotografia de"]')).toBeVisible()

    await page.getByRole('button', { name: 'Elimina la fotografia' }).click()
    await expect(page.getByText('Fotografia de perfil eliminada')).toBeVisible()
    await expect(page.locator('header img[alt^="Fotografia de"]')).toHaveCount(0)
  })
})

test.describe('the university logo', () => {
  /**
   * It used to be a URL field, which asked an administrator to host the image
   * somewhere themselves. The picture is uploaded now, and the column holds an
   * address on this installation.
   */
  test('is uploaded as a file from the admin form', async ({ page }) => {
    await asRole(page, 'Superadministració')
    await page.goto('/admin/universities')

    await page.getByRole('button', { name: 'Edita' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Logotip').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(ONE_PIXEL_PNG, 'base64'),
    })
    await dialog.getByRole('button', { name: 'Desa' }).click()

    await expect(page.getByText('Canvis desats')).toBeVisible()

    // And it is still there when the form is opened again.
    await page.getByRole('button', { name: 'Edita' }).first().click()
    await expect(page.getByRole('dialog').getByRole('img', { name: 'Logotip' })).toBeVisible()
  })
})

test.describe('academic structure', () => {
  test('creates, finds and deletes a space through the admin table', async ({ page }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/admin/spaces')

    // Unique per run: spaces are unique on (center, building, name), and a
    // leftover row from an interrupted run must not fail the next one.
    const name = `Aula e2e ${Date.now()}`

    await page.getByRole('button', { name: 'Crea' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Crea' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Nom').fill(name)
    await dialog.getByLabel('Edifici').fill('Edifici E2E')
    await dialog.getByLabel('Aforament').fill('42')
    await dialog.getByLabel('Tipus').selectOption('classroom')
    await dialog.getByRole('button', { name: 'Desa' }).click()

    await expect(page.getByRole('status')).toContainText('Registre creat')

    await page.getByPlaceholder('Cerca…').fill(name)
    await expect(page.getByRole('cell', { name })).toBeVisible()

    page.once('dialog', (confirm) => void confirm.accept())
    await page.getByRole('button', { name: 'Elimina' }).first().click()
    await expect(page.getByRole('status')).toContainText('Registre eliminat')
    await expect(page.getByRole('cell', { name })).toHaveCount(0)
  })

  test('reports validation errors per field, in the active language', async ({ page }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/admin/spaces')

    await page.getByRole('button', { name: 'Crea' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Crea' })

    await dialog.getByLabel('Nom').fill('X')
    await dialog.getByLabel('Aforament').fill('99999')
    await dialog.getByLabel('Tipus').selectOption('classroom')
    await dialog.getByRole('button', { name: 'Desa' }).click()

    // The capacity limit lives in the shared Zod schema, so the API rejects it
    // and the dialog labels the offending field.
    await expect(dialog.locator('[aria-invalid="true"]')).toHaveCount(1)
  })

  test('keeps the platform tables away from a center administrator', async ({ page }) => {
    await asRole(page, 'Administració del centre')

    await page.goto('/admin/universities')
    await expect(page.getByText('No tens permisos per fer aquesta acció.')).toBeVisible()
  })
})

test.describe('bulk import', () => {
  test('walks upload, mapping, dry run and apply', async ({ page }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/imports')

    await page.getByLabel("Tipus d'importació").selectOption('teachers')
    await page.getByLabel('Cursos acadèmics').selectOption({ index: 1 })

    await page.getByLabel('Tria un fitxer CSV o Excel').setInputFiles({
      name: 'docents-e2e.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'Correu;Nom;Cognoms;Categoria;Dedicació;Hores contractades',
          'e2e.docent@demo.uacademic.test;E2E;Docent;Agregat;Temps complet;120',
          'correu-invalid;Altra;Docent;Agregat;Temps complet;90',
        ].join('\n'),
        'utf8',
      ),
    })

    await page.getByRole('button', { name: 'Puja el fitxer' }).click()
    await expect(page.getByRole('heading', { name: 'Columnes' })).toBeVisible()

    await page.getByRole('button', { name: 'Valida les dades' }).click()

    // The dry run reports one valid row and one broken one, and says plainly
    // that nothing has been written yet.
    await expect(
      page.getByText("Simulació: no s'escriurà res fins que ho confirmis."),
    ).toBeVisible()
    // The failing row is named by field and reason, in the active language.
    await expect(page.getByRole('table')).toContainText('El correu no té un format vàlid.')

    await page.getByRole('button', { name: 'Aplica la importació' }).click()
    await expect(page.getByRole('status')).toContainText('Importació aplicada')
  })
})
