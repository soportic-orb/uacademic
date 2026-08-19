import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * The identity switcher is phase 0's stand-in for signing in as different
 * people; phase 1 replaces it with Entra ID and these flows stay the same.
 */
async function signInAs(page: Page, roleLabel: string) {
  await page.goto('/')
  await page.getByLabel('Usuari de demostració').selectOption({ label: roleLabel })
}

test.describe('teaching load', () => {
  test('a coordinator sees the center traffic light', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Tauler' })).toBeVisible()
    await expect(page.getByText('Professorat amb càrrega')).toBeVisible()
    await expect(page.getByText('Sobrecàrrega')).toBeVisible()
  })

  test('the teacher list shows every load status with an icon and a label', async ({ page }) => {
    await page.goto('/teachers')

    const table = page.getByRole('table')
    await expect(table).toBeVisible()
    await expect(table.getByText('Marta Puig Serra')).toBeVisible()
    await expect(table.getByText('Òptima').first()).toBeVisible()
  })
})

test.describe('role-based navigation', () => {
  test('a teacher does not see the coordination sections', async ({ page }) => {
    await signInAs(page, 'Professorat')

    const nav = page.getByRole('navigation', { name: 'Navegació principal' })
    await expect(nav.getByRole('link', { name: 'La meva càrrega' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Professorat' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Assistent IA' })).toHaveCount(0)
  })

  test('the API refuses a teacher reading the whole center, not just the UI', async ({
    request,
  }) => {
    const me = await request.get('http://127.0.0.1:3001/api/v1/me', {
      headers: { 'x-mock-user': 'sergi.vila@demo.uacademic.test' },
    })
    const centerId = (await me.json()).memberships[0].centerId

    const response = await request.get('http://127.0.0.1:3001/api/v1/teachers/load', {
      headers: { 'x-mock-user': 'sergi.vila@demo.uacademic.test', 'x-center-id': centerId },
    })

    expect(response.status()).toBe(403)
  })
})

test.describe('interface', () => {
  test('switches language without reloading', async ({ page }) => {
    await page.goto('/settings')

    await page.getByRole('button', { name: 'Anglès' }).click()

    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    // Every notice in the app is a toast in the top-center region.
    await expect(page.getByRole('status').getByText('Language changed')).toBeVisible()
  })

  test('switches to dark mode and keeps it', async ({ page }) => {
    await page.goto('/settings')

    await page.getByRole('button', { name: 'Fosc' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
  })

  /**
   * The navigation used to scroll away with the page on a long list, which on
   * the teacher panel meant scrolling back up to reach any other section.
   */
  test('keeps the navigation and the header in place while the content scrolls', async ({
    page,
  }) => {
    await signInAs(page, 'Coordinació')
    await page.goto('/teachers')
    await expect(page.getByRole('heading', { name: 'Càrrega del centre' })).toBeVisible()

    await page.locator('#main').evaluate((element) => element.scrollTo(0, element.scrollHeight))

    await expect(page.getByRole('navigation', { name: 'Navegació principal' })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Cerca global' })).toBeInViewport()
    // The page itself never scrolls: the content column owns the scrollbar.
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('opens the command palette with the keyboard and navigates with it', async ({ page }) => {
    await page.goto('/')
    // Wait for the shell to mount: the ⌘K listener lives in it.
    await expect(page.getByRole('heading', { name: 'Tauler' })).toBeVisible()

    await page.keyboard.press('ControlOrMeta+k')
    const dialog = page.getByRole('dialog', { name: 'Cerca global' })
    await expect(dialog).toBeVisible()

    await page.keyboard.type('assig')
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/subjects$/)
    await expect(page.getByRole('heading', { name: 'Assignatures' })).toBeVisible()
  })
})
