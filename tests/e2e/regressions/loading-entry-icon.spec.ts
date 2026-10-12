import { expect, test } from '@playwright/test'
import { open } from '../helpers.ts'

test('English loading has one Enter label', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ponygogogo:settings', JSON.stringify({ lang: 'en' })))
  await open(page)
  await expect(page.getByTestId('loading-progress')).toContainText('100%')
  const enter = page.getByRole('button', { name: 'Enter', exact: true })
  await expect(enter).toHaveCount(1)
  await expect(enter).toHaveText('Enter')
  await page.screenshot({ path: 'tests/e2e/screenshots/loading-english.png' })
  await enter.click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
})

test('tab favicon declares the avatar asset and serves the correct image', async ({ page }) => {
  await page.goto('/')
  const icon = page.locator('link[rel="icon"]')
  await expect(icon).toHaveAttribute('href', '/favicon.png')
  await expect(icon).toHaveAttribute('type', 'image/png')
  await expect(icon).toHaveAttribute('sizes', '128x128')
  const response = await page.request.get('/favicon.png')
  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toContain('image/png')
  await page.evaluate(async () => {
    const image = new Image()
    image.src = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href
    await image.decode()
    if (image.naturalWidth !== 128 || image.naturalHeight !== 128) throw new Error('Favicon must be square')
  })
  const fallback = await page.request.get('/favicon.ico')
  expect(fallback.ok()).toBe(true)
  expect([...((await fallback.body()).subarray(0, 4))]).toEqual([0, 0, 1, 0])
})
