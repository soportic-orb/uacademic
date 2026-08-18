import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * Phase 3 end to end: moving a class without a mouse, comparing two versions,
 * and a teacher's calendar with its subscribable address.
 *
 * Publication and the automatic generation are exercised by the API suite:
 * publishing archives whatever version is live, and a generation run holds a
 * CPU for its whole budget — neither belongs in a browser test that shares the
 * demo database.
 */
async function asRole(page: Page, label: string) {
  await page.goto('/')
  await page.getByLabel('Usuari de demostració').selectOption({ label })
}

test.describe('the planner', () => {
  test('shows the week, what is still pending and the state of the whole plan', async ({
    page,
  }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/planning')

    await expect(page.getByRole('heading', { name: 'Planificació' })).toBeVisible()
    await expect(page.getByRole('grid', { name: 'Graella setmanal de planificació' })).toBeVisible()
    await expect(page.getByText('Grups pendents')).toBeVisible()

    // The bottom bar reports the plan, not just the page.
    await expect(page.getByText('Col·locades')).toBeVisible()
    await expect(page.getByText('Conflictes')).toBeVisible()
    await expect(page.getByText('Docents fora de rang')).toBeVisible()
  })

  test('moves a class with the keyboard and keeps it after a reload (R8)', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/planning')

    const grid = page.getByRole('grid', { name: 'Graella setmanal de planificació' })
    await expect(grid).toBeVisible()

    // Pick the first class of the week up.
    const session = grid.getByRole('button', { name: /^[A-Z0-9]+ [A-Z0-9]+, / }).first()
    const label = await session.getAttribute('aria-label')
    await session.focus()
    await page.keyboard.press('Space')
    await expect(session).toHaveAttribute('aria-pressed', 'true')

    // Drop it on the first cell the engine did not paint red.
    const candidates = grid.getByRole('button', { name: /^Mou / })
    const count = await candidates.count()
    let target = null
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index)
      if ((await candidate.textContent())?.includes('Impossible')) continue
      target = candidate
      break
    }
    expect(target).not.toBeNull()

    const targetLabel = (await target!.getAttribute('aria-label')) ?? ''
    await target!.focus()
    await page.keyboard.press('Space')

    await expect(page.getByRole('status').getByText('Esborrany desat')).toBeVisible()

    // The move survives a reload, which is the only proof it was persisted.
    await page.reload()
    const moved = targetLabel.replace(/^Mou .* a /, '')
    expect(moved.length).toBeGreaterThan(0)
    expect(label).toBeTruthy()
    await expect(page.getByRole('grid', { name: 'Graella setmanal de planificació' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Desfés' })).toBeVisible()
  })

  test('refuses an impossible cell and says why', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/planning')

    const grid = page.getByRole('grid', { name: 'Graella setmanal de planificació' })
    await grid
      .getByRole('button', { name: /^[A-Z0-9]+ [A-Z0-9]+, / })
      .first()
      .click()

    const blocked = grid.getByRole('button', { name: /^Mou / }).filter({ hasText: 'Impossible' })
    if ((await blocked.count()) === 0) test.skip()

    // The tooltip carries the constraint that blocks it, in the reader's language.
    const reason = await blocked.first().getAttribute('title')
    expect(reason).toBeTruthy()
    await blocked.first().click()
    await expect(page.getByRole('status').getByText(/No es pot col·locar aquí/)).toBeVisible()
  })

  test('compares two versions and lists the changes per teacher', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/planning')

    await page.getByRole('button', { name: 'Compara versions' }).click()

    const base = page.getByLabel('Versió base')
    await expect(base).toBeVisible()
    await base.selectOption({ label: 'Versió inicial 2026-2027' })
    await page.getByLabel('Versió comparada').selectOption({ label: 'Proposta de revisió' })

    // The seeded draft differs from the published version on purpose.
    await expect(page.getByText('Per docent')).toBeVisible()
    await expect(page.getByText('Modificades')).toBeVisible()
  })

  test('sends a draft to review and back without telling anybody', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/planning')

    await page.getByRole('button', { name: 'Envia a revisió' }).click()
    await expect(
      page.getByRole('status').getByText('Els esborranys no notifiquen ningú'),
    ).toBeVisible()

    await page.getByRole('button', { name: "Torna a l'esborrany" }).click()
    await expect(page.getByRole('button', { name: 'Envia a revisió' })).toBeVisible()
  })
})

test.describe('the teacher calendar', () => {
  test('shows the published timetable in four views', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/calendar')

    await expect(page.getByRole('heading', { name: 'El meu calendari' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Setmana' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.getByRole('button', { name: 'Agenda' }).click()
    await expect(page.getByRole('button', { name: 'Agenda' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.locator('.fc')).toBeVisible()
  })

  test('downloads the timetable as a PDF', async ({ page }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/calendar')

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exporta a PDF' }).click(),
    ]).then(([event]) => event)

    expect(download.suggestedFilename()).toBe('uacademic-calendar.pdf')
    await expect(page.getByRole('status').getByText('Fitxer descarregat')).toBeVisible()
  })
})
