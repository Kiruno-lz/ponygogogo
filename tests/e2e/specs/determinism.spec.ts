/**
 * 规则内核在浏览器运行时的确定性。
 * 向量本身由 Node/Bun 生成（src/race/__vectors__/terminal.json），这里让同一份规则
 * 在浏览器里重跑一遍，逐字段比对——两套运行时不相等即阻断交付。
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

interface Vector {
  seed: string
  playerHorseId: number
  stakeTier: number
  policy: string
  horses: string[]
  finishedOrder: number[]
  endReason: string
  choices: string
  rulesVersion: string
}

const vectors = JSON.parse(
  readFileSync(new URL('../../../src/race/__vectors__/terminal.json', import.meta.url), 'utf8'),
) as Vector[]

const SAMPLE = vectors.slice(0, 60)

test('浏览器运行时与 Node 运行时的终态逐字段相等', async ({ page }) => {
  await page.goto('/?mockDelay=0')
  await page.getByTestId('loading-progress').filter({ hasText: '100%' }).waitFor({ timeout: 30_000 })

  const got = await page.evaluate(async (list) => {
    // Vite 开发服务器按源码路径提供模块；用变量绕开编译期解析
    const modPath = '/src/race/core/sim.ts'
    const sim = (await import(/* @vite-ignore */ modPath)) as typeof import('../../../src/race/core/sim.ts')
    const POLICIES: Record<string, import('../../../src/race/core/sim.ts').SimPolicy> = {
      perfect: sim.POLICY_PERFECT,
      idle: sim.POLICY_IDLE,
      mash: sim.POLICY_MASH,
      refresh: { ...sim.POLICY_PERFECT, refreshes: 2, decide: 'last' },
      forfeit: { ...sim.POLICY_PERFECT, decide: 'forfeit' },
    }
    return list.map((v) => {
      const { engine } = sim.runRace(
        { seed: v.seed, playerHorseId: v.playerHorseId, stakeTier: v.stakeTier },
        POLICIES[v.policy]!,
      )
      const st = engine.state
      return {
        seed: v.seed,
        playerHorseId: v.playerHorseId,
        stakeTier: v.stakeTier,
        policy: v.policy,
        horses: st.horses.map((h) =>
          [h.horseId, h.laneIndex, h.pos, h.dist, h.v, h.stamina, h.finishTick, h.finishOvershoot, h.rank].join(','),
        ),
        finishedOrder: [...st.finishedOrder],
        endReason: st.endReason ?? 'finished',
        choices: st.choices
          .map((c) => `${c.checkpoint}:${c.cardId ?? '-'}:${c.reason}:${c.refreshes.join('.')}`)
          .join('|'),
        rulesVersion: st.rulesVersion,
      }
    })
  }, SAMPLE)

  expect(got).toEqual(SAMPLE)
})

test('竖屏显示请横屏的阻塞提示，横屏下不显示', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 860 })
  await page.goto('/?mockDelay=0')
  await expect(page.getByTestId('rotate-blocker')).toBeVisible()
  await page.setViewportSize({ width: 860, height: 420 })
  await expect(page.getByTestId('rotate-blocker')).toBeHidden()
})
