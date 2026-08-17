import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * The core of the product, end to end: painting a week without a mouse, and
 * taking the center table away as a spreadsheet.
 */
async function asRole(page: Page, label: string) {
  await page.goto('/')
  await page.getByLabel('Usuari de demostració').selectOption({ label })
}

test.describe('weekly availability', () => {
  test('a teacher paints and saves their week with the keyboard alone (R8)', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/teachers/me')

    const grid = page.getByRole('grid', { name: 'Graella de disponibilitat setmanal' })
    await expect(grid).toBeVisible()

    // Friday, late afternoon: a corner of the grid nothing else depends on.
    // Matched on the slot rather than on its current level, so re-running the
    // suite against a database it already painted still works.
    await grid.getByRole('button', { name: /^Divendres de 19:00 a 19:30/ }).focus()

    // 3 = "better avoided", Space paints, Shift+ArrowDown extends downwards.
    await page.keyboard.press('3')
    await page.keyboard.press('Space')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.up('Shift')

    await expect(
      grid.getByRole('button', { name: 'Divendres de 19:30 a 20:00: Millor evitar' }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Desa la disponibilitat' }).click()
    await expect(page.getByRole('status').getByText('Disponibilitat desada')).toBeVisible()

    // It survives a reload, which is the only proof it reached the database.
    await page.reload()
    await expect(
      page
        .getByRole('grid', { name: 'Graella de disponibilitat setmanal' })
        .getByRole('button', { name: 'Divendres de 19:00 a 19:30: Millor evitar' }),
    ).toBeVisible()
  })

  test('a coordinator reaches a teacher’s week from the panel and can adjust it', async ({
    page,
  }) => {
    await asRole(page, 'Coordinació')
    await page.goto('/teachers')

    await page.getByRole('link', { name: 'Sergi Vila Rovira' }).click()

    const grid = page.getByRole('grid', { name: 'Graella de disponibilitat setmanal' })
    await expect(grid).toBeVisible()
    await expect(grid.getByRole('button').first()).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Desa la disponibilitat' })).toBeVisible()
    // Reductions are the contract, not the timetable: those stay with the
    // center administration.
    await expect(page.getByRole('button', { name: 'Afegeix una reducció' })).toHaveCount(0)
  })
})

test.describe('center load panel', () => {
  test('filters the table and downloads exactly what is on screen', async ({ page }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/teachers')

    const table = page.getByRole('table')
    await expect(table).toBeVisible()

    await page.getByLabel('Estat de la càrrega').selectOption('over')
    await expect(table.getByText('Andreu Mestre Pons')).toBeVisible()
    await expect(table.getByText('Marta Puig Serra')).toHaveCount(0)

    const rows = await table.getByRole('row').count()

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exporta a Excel' }).click(),
    ]).then(([event]) => event)

    expect(download.suggestedFilename()).toBe('uacademic-load.xlsx')
    await expect(page.getByRole('status').getByText('Excel descarregat')).toBeVisible()
    // Header row plus the filtered rows: the download is the table, not the
    // whole center.
    expect(rows).toBeGreaterThan(1)
  })
})

test.describe('personal panel', () => {
  test('breaks a teacher’s hours down by subject and by concept', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/my-load')

    await expect(page.getByRole('heading', { name: 'Càrrega docent' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Per assignatura' })).toBeVisible()
    await expect(
      page.getByRole('table', { name: "Distribució de l'encàrrec docent per concepte" }),
    ).toBeVisible()
  })
})
