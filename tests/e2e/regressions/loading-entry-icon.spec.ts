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
  await expect(icon).toHaveAttribute('href', '/assets/art/ui/avatar-trimmed.webp')
  await expect(icon).toHaveAttribute('type', 'image/webp')
  const response = await page.request.get('/assets/art/ui/avatar-trimmed.webp')
  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toContain('image/webp')
  await page.evaluate(async () => {
    const image = new Image()
    image.src = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty favicon')
  })
})
