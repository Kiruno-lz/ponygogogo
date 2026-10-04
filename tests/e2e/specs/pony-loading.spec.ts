import { expect, test, type Route } from '@playwright/test'
import { enterHome } from '../helpers.ts'

test('cancelling a page resource gate prevents its late navigation', async ({ page }) => {
  const held: Route[] = []
  await page.route('**/art/effects/blackhole-sheet.webp', route => { held.push(route) })
  await page.goto('/')
  await enterHome(page)
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('tier-gate')).toBeVisible()
  await expect.poll(() => held.length).toBe(1)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tier-gate')).toHaveCount(0)
  await held[0]!.continue()
  await page.waitForTimeout(600)
  await expect(page.getByTestId('screen-home')).toBeVisible()
  await expect(page.getByTestId('screen-select')).toHaveCount(0)
})

test('participant preflight is modal and cancelling it prevents a late race entry', async ({ page }) => {
  const held: Route[] = []
  await page.route('**/art/ponies/0-running.webp', route => { held.push(route) })
  await page.goto('/')
  await enterHome(page)
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  await page.getByTestId('horse-0').click()
  const lane = Number(await page.getByTestId('horse-0').getAttribute('data-lane'))
  await page.locator('button.btn-star').last().click()
  await expect(page.getByTestId('tier-gate')).toBeVisible()
  await expect.poll(() => held.length).toBe(1)
  await page.evaluate(key => document.body.dispatchEvent(new KeyboardEvent('keydown',{key,code:key,bubbles:true})), lane === 0 ? 'ArrowUp' : 'ArrowDown')
  await expect(page.getByTestId('horse-0')).toHaveAttribute('aria-pressed','true')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tier-gate')).toHaveCount(0)
  await held[0]!.continue()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  await expect(page.getByTestId('screen-race')).toHaveCount(0)
})
