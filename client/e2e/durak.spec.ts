import { expect, test } from '@playwright/test'
import { createRoomWithBots, openHub } from './helpers'

test('hub rodo 3 zaidimo tipus ir 2 kalades dydzius; Durak pagal nutylejima 7-A', async ({ page }) => {
  await openHub(page)
  for (const type of ['fasiolas', 'nnn', 'durak']) {
    await expect(page.getByTestId(`game-type-${type}`)).toBeVisible()
  }
  await page.getByTestId('game-type-durak').click()
  await expect(page.getByTestId('deck-size-short')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('game-type-fasiolas').click()
  await expect(page.getByTestId('deck-size-full')).toHaveAttribute('aria-checked', 'true')
})

test('Durak: kambarys su botu startuoja, rankoje 6 kortos, stalas matomas', async ({ page }) => {
  await openHub(page)
  await createRoomWithBots(page, { gameType: 'durak', deckSize: 'short', bots: 1 })
  await expect(page.locator('.durakActionDock')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('durak-card')).toHaveCount(6)
  await expect(page.locator('.durakTable')).toBeVisible()
})

test('Durak: zaidziam ejimus - zaidimas nepakimba, JS klaidu nera', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openHub(page)
  await createRoomWithBots(page, { gameType: 'durak', deckSize: 'short', bots: 1 })
  await expect(page.locator('.durakActionDock')).toBeVisible({ timeout: 10_000 })
  const click = async (locator: ReturnType<typeof page.locator>): Promise<void> => {
    await locator.click({ timeout: 800 }).catch(() => {})
  }
  for (let i = 0; i < 20; i += 1) {
    if (!(await page.locator('.durakActionDock').count())) break
    const cards = page.locator('[data-testid="durak-card"]:not([disabled])')
    const n = await cards.count()
    if (n > 0) {
      await click(cards.nth(i % n))
      await click(page.locator('.durakPair.targetable').first())
      await click(page.getByTestId('durak-take'))
      await click(page.getByTestId('durak-done'))
    }
    await page.waitForTimeout(300)
  }
  expect(errors).toEqual([])
})

test('Fasiolas su 7-A kalade startuoja', async ({ page }) => {
  await openHub(page)
  await createRoomWithBots(page, { gameType: 'fasiolas', deckSize: 'short', bots: 1 })
  await expect(page.locator('.tableWindowOverlay, .tableWindow').first()).toBeVisible({ timeout: 10_000 })
})

test('ikonu mygtukai turi prieinamus pavadinimus (aria-label)', async ({ page }) => {
  await openHub(page)
  for (const name of ['Marketplace', 'Lyderiai', 'Kaip zaisti', 'Atsijungti']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: /garsa/i }).first()).toBeVisible()
  await createRoomWithBots(page, { gameType: 'durak', deckSize: 'short', bots: 1 })
  await expect(page.locator('.durakActionDock')).toBeVisible({ timeout: 10_000 })
  for (const name of ['Taisykles', 'Uzdaryti', 'Padidinti stalo mastele', 'Sumazinti stalo mastele']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Taisykles', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Zaidimo taisykles' })).toBeVisible()
  await page.getByRole('button', { name: 'Uzdaryti taisykles' }).click()
  await expect(page.getByRole('dialog', { name: 'Zaidimo taisykles' })).toHaveCount(0)
})
