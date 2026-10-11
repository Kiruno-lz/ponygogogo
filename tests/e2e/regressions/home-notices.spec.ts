import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'
import { addAuthenticator, registerAs, stubChain } from '../walletHarness.ts'

async function cancelPasskeys(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.credentials, 'get', { value: async () => { throw new DOMException('cancelled', 'NotAllowedError') } })
  })
  await stubChain(page)
  await open(page)
  await enterHome(page)
}

test('cancelled login translates on language change and expires after five seconds', async ({ page }) => {
  await cancelPasskeys(page)
  await page.clock.install()
  await page.locator('.home-login').click()
  const error = page.getByTestId('wallet-error')
  await expect(error).toHaveText('通行密钥操作被取消了')
  await page.locator('.home-settings').focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'English', exact: true }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Escape')
  await expect(error).toHaveText('The passkey prompt was cancelled')
  await page.clock.runFor(5000)
  await expect(error).toHaveCount(0)
  await page.locator('.home-login').click()
  await expect(error).toHaveText('The passkey prompt was cancelled')
  await page.mouse.click(20, 700)
  await expect(error).toHaveCount(0)
})

test('repeated cancellation gets a full lifetime and an older timer cannot dismiss it', async ({ page }) => {
  await cancelPasskeys(page)
  await page.clock.install()
  const error = page.getByTestId('wallet-error')
  await page.locator('.home-login').click()
  await expect(error).toBeVisible()
  await page.clock.runFor(4000)
  await page.locator('.home-login').click()
  await expect(error).toBeVisible()
  await page.clock.runFor(1000)
  await expect(error).toBeVisible()
  await page.clock.runFor(4000)
  await expect(error).toHaveCount(0)
})

test('registration status translates while visible and expires through the shared notice', async ({ page }) => {
  await addAuthenticator(page)
  await stubChain(page)
  await open(page)
  await enterHome(page)
  await page.clock.install()
  await registerAs(page, '通知翻译测试')
  const notice = page.getByTestId('notice')
  await expect(notice).toHaveText('测试币已到账')
  await page.locator('.home-settings').focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'English', exact: true }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Escape')
  await expect(notice).toHaveText('Test MON received')
  await page.clock.runFor(5000)
  await expect(notice).toHaveCount(0)
})
