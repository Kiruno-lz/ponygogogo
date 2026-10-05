import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'
import { addAuthenticator, registerAs, stubChain } from '../walletHarness.ts'

test('collection sync notice grows 50px about its center, dismisses after 5s or outside click, and can retry', async ({ page }, info) => {
  await addAuthenticator(page)
  await stubChain(page)
  await page.route('**/api/collection/**', route => route.fulfill({ status: 503, body: 'unavailable' }))
  await open(page, 'mockDelay=0')
  await enterHome(page)
  await registerAs(page, 'notice test')
  await page.clock.install()
  const showError = async () => {
    await page.getByRole('button', { name: /卡牌图鉴/ }).click()
    await page.getByRole('button', { name: '读取收藏', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('图鉴尚未同步成功')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.getByTestId('notice')).toBeVisible()
  }
  await showError()
  const notice = page.getByTestId('notice')
  const geometry = await notice.evaluate(el => {
    const box = el.getBoundingClientRect()
    const baseline = el.cloneNode(true) as HTMLElement
    Object.assign(baseline.style, { top: '40px', padding: '4px 24px' })
    el.parentElement!.append(baseline)
    const original = baseline.getBoundingClientRect()
    const scale = box.width / (el as HTMLElement).offsetWidth
    baseline.remove()
    return { growth: (box.height - original.height) / scale, centerShift: (box.y + box.height / 2 - original.y - original.height / 2) / scale }
  })
  expect(geometry.growth).toBeCloseTo(50)
  expect(geometry.centerShift).toBeCloseTo(0)
  await notice.click()
  await expect(notice).toBeVisible()
  await page.screenshot({ path: info.outputPath('collection-sync-notice.png') })
  await page.clock.runFor(5000)
  await expect(notice).toBeHidden()
  await showError()
  await page.getByRole('button', { name: '重试同步', exact: true }).click()
  await expect(notice).toBeVisible()
  await page.mouse.click(20, 850)
  await expect(notice).toBeHidden()
})
