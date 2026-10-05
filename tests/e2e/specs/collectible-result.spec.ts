import { expect, test } from '@playwright/test'
type Fixture = { confirm(kind?: number, id?: number): void; rerender(): void; language(lang: 'zh' | 'en'): void; ledgerOutage(): void; noGrant(phase: 'settled' | 'forfeited' | 'practice'): void }
declare global { interface Window { collectibleFixture: Fixture } }

test('confirmed receipt opens one collectible modal; keeping restores focus and rerenders do not reopen it', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/collectible-result.html')
  await expect(page.getByTestId('collectible-dialog')).toHaveCount(0)
  await page.getByTestId('result-btn-home').focus()
  await page.evaluate(() => window.collectibleFixture.confirm())
  const modal = page.getByTestId('collectible-dialog')
  await expect(modal).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Reveal collectible' })).toBeFocused()
  await modal.getByRole('button', { name: 'Reveal collectible' }).click()
  await expect(modal.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'revealed')
  await expect(modal).toContainText('New rare card')
  await expect(modal).toContainText('Added to collection')
  await expect(modal.locator('[data-card="C-02"]')).toBeVisible()
  await expect(modal.getByRole('button', { name: 'Keep it' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(modal.getByRole('button', { name: 'Keep it' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Keep it' }).click()
  await expect(modal).toHaveCount(0)
  await expect(page.getByTestId('result-btn-home')).toBeFocused()
  await page.evaluate(() => { window.collectibleFixture.rerender(); window.collectibleFixture.language('zh') })
  await expect(modal).toHaveCount(0)
  await expect(page.getByTestId('settle-stamp')).toContainText('已结算')
})

test('confirmed grant regenerates an open poster; its window leaves hero, medal and QR pixels untouched', async ({ page }, info) => {
  await page.setViewportSize({ width: 1620, height: 971 })
  await page.goto('/tests/e2e/fixtures/collectible-result.html')
  // Compare with the exact same confirmed financial result but no collectible.
  await page.evaluate(() => window.collectibleFixture.noGrant('settled'))
  await page.getByTestId('result-btn-share').focus()
  await page.getByTestId('result-btn-share').press('Enter')
  const poster = page.getByTestId('share-poster')
  await expect(poster).toBeVisible()
  const before = await poster.getAttribute('src')
  const original = await page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('[data-testid="share-poster"]')!
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    return canvas.toDataURL()
  })
  await page.evaluate(() => window.collectibleFixture.confirm())
  const modal = page.getByTestId('collectible-dialog')
  await expect(modal).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'Reveal collectible' }).click()
  await expect(modal.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'revealed')
  await modal.getByRole('button', { name: 'Keep it' }).click()
  await expect(modal).toHaveCount(0)
  await expect(page.getByTestId('share-close')).toBeFocused()
  await expect(poster).toHaveAttribute('alt', /Rare card:/)
  await expect(poster).not.toHaveAttribute('src', before!)
  const comparison = await page.evaluate(async original => {
    const current = document.querySelector<HTMLImageElement>('[data-testid="share-poster"]')!
    const previous = new Image(); previous.src = original; await previous.decode()
    const canvas = document.createElement('canvas'); canvas.width = 1620; canvas.height = 971
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(previous, 0, 0); const old = ctx.getImageData(0, 0, 1620, 971).data
    ctx.clearRect(0, 0, 1620, 971); ctx.drawImage(current, 0, 0); const next = ctx.getImageData(0, 0, 1620, 971).data
    let outside = 0, inside = 0
    for (let y = 0; y < 971; y++) for (let x = 0; x < 1620; x++) {
      const i = (y * 1620 + x) * 4
      if (!Array.from(old.subarray(i, i + 4)).some((value, j) => value !== next[i + j])) continue
      if (x >= 1117 && x <= 1589 && y >= 699 && y <= 934) inside++
      else outside++
    }
    return { outside, inside }
  }, original)
  expect(comparison.inside).toBeGreaterThan(5000)
  expect(comparison.outside).toBe(0)
  await page.screenshot({ path: info.outputPath('collectible-poster.png') })
  await page.getByTestId('share-close').click()
  await expect(page.getByTestId('result-btn-share')).toBeFocused()
})

test('no grant, forfeits and practice never show a collectible modal', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/collectible-result.html')
  for (const phase of ['settled', 'forfeited', 'practice'] as const) {
    await page.evaluate(phase => window.collectibleFixture.noGrant(phase), phase)
    await expect(page.getByTestId('collectible-dialog')).toHaveCount(0)
    await page.getByTestId('result-btn-share').click()
    await expect(page.getByTestId('share-poster')).toBeVisible()
    await expect(page.getByTestId('share-poster')).not.toHaveAttribute('alt', /Rare card:|Pony:/)
    await page.keyboard.press('Escape')
  }
})

test('unread reward information preserves confirmed payout and can be recovered without retrying settlement', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/collectible-result.html')
  await page.evaluate(() => window.collectibleFixture.ledgerOutage())
  await expect(page.getByTestId('collectible-dialog')).toHaveCount(0)
  await expect(page.getByTestId('settle-stamp')).toHaveAttribute('data-phase', 'settled')
  await expect(page.getByTestId('result-prize')).toHaveText('0.0750 MON')
  await expect(page.getByTestId('settle-detail')).toContainText('Payout confirmed')
  await expect(page.getByTestId('settle-retry')).toHaveCount(0)
  await page.getByTestId('grant-retry').click()
  await expect(page.getByTestId('collectible-dialog')).toBeVisible()
  await expect(page.getByTestId('grant-retry')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('collectible-dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Reveal collectible' }).click()
  await expect(page.locator('.collectible-panel')).toHaveAttribute('data-reveal-phase', 'revealed')
  await page.getByRole('button', { name: 'Keep it' }).click()
  await expect(page.getByTestId('result-prize')).toHaveText('0.0750 MON')
})
