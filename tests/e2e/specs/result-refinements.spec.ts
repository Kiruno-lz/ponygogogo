import { expect, test } from '@playwright/test'

test('result amounts keep one decimal, name moves eight pixels, and confirmed rank fades after 1.2 seconds', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/collectible-result.html')
  await expect(page.getByTestId('screen-result')).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.result-artboard img'), image => image.decode()))
  })
  await page.evaluate(() => {
    window.collectibleFixture.language('zh')
    window.collectibleFixture.noGrant('settled')
  })
  await expect(page.getByTestId('result-prize')).toHaveText('0.0 MON')
  await expect(page.getByTestId('result-net-value')).toHaveText('+0.0')
  await expect(page.locator('.result-name')).toHaveCSS('top', '235px')
  const verify = page.getByTestId('result-verify')
  await expect(verify).toContainText('链上结算名次 1')
  const timing = await verify.evaluate(el => {
    const animation = el.getAnimations()[0]!
    animation.pause()
    animation.currentTime = 1199
    const before = getComputedStyle(el).opacity
    animation.currentTime = 1450
    const during = getComputedStyle(el).opacity
    animation.currentTime = 1700
    return { before, during: Number(during), after: getComputedStyle(el).opacity }
  })
  expect(timing.before).toBe('1')
  expect(timing.during).toBeGreaterThan(0)
  expect(timing.during).toBeLessThan(1)
  expect(timing.after).toBe('0')
  await page.evaluate(() => window.collectibleFixture.noGrant('settled', { stake: 300_000_000_000_000_000n, payout: 900_000_000_000_000_000n }))
  await expect(page.getByTestId('result-prize')).toHaveText('0.9 MON')
  await expect(page.getByTestId('result-net-value')).toHaveText('+0.6')
  // An ordinary payout rerender must not show the expired rank notice again.
  await expect(verify).toHaveCSS('opacity', '0')
  await page.screenshot({ path: 'tests/e2e/screenshots/result-refinements.png' })
})
