import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * Phase 5C end to end.
 *
 * The e2e environment has no Anthropic key on purpose, so what is checked here
 * is the half that has to work without one: the parameters read in plain
 * language, the citation that justifies each of them, the history of the
 * configuration, and that none of it is a teacher's business. The reading
 * itself is covered by the API suite against a stubbed model.
 */
async function asRole(page: Page, label: string) {
  await page.goto('/')
  await page.getByLabel('Usuari de demostració').selectOption({ label })
}

test.describe('the center parameters', () => {
  test('are shown by name, with the article that imposes each one', async ({ page }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/settings')

    // Plain language, not `schedule.maxConsecutiveHours`.
    await expect(page.getByText('Hores seguides màximes')).toBeVisible()
    await expect(page.getByText('capacity.maxTeachingHoursYear')).toHaveCount(0)

    // And the quote from the center's own regulation, with its article.
    await expect(page.getByText(/quatre hores lectives consecutives/).first()).toBeVisible()
    await expect(page.getByText(/Article 8\.2/).first()).toBeVisible()
  })

  test('admit when a value comes from no regulation', async ({ page }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/settings')

    await expect(page.getByText(/no ve de cap normativa/).first()).toBeVisible()
  })

  test('link into the document at the point that is quoted', async ({ page }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/settings')

    await page.getByRole('link', { name: 'Obre la normativa' }).first().click()

    await expect(page).toHaveURL(/\/documents\?doc=/)
    await expect(page.getByRole('heading', { name: 'Documents', level: 1 })).toBeVisible()
  })

  test('keep the history of the configuration, with what is in force', async ({ page }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/settings')

    await expect(page.getByText('Historial de configuració')).toBeVisible()
    await expect(page.getByText('Vigent').first()).toBeVisible()
  })

  test('are not a teacher’s business', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/settings')

    // The screen is theirs — theme, language — but the center's rules are not.
    await expect(page.getByRole('heading', { name: 'Configuració', level: 1 })).toBeVisible()
    await expect(page.getByText('Llegeix la normativa')).toHaveCount(0)
    await expect(page.getByText('Historial de configuració')).toHaveCount(0)
  })
})

test.describe('reading a regulation', () => {
  test('is offered to the administration, and needs an indexed document', async ({ page }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/settings')

    await expect(page.getByText('Llegeix la normativa')).toBeVisible()
    await expect(page.getByText(/No s’aplica res fins que ho confirmes/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Llegeix aquest document' })).toBeDisabled()
  })
})
