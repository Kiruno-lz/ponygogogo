import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { CARD_POOL } from '../../../src/race/cards/pool.ts'
import { enterHome, open } from '../helpers.ts'

const cardCheck = readFileSync(new URL('../../art/card-layout.js', import.meta.url), 'utf8')
  .replace('export function', 'function')
const calloutCheck = readFileSync(new URL('../../art/callout-layout.js', import.meta.url), 'utf8')
  .replace('export function', 'function')
const staminaCheck = readFileSync(new URL('../../art/stamina-layout.js', import.meta.url), 'utf8')
  .replace('export function', 'function')

test('RACE lettering stays on the source cream face before and after choosing a horse', async ({ page }) => {
  await open(page)
  await enterHome(page)
  await page.getByRole('button', { name: /START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  await page.evaluate(`(${staminaCheck})()`)
  await page.evaluate(`(${calloutCheck})()`)
  await page.getByTestId('horse-0').click()
  await page.evaluate(`(${calloutCheck})()`)
})

test('all English and Chinese card descriptions stay above the ribbon', async ({ page }) => {
  await open(page)
  await enterHome(page)
  for (const language of ['zh', 'en']) {
    await page.getByRole('button', { name: /COLLECTION/ }).first().click()
    await expect(page.getByTestId('screen-collection')).toBeVisible()
    const result = await page.evaluate(`(${cardCheck})()`)
    expect(result).toEqual({ cards: CARD_POOL.length, overflow: 0 })
    await page.getByRole('button', { name: /^返回$|^Back$/ }).click()
    if (language === 'zh') await page.getByRole('button', { name: 'EN', exact: true }).click()
  }
})
