import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1619, height: 971 })
  await page.goto('/tests/e2e/fixtures/pony-selection.html')
})

test('queue scrolling keeps flags fixed and submits visible roster with lower lane zero', async ({ page }) => {
  const flags = await page.locator('.lane-pennant').evaluateAll(items => items.map(el => el.getBoundingClientRect().top))
  await expect(page.getByTestId('pony-queue-down')).toBeDisabled()
  await page.getByTestId('pony-queue-up').click()
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  expect(await page.locator('.lane-pennant').evaluateAll(items => items.map(el => el.getBoundingClientRect().top))).toEqual(flags)
  await expect(page.getByTestId('horse-5')).toHaveAttribute('data-lane', '0')
  await page.getByTestId('horse-5').click()
  await page.locator('.select-race-cta button').click()
  await expect(page.getByTestId('entry-capture')).toHaveText('{"playerHorseId":0,"tier":0,"roster":[5,4,3,2,1]}')
})

test('keyboard moves ring alone in middle and queue alone at lower edge', async ({ page }) => {
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('horse-2')).toHaveAttribute('aria-pressed', 'true')
  const ring = page.getByTestId('selection-ring')
  const before = await ring.boundingBox()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'ring')
  await page.waitForTimeout(150)
  const middle = await ring.boundingBox()
  expect(middle!.y).toBeGreaterThan(before!.y)
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  await page.getByTestId('horse-4').click()
  const edge = await ring.boundingBox()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'queueFixedRing')
  expect((await ring.boundingBox())!.y).toBeCloseTo(edge!.y, 1)
  await expect(page.getByTestId('horse-5')).toHaveAttribute('aria-pressed', 'true')
})

test('direct click has no ring transition and animation executes only latest pending input', async ({ page }) => {
  await page.getByTestId('horse-1').click()
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  await page.getByTestId('pony-queue-up').click()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
  await expect(page.getByTestId('horse-2')).toHaveAttribute('aria-pressed', 'true')
})

test('reduced motion reaches the final queue and selection without an animation wait', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/pony-selection.html?reduced=1')
  await page.getByTestId('pony-queue-up').click()
  await expect(page.getByTestId('horse-5')).toHaveAttribute('data-lane', '0')
  await expect(page.getByTestId('pony-selection-column')).toHaveAttribute('data-motion', 'none')
})
