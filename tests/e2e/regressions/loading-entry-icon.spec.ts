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
