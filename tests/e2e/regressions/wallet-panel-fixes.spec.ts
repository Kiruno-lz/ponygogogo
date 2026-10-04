import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'
import { addAuthenticator, registerAs, stubChain } from '../walletHarness.ts'

test('登录木牌文字更倾斜且横向空间充足，钱包面板移除整个签名账户字段', async ({ page }, info) => {
  await addAuthenticator(page)
  await stubChain(page)
  await open(page)
  await enterHome(page)
  await registerAs(page, '小马仔')
  await expect(page.getByTestId('balance')).toContainText('1.00 MON')
  await expect(page.getByTestId('wallet-label')).toHaveText(/^0x[0-9a-fA-F]{8}…[0-9a-fA-F]{4}$/)
  await page.screenshot({ path: info.outputPath('wallet-before-open.png') })
  const layout = await page.getByTestId('wallet-open').evaluate(el => {
    const style = getComputedStyle(el), m = new DOMMatrix(style.transform)
    const label = el.querySelector<HTMLElement>('[data-testid="wallet-label"]')!
    return { angle: Math.atan2(m.b, m.a) * 180 / Math.PI, width: parseFloat(style.width), top: parseFloat(style.top),
      labelSize: parseFloat(getComputedStyle(label).fontSize),
      rowsFit: Array.from(el.querySelectorAll('.wallet-row')).every(row => row.scrollWidth <= row.clientWidth) }
  })
  expect(layout.angle).toBeCloseTo(-8, 1)
  expect(layout.top).toBe(46)
  expect(layout.labelSize).toBe(19)
  expect(layout.width).toBeGreaterThanOrEqual(255)
  expect(layout.rowsFit).toBe(true)
  await page.getByTestId('wallet-open').click()
  await expect(page.getByTestId('wallet-modal')).toBeVisible()
  await expect(page.getByTestId('wallet-signer-address')).toHaveCount(0)
  await expect(page.getByText('签名账户', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('wallet-address')).toBeVisible()
  await expect(page.getByText('独立智能账户：测试币、下注支付和奖金都在这里，Gas 由游戏代付。', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('wallet-panel.png') })
})
