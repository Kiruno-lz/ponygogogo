import { expect, test, type Page } from '@playwright/test'
import { checkScreen, enterHome, open } from '../helpers.ts'

/**
 * L3-R：固定 `?seed=` 不再固定练习赛。出场名单的顺序来自 `createPonySelection` 的 `Math.random`
 * 洗牌，玩家车道 `4 - 索引` 与名单 `[...可见].reverse()` 因而每次挂载都不同，`App.startRace`
 * 又把两者直接交给练习 `RaceDriver`。断言同一 URL 连开六次得到同一份名单。
 */
const SEED = '0x00000003'
const QUERY = `mockDelay=0&raceSpeed=16&seed=${SEED}`

/** 打开选马页，读出每匹小马所在的车道（`horse-<ponyId>` 上的 `data-lane`） */
async function lineup(page: Page): Promise<Record<string, string>> {
  await open(page, QUERY)
  await enterHome(page)
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  return Object.fromEntries(await page.locator('[data-testid^="horse-"]').evaluateAll(
    (nodes) => nodes.map((n) => [n.getAttribute('data-testid')!, n.getAttribute('data-lane')!])))
}

test('同一个固定 seed 的练习出场名单必须稳定', async ({ page }) => {
  const seen = new Set<string>()
  for (let i = 0; i < 6; i++) seen.add(JSON.stringify(await lineup(page)))
  expect([...seen].map((s) => JSON.parse(s) as Record<string, string>)).toHaveLength(1)
})

test('练习驱动直接采用这份名单：玩家车道与名单位次都来自选马页', async ({ page }, testInfo) => {
  const lanes = await lineup(page)
  await page.screenshot({ path: testInfo.outputPath('select-lineup.png') })
  await checkScreen(page, { ids: ['screen-select', 'bet-panel'], url: /seed=0x00000003/, title: /Ponygogogo/ })
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name)
      .reverse().find((url) => new URL(url).pathname === '/src/game/RaceScene.ts')
    if (!path) throw new Error('RaceScene was not loaded')
    const { RaceScene } = await import(path)
    const create = RaceScene.prototype.create
    RaceScene.prototype.create = function () {
      create.call(this)
      ;(window as any).__lineupScene = this
    }
  })
  await page.getByTestId('horse-0').click()
  await page.getByTestId('bet-panel').locator('.chip').nth(0).click()
  await page.locator('button.btn-star').last().click()
  // 16 倍速倒计时仅约 0.19 秒；等待实际场景，避免把短暂的显示状态作为阵容断言的前置条件。
  await expect.poll(() => page.evaluate(() => !!(window as any).__lineupScene)).toBe(true)
  const facts = await page.evaluate(() => {
    const driver = (window as any).__lineupScene.driver
    return { playerHorseId: driver.state.playerHorseId, roster: [...driver.replayInput.roster] as number[] }
  })
  expect(String(facts.playerHorseId)).toBe(lanes['horse-0'])
  expect(facts.roster[facts.playerHorseId]).toBe(0)
})
