import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * Phase 5 end to end.
 *
 * The e2e environment has no Anthropic key on purpose: what is checked here is
 * the promise that matters most operationally — with the assistant
 * unavailable, the panel says so and **everything else works exactly as
 * before**. The conversation itself, the tools and the proposal ladder are
 * covered by the API suite, driven against a stubbed model.
 */
async function asRole(page: Page, label: string) {
  await page.goto('/')
  await page.getByLabel('Usuari de demostració').selectOption({ label })
}

test.describe('the assistant', () => {
  test('is coordination’s, and says so to everybody else', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/assistant')

    await expect(page.getByText('Només la coordinació té accés')).toBeVisible()
  })

  test('degrades to a message when no key is configured', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/assistant')

    await expect(page.getByRole('heading', { name: 'Assistent IA', level: 1 })).toBeVisible()
    await expect(page.getByText(/no està configurat en aquesta instal·lació/).first()).toBeVisible()

    // No box to type into, because there is nothing to type into it.
    await expect(page.getByRole('button', { name: 'Pregunta' })).toHaveCount(0)
  })

  test('leaves the platform completely usable by hand', async ({ page }) => {
    await asRole(page, 'Coordinació')

    // The planning screen is whole: no panel, no launcher, no gap.
    await page.goto('/planning')
    await expect(page.getByRole('heading', { name: 'Planificació', level: 1 })).toBeVisible()
    await expect(page.getByRole('grid', { name: 'Graella setmanal de planificació' })).toBeVisible()
    await expect(page.getByRole('button', { name: "Obre l'assistent" })).toHaveCount(0)

    // And so is the load panel.
    await page.goto('/my-load')
    await expect(page.getByRole('heading', { name: 'Càrrega docent', level: 1 })).toBeVisible()
  })
})
