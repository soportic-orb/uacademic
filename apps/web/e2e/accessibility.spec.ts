import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * WCAG 2.2 AA as an acceptance criterion (R8), checked by a machine on every
 * push rather than remembered by a person before a release.
 *
 * axe finds what a machine can find: contrast, missing labels, broken
 * landmarks, a table without headers. It cannot tell whether the planner is
 * usable from a keyboard — that is asserted in `planning.spec.ts`, which moves
 * a class with the arrow keys — or whether an announcement makes sense out
 * loud. The two together are the criterion; neither alone is.
 *
 * Both themes are scanned: dark mode is not an inversion, it has its own
 * palette, and a contrast failure there is just as real.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function asRole(page: Page, label: string) {
  await page.goto('/')
  await page.getByLabel('Usuari de demostració').selectOption({ label })
}

async function scan(page: Page, url: string) {
  await page.goto(url)
  // The page is only worth scanning once it has rendered its content rather
  // than its skeletons.
  await page.waitForLoadState('networkidle')

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')).slice(0, 5),
  }))
}

test.describe('accessibility', () => {
  const SCREENS = [
    { role: 'Coordinació', url: '/', name: 'dashboard' },
    { role: 'Coordinació', url: '/planning', name: 'planner' },
    { role: 'Coordinació', url: '/teachers', name: 'teachers' },
    { role: 'Professorat', url: '/my-load', name: 'my load' },
    { role: 'Professorat', url: '/calendar', name: 'calendar' },
    { role: 'Professorat', url: '/messages', name: 'messages' },
    { role: 'Professorat', url: '/privacy', name: 'privacy' },
    { role: 'Administració del centre', url: '/documents', name: 'documents' },
    { role: 'Administració del centre', url: '/settings', name: 'settings' },
  ]

  for (const screen of SCREENS) {
    test(`${screen.name} has no violations a machine can see`, async ({ page }) => {
      await asRole(page, screen.role)
      const violations = await scan(page, screen.url)

      expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
    })
  }

  test('dark mode keeps its contrast', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Fosc' }).click()

    const violations = await scan(page, '/')
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
  })
})
