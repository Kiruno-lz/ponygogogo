import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { PAID_CARD_POOL } from '../../../src/race/cards/paidCards.ts'
import { enterHome, open } from '../helpers.ts'

const cardCheck = readFileSync(new URL('../../art/card-layout.js', import.meta.url), 'utf8')
  .replace('export function', 'function')
const calloutCheck = readFileSync(new URL('../../art/callout-layout.js', import.meta.url), 'utf8')
  .replace('export function', 'function')
const staminaCheck = readFileSync(new URL('../../art/stamina-layout.js', import.meta.url), 'utf8')
  .replace('export function', 'function')
/** 访客看到的每张稀有卡都是锁定格（docs/plan/card-collection-unlock.md §2），没有卡面 */
const RARE = PAID_CARD_POOL.filter((card) => card.quality === 'rare').length

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

test('every English and Chinese collection slot keeps its copy inside the frame', async ({ page }) => {
  await open(page)
  await enterHome(page)
  for (const language of ['zh', 'en']) {
    await page.getByRole('button', { name: /COLLECTION/ }).first().click()
    await expect(page.getByTestId('screen-collection')).toBeVisible()
    const result = await page.evaluate(`(${cardCheck})()`)
    expect(result).toEqual({ cards: PAID_CARD_POOL.length, faces: PAID_CARD_POOL.length - RARE, locked: RARE, overflow: 0 })
    await page.getByRole('button', { name: /^返回$|^Back$/ }).click()
    if (language === 'zh') await page.getByRole('button', { name: 'EN', exact: true }).click()
  }
})
