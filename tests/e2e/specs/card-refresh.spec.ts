import { expect, test } from '@playwright/test'

test('刷新按钮常驻：无次数灰色禁用，有次数黄色可点，耗尽后恢复灰色', async ({ page }, testInfo) => {
  await page.goto('/tests/e2e/fixtures/new-cards.html')
  await page.getByRole('button', { name: 'choice', exact: true }).click()
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId(`card-choice-${i}`)).toHaveCSS('opacity', '1')
    const button = page.getByTestId(`card-refresh-${i}`)
    await expect(button).toBeVisible()
    await expect(button).toBeDisabled()
    await expect(button).toHaveCSS('filter', /grayscale\(1\)/)
  }
  // A real pointer click on a disabled control must neither refresh nor select its card.
  const button = page.getByTestId('card-refresh-0')
  const box = (await button.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('picked')).toHaveText('')
  await page.screenshot({ path: testInfo.outputPath('refresh-disabled.png') })

  await page.getByRole('button', { name: 'grant refresh', exact: true }).click()
  for (let i = 0; i < 3; i++) {
    const available = page.getByTestId(`card-refresh-${i}`)
    await expect(available).toBeEnabled()
    await expect(available).toHaveCSS('filter', 'none')
    await expect(available).toHaveCSS('background-image', /bet-chip-selected-trimmed\.webp/)
  }
  await page.screenshot({ path: testInfo.outputPath('refresh-enabled.png') })
  await button.click()
  await expect(page.getByTestId('picked')).toHaveText('refresh-0')
  for (let i = 0; i < 3; i++) {
    const spent = page.getByTestId(`card-refresh-${i}`)
    await expect(spent).toBeVisible()
    await expect(spent).toBeDisabled()
    await expect(spent).toHaveCSS('filter', /grayscale\(1\)/)
  }
})
