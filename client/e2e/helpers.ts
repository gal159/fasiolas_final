import { expect, type Page } from '@playwright/test'

// Dev rezimas (?e2e=1) praleidzia auth ir veikejo pasirinkima: iskart hub'as.
export async function openHub(page: Page): Promise<void> {
  await page.goto('/?e2e=1')
  await expect(page.getByTestId('create-room')).toBeVisible({ timeout: 15_000 })
}

export async function createRoomWithBots(
  page: Page,
  options: { gameType: 'fasiolas' | 'nnn' | 'durak'; deckSize?: 'full' | 'short'; bots: number },
): Promise<void> {
  await page.getByTestId(`game-type-${options.gameType}`).click()
  if (options.deckSize) {
    await page.getByTestId(`deck-size-${options.deckSize}`).click()
  }
  await page.getByTestId('create-room').click()
  await expect(page.getByTestId('add-bot')).toBeVisible()
  for (let i = 0; i < options.bots; i += 1) {
    await page.getByTestId('add-bot').click()
  }
  await page.getByTestId('start-game').click()
}

// Nustato rankas per testavimo API (reikia E2E_TEST_API=1 serveryje).
export async function setHands(
  page: Page,
  body: {
    roomCode: string
    hands: Record<string, { suit: 'S' | 'H' | 'D' | 'C'; rank: string }[]>
    trumpSuit?: 'S' | 'H' | 'D' | 'C'
    currentTurnPlayerId?: string
  },
): Promise<void> {
  const response = await page.request.post('http://localhost:3001/test/set-hands', {
    headers: { 'x-app-secret': process.env.APP_SECRET ?? 'dev-secret-change-me' },
    data: body,
  })
  expect(response.ok()).toBeTruthy()
}
