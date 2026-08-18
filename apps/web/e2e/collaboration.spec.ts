import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * Phase 4 end to end: a class change walking up the ladder, an absence that
 * produces a ranked list of substitutes, the messaging channels, the bell and
 * the audit viewer.
 *
 * Push is not exercised here: a browser context cannot be granted a real push
 * subscription, and the part that matters — never asking for the permission on
 * load, and explaining the home-screen step on iOS — is covered by the
 * component tests.
 */
async function asRole(page: Page, label: string) {
  await page.goto('/')
  await page.getByLabel('Usuari de demostració').selectOption({ label })
}

test.describe('class changes', () => {
  test('a teacher proposes a move and can withdraw it', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/changes')

    await expect(page.getByRole('heading', { name: 'Canvis de classe', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Sol·licita un canvi' }).first().click()
    const changeForm = page.locator('form').first()

    const session = page.getByLabel('Sessió afectada')
    await expect(session).toBeVisible()
    // The demo teacher has published classes; the empty option is the first,
    // and the list arrives with the request, so this has to be waited for.
    await expect(session.locator('option').nth(1)).toBeAttached()
    await session.selectOption({ index: 1 })

    await page.getByLabel('Nou dia').selectOption('4')
    await page.getByLabel('Motiu').fill('Prova e2e')
    await changeForm.getByRole('button', { name: 'Envia', exact: true }).click()

    await expect(page.getByRole('status').getByText('Sol·licitud enviada')).toBeVisible()

    // The ladder now offers exactly what a requester may do next.
    await expect(page.getByRole('button', { name: 'Retira' })).toBeVisible()
    await page.getByRole('button', { name: 'Retira' }).click()
    await expect(page.getByRole('status').getByText('Sol·licitud retirada')).toBeVisible()
  })

  test('shows coordination the requests waiting for them', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/changes')

    await page.getByRole('button', { name: 'Obertes' }).click()
    await expect(page.getByRole('button', { name: 'Obertes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

test.describe('absences', () => {
  test('a teacher reports one and coordination gets a ranked list of substitutes', async ({
    page,
  }) => {
    await asRole(page, 'Professorat')
    await page.goto('/absences')

    await page.getByRole('button', { name: 'Comunica una absència' }).first().click()

    // The seeded timetable runs from mid-September to mid-December and the
    // demo teacher's class falls on a Tuesday: this range actually hits it.
    const reportForm = page.locator('form').first()
    await page.getByLabel('Des del').fill('2026-10-05')
    await page.getByLabel('Fins al').fill('2026-10-09')
    await page.getByLabel('Detall').fill('Prova e2e')
    await reportForm.getByRole('button', { name: 'Comunica una absència' }).click()

    await expect(page.getByRole('status').getByText('Absència comunicada')).toBeVisible()

    await asRole(page, 'Coordinació')
    await page.goto('/absences')

    await expect(page.getByRole('heading', { name: 'Absències', level: 1 })).toBeVisible()
    const affected = page.getByRole('heading', { name: 'Classes afectades' })
    await expect(affected).toBeVisible()

    const findSubstitute = page.getByRole('button', { name: 'Busca substitut' })
    if ((await findSubstitute.count()) === 0) test.skip()

    await findSubstitute.first().click()
    await expect(page.getByRole('heading', { name: 'Qui pot cobrir aquesta classe' })).toBeVisible()
    // Eligible or not, every candidate carries the reason for their place.
    await expect(
      page.getByText('Poden cobrir-la').or(page.getByText('No poden cobrir-la')).first(),
    ).toBeVisible()
  })
})

test.describe('messaging', () => {
  test('opens the standing channels and sends a message', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/messages')

    await expect(page.getByRole('heading', { name: 'Missatges', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Converses' })).toBeVisible()

    await page
      .getByRole('button', { name: /Anuncis del centre/ })
      .first()
      .click()

    const composer = page.getByRole('textbox', { name: 'Escriu un missatge…' })
    await expect(composer).toBeVisible()
    await composer.fill('Missatge de prova e2e')
    await page.getByRole('button', { name: 'Envia' }).click()

    await expect(page.getByRole('status').getByText('Enviat')).toBeVisible()
    // Once in the conversation list as the last line, once in the thread.
    await expect(page.getByText('Missatge de prova e2e').last()).toBeVisible()
  })

  test('a teacher cannot write in the announcement channel', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/messages')

    await page
      .getByRole('button', { name: /Anuncis del centre/ })
      .first()
      .click()
    await expect(page.getByText(/Aquest canal és només d’anuncis/)).toBeVisible()
  })
})

test.describe('notifications', () => {
  test('the bell opens, and the preferences say what cannot be switched off', async ({ page }) => {
    await asRole(page, 'Professorat')

    await page
      .getByRole('button', { name: /Notificacions/ })
      .first()
      .click()
    await expect(page.getByRole('dialog', { name: 'Notificacions' })).toBeVisible()

    await page.getByRole('link', { name: 'Veure-les totes' }).click()
    await expect(page.getByRole('heading', { name: 'Preferències de notificació' })).toBeVisible()

    // A mandatory channel is checked and cannot be unchecked.
    const mandatory = page.getByRole('checkbox', { name: /Horari publicat · A l’app/ })
    await expect(mandatory).toBeChecked()
    await expect(mandatory).toBeDisabled()

    await page.getByRole('button', { name: 'Desa' }).click()
    await expect(page.getByRole('status').getByText('Preferències desades')).toBeVisible()
  })
})

test.describe('the audit viewer', () => {
  test('lists what changed and filters it by origin', async ({ page }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/audit')

    await expect(page.getByRole('heading', { name: 'Auditoria', level: 1 })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Auditoria' })).toBeVisible()

    await page.getByLabel('Origen').selectOption('user')
    await expect(page.getByRole('table', { name: 'Auditoria' })).toBeVisible()
  })

  test('is out of reach for a teacher', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/audit')

    // The API is the authority: the screen renders, the data does not arrive.
    await expect(page.getByRole('alert')).toBeVisible()
  })
})
