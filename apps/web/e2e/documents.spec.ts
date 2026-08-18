import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * Phase 5B end to end.
 *
 * What is checked here is what a browser can see and a unit test cannot: that
 * the library is the same screen for two audiences with different powers, that
 * a citation address opens the document it names, and that nobody is offered a
 * file by URL. Extraction, indexing and retrieval are the API suite's job.
 */
const SEEDED = 'Normativa d’ordenació docent 2026-2027'

async function asRole(page: Page, label: string) {
  await page.goto('/')
  await page.getByLabel('Usuari de demostració').selectOption({ label })
}

test.describe('the document library', () => {
  test('lets the administration file documents, with the student-data warning first', async ({
    page,
  }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/documents')

    await expect(page.getByRole('heading', { name: 'Documents', level: 1 })).toBeVisible()
    await expect(page.getByText(/No pugis llistats d’alumnes/)).toBeVisible()
    await expect(page.getByLabel('Vigent des de')).toBeVisible()
    await expect(page.getByLabel('Vigent fins a')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Puja un document' })).toBeVisible()
  })

  test('shows the teacher the repository and no way to file anything', async ({ page }) => {
    await asRole(page, 'Professorat')
    await page.goto('/documents')

    await expect(page.getByRole('button', { name: SEEDED })).toBeVisible()
    await expect(page.getByText(/No pugis llistats d’alumnes/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Puja un document' })).toHaveCount(0)
  })

  test('filters by validity, so an expired document is not offered as current', async ({
    page,
  }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/documents')

    await page.getByLabel('Vigència').selectOption('current')
    await expect(page.getByRole('button', { name: SEEDED })).toBeVisible()

    await page.getByLabel('Vigència').selectOption('expired')
    await expect(page.getByRole('button', { name: SEEDED })).toHaveCount(0)
    await expect(page.getByText('Encara no hi ha cap document.')).toBeVisible()
  })

  test('opens the viewer at the address a citation would produce', async ({ page }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/documents')

    // The id is not guessable from the outside, so take it the way the
    // assistant does: from the row that names the document.
    await page.getByRole('button', { name: SEEDED }).click()
    await expect(page).toHaveURL(/\?doc=/)

    const viewer = page.getByRole('heading', { name: SEEDED, level: 2 })
    await expect(viewer).toBeVisible()
    await expect(page.getByRole('button', { name: 'Obre el fitxer original' })).toBeVisible()
  })

  test('serves no file by URL, whoever asks', async ({ page, request }) => {
    await asRole(page, 'Administració del centre')
    await page.goto('/documents')
    await page.getByRole('button', { name: SEEDED }).click()

    const id = new URL(page.url()).searchParams.get('doc')
    expect(id).toBeTruthy()

    // A fresh client with no session gets nothing: the file lives outside the
    // webroot and the route is the only door.
    const anonymous = await request.get(`http://127.0.0.1:3001/api/v1/documents/${id}/file`)
    expect([401, 403]).toContain(anonymous.status())
  })
})
