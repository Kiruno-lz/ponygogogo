import { expect, test } from '@playwright/test'
import { enterHome, open } from '../helpers.ts'
import { stubChain } from '../walletHarness.ts'

test('English home labels fit their signs while Chinese layout stays unchanged', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.credentials, 'get', { value: () => new Promise(() => {}) })
  })
  await stubChain(page)
  await open(page)
  await enterHome(page)
  const read = () => page.locator('.home-artboard').evaluate(el => ['start', 'collection', 'settings', 'login', 'register'].map(name => {
    const label = el.querySelector<HTMLElement>(`.home-${name} > .lbl`)!
    const text = label.querySelector<HTMLElement>('.zh')!
    const css = getComputedStyle(label)
    const matrix = new DOMMatrix(css.transform)
    return { name, top: parseFloat(css.top), size: parseFloat(getComputedStyle(text).fontSize),
      width: text.getBoundingClientRect().width, boxWidth: label.getBoundingClientRect().width,
      angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI }
  }))
  const chinese = await read()
  expect(chinese.map(v => [v.top, v.size])).toEqual([[54, 52], [43, 36], [42, 35], [57, 42], [33, 44]])
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveCount(0)
  await page.locator('.home-settings').click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.keyboard.press('Escape')
  const english = await read()
  expect(english.slice(0, 3).map(v => v.top)).toEqual([60, 61, 56])
  expect(english[0]!.size).toBeGreaterThan(chinese[0]!.size)
  expect(english[1]!.size).toBe(english[2]!.size)
  expect(english[3]!.size).toBeLessThan(chinese[3]!.size)
  expect(english[4]!.size).toBeLessThan(chinese[4]!.size)
  expect(english[4]!.angle).toBeCloseTo(english[3]!.angle)
  expect(english[4]!.top).toBe(45)
  for (const v of english) expect(v.width).toBeLessThanOrEqual(v.boxWidth + 1)
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
  await page.screenshot({ path: 'tests/e2e/screenshots/home-english.png' })
  await page.locator('.home-settings').click()
  await page.getByRole('button', { name: '中文', exact: true }).click()
  await page.keyboard.press('Escape')
  expect(await read()).toEqual(chinese)
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
  await page.screenshot({ path: 'tests/e2e/screenshots/home-chinese.png' })
  await page.locator('.home-settings').click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.locator('.home-login').click()
  await expect(page.locator('.home-login')).toHaveText('Signing in…')
  const busy = (await read())[3]!
  expect(busy.width).toBeLessThanOrEqual(busy.boxWidth + 1)
  await page.screenshot({ path: 'tests/e2e/screenshots/home-english-signing-in.png' })
})
