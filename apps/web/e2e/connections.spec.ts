import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * Phase 4B end to end: the three levels of getting a timetable out of
 * UAcademic, and the honesty the screen owes about each one.
 *
 * The OAuth flows themselves are not driven here — a browser test cannot
 * consent on Microsoft's or Google's behalf — so what is checked is what the
 * teacher sees before and instead of that: the subscription that works
 * everywhere, the instructions, the latency of each client, and the states a
 * provider can be in on an installation that has no credentials for it.
 */
async function asRole(page: Page, label: string) {
  await page.goto('/')
  await page.getByLabel('Usuari de demostració').selectOption({ label })
}

test.describe('calendar connections', () => {
  test('hands out a subscription address that serves a real calendar', async ({
    page,
    request,
  }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/connections')

    await expect(page.getByRole('heading', { name: 'Connexions de calendari' })).toBeVisible()

    await page.getByRole('button', { name: "Genera l'adreça" }).click()

    const field = page.getByLabel('Adreça de subscripció')
    await expect(field).toBeVisible()
    const url = await field.inputValue()
    expect(url).toContain('/api/v1/calendar/feed/')

    // No cookie, no session: the address is the identity.
    const feed = await request.get(url)
    expect(feed.status()).toBe(200)
    expect(feed.headers()['content-type']).toContain('text/calendar')

    const body = await feed.text()
    expect(body).toContain('BEGIN:VCALENDAR')
    // A client that does not know the zone still places the class correctly.
    expect(body).toContain('BEGIN:VTIMEZONE')
    expect(body).toContain('TZID:Europe/Madrid')
    expect(body).toContain('SEQUENCE:')

    await expect(page.getByText(/Qui tingui aquesta adreça/)).toBeVisible()
  })

  test('is explicit about how slow each client is, Google most of all', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/connections')

    await expect(page.getByText(/cada 8-24 hores/)).toBeVisible()
    await expect(page.getByText('Entre 8 h i 24 h').first()).toBeVisible()
    await expect(page.getByText(/Nova subscripció de calendari/)).toBeVisible()
  })

  test('explains Apple instead of promising something it cannot do', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/connections')

    await expect(page.getByRole('heading', { name: 'Apple i iCloud' })).toBeVisible()
    await expect(page.getByText(/no té API pública de calendari/)).toBeVisible()
    await expect(page.getByText(/mai una contrasenya d’aplicació/)).toBeVisible()
  })

  test('says a provider is unavailable rather than offering a broken button', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/connections')

    // Neither provider has credentials in the e2e environment.
    const notConfigured = page.getByText(/no està configurat en aquesta instal·lació/)
    await expect(notConfigured.first()).toBeVisible()
    expect(await notConfigured.count()).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: 'Connecta' })).toHaveCount(0)
  })

  test('promises what a dedicated calendar means before anybody connects', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/connections')

    await expect(page.getByText(/Mai escrivim al teu calendari personal/).first()).toBeVisible()
    await expect(page.getByText(/la restaurem a la següent sincronització/).first()).toBeVisible()
  })
})
