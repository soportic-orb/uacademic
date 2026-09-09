import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * The frame stays the frame.
 *
 * The shell is exactly one screen tall and the content column is the only
 * thing that scrolls, so the sidebar and the header are always where they
 * were. When the page itself scrolls instead, the sidebar rides up and below
 * it comes a band of bare background — reported from the planner twice, and
 * caused by absolutely positioned boxes (every `sr-only` label and live region
 * is one) measured against the page rather than against the column they live
 * in: hiding overflow does not clip a box whose containing block is outside
 * the box doing the hiding.
 *
 * So this asserts the invariant rather than the cause: whatever a screen puts
 * on itself, scrolling it must not scroll the document.
 */
async function asRole(page: Page, label: string) {
  await page.goto('/')
  await page.getByLabel('Usuari de demostració').selectOption({ label })
}

/** The shell, once it is actually on screen: a skeleton has no sidebar yet. */
async function shellReady(page: Page) {
  await expect(page.getByRole('navigation', { name: 'Navegació principal' })).toBeVisible()
}

async function scrollContentToTheEnd(page: Page) {
  await page.evaluate(() => {
    const main = document.querySelector('main')
    if (main) main.scrollTop = main.scrollHeight
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  // A scroll is not instant, and neither is what it triggers.
  await page.waitForTimeout(300)
}

async function frame(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label]')
    const main = document.querySelector('main')
    return {
      documentHeight: document.documentElement.scrollHeight,
      viewport: window.innerHeight,
      pageScrolled: window.scrollY,
      sidebarBottom: nav ? Math.round(nav.getBoundingClientRect().bottom) : null,
      contentScrolled: main ? main.scrollTop : 0,
    }
  })
}

test.describe('the shell', () => {
  test('scrolls its content without scrolling the page (the planner is the tall one)', async ({
    page,
  }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/planning')
    await shellReady(page)
    await expect(page.getByRole('grid', { name: 'Graella setmanal de planificació' })).toBeVisible()

    await scrollContentToTheEnd(page)
    const measured = await frame(page)

    // The screen is long enough for this to mean something.
    expect(measured.contentScrolled).toBeGreaterThan(0)
    // And the page underneath it did not move.
    expect(measured.documentHeight).toBe(measured.viewport)
    expect(measured.pageScrolled).toBe(0)
    // The sidebar still reaches the bottom of the screen: no grey band under it.
    expect(measured.sidebarBottom).toBe(measured.viewport)
  })

  test('keeps the frame on every screen a person scrolls', async ({ page }) => {
    await asRole(page, 'Coordinació')

    for (const path of ['/', '/calendar', '/programme', '/profile']) {
      await page.goto(path)
      await shellReady(page)
      await page.waitForLoadState('networkidle')
      await scrollContentToTheEnd(page)

      const measured = await frame(page)
      expect(measured, path).toMatchObject({
        documentHeight: measured.viewport,
        pageScrolled: 0,
        sidebarBottom: measured.viewport,
      })
    }
  })
})
