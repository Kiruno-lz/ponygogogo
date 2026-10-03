/**
 * L3-R：访客的图鉴里稀有卡是锁定占位，只有 `data-card`、没有 `.card-root` 卡面，
 * 按卡面计数的排版检查因此漏掉了锁定格（当时卡池 26 格、14 张卡面）。缺陷说明见同目录 REPRO.md。
 */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { PAID_CARD_POOL } from '../../../src/race/cards/paidCards.ts'
import { enterHome, open } from '../helpers.ts'

const cardCheck = readFileSync(new URL('../../art/card-layout.js', import.meta.url), 'utf8')
  .replace('export function', 'function')
const RARE = PAID_CARD_POOL.filter((card) => card.quality === 'rare').length

async function openCollection(page: import('@playwright/test').Page): Promise<void> {
  await open(page)
  await enterHome(page)
  await page.getByRole('button', { name: /COLLECTION/ }).first().click()
  await expect(page.getByTestId('screen-collection')).toBeVisible()
}

test('FACES_ONLY：按 .card-root 计数，漏掉的恰好是全部锁定的稀有卡格', async ({ page }) => {
  await openCollection(page)
  // 缺陷写法数的是卡面；锁定格按产品设计不渲染卡面，差值必须正好等于稀有卡数
  await expect(page.locator('[data-card]')).toHaveCount(PAID_CARD_POOL.length)
  await expect(page.locator('.card-root')).toHaveCount(PAID_CARD_POOL.length - RARE)
  await expect(page.locator('[data-card]:not(.card-root)')).toHaveCount(RARE)
})

test('EVERY_SLOT：排版检查按 data-card 覆盖全部格子，卡面与锁定格分别断言', async ({ page }) => {
  await openCollection(page)
  const result = await page.evaluate(`(${cardCheck})()`)
  expect(result).toEqual({ cards: PAID_CARD_POOL.length, faces: PAID_CARD_POOL.length - RARE, locked: RARE, overflow: 0 })
})
