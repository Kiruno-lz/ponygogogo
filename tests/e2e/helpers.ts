import { expect, type Page } from '@playwright/test'

export const FAST = 'mockDelay=0&raceSpeed=16'

export async function open(page: Page, query = FAST): Promise<void> {
  await page.goto(`/?${query}`)
  await expect(page.getByTestId('screen-loading')).toBeVisible()
}

export async function enterHome(page: Page): Promise<void> {
  await expect(page.getByTestId('loading-progress')).toContainText('100%', { timeout: 30_000 })
  await page.getByRole('button', { name: /进入游戏|Enter/ }).click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
}

export async function startRace(page: Page, horseId = 0, tierIndex = 1): Promise<void> {
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  await page.getByTestId(`horse-${horseId}`).click()
  await page.getByTestId('bet-panel').locator('.chip').nth(tierIndex).click()
  await page.locator('button.btn-star').last().click()
}

/** 用现实节奏驱动 gogo，直到比赛结束或超时 */
export async function playUntilResult(page: Page, pickIndex = 0): Promise<void> {
  const deadline = Date.now() + 90_000
  await page.evaluate(() => {
    const w = window as unknown as { __rhythm?: number }
    w.__rhythm = window.setInterval(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })), 30)
    }, 500)
  })
  while (Date.now() < deadline) {
    if (await page.getByTestId('screen-result').isVisible().catch(() => false)) break
    const panel = page.getByTestId('card-panel')
    if (await panel.isVisible().catch(() => false)) {
      const card = page.getByTestId(`card-choice-${pickIndex}`)
      if (await card.isVisible().catch(() => false)) {
        await card.locator('.card-root').click({ timeout: 5000 }).catch(() => undefined)
      }
    }
    await page.waitForTimeout(250)
  }
  await page.evaluate(() => {
    const w = window as unknown as { __rhythm?: number }
    if (w.__rhythm) window.clearInterval(w.__rhythm)
  })
  await expect(page.getByTestId('screen-result')).toBeVisible({ timeout: 30_000 })
}

export async function noConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return errors
}
