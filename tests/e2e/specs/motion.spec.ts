/**
 * 组件动效回归（docs/plan/demo.md §5.1.2）。
 * 动效是验收内容，不是素材有余力时再补的装饰。
 *
 * 动画只有 260ms，跨进程断言会错过它，因此统一用页面内轮询采样：
 * 在一段时间窗口里记录目标元素上出现过哪些动画名，再对采样结果断言。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { enterHome, open, startRace } from '../helpers.ts'

/** 动效要在正常模拟速度下观察：加速模式下选牌面板会立刻弹出，gogo 按钮随之卸载 */
const NORMAL = 'mockDelay=0'

async function transformOf(el: Locator): Promise<string> {
  return el.evaluate((n) => getComputedStyle(n as HTMLElement).transform)
}

/** 在页面内采样一段时间窗口，返回该选择器上出现过的动画名集合 */
async function sampleAnimations(
  page: Page,
  selector: string,
  windowMs: number,
  trigger?: (sel: string) => void,
): Promise<string[]> {
  return page.evaluate(
    async ([sel, ms, fnSrc]) => {
      const seen = new Set<string>()
      if (fnSrc) {
        // eslint-disable-next-line no-new-func
        new Function('sel', fnSrc as string)(sel)
      }
      const end = performance.now() + Number(ms)
      while (performance.now() < end) {
        const el = document.querySelector(sel as string) as HTMLElement | null
        if (el) for (const a of el.getAnimations()) seen.add((a as CSSAnimation).animationName)
        await new Promise((r) => requestAnimationFrame(r))
      }
      return [...seen]
    },
    [selector, windowMs, trigger ? `(${trigger.toString()})(sel)` : ''] as const,
  )
}

function pressGogo(sel: string): void {
  const el = document.querySelector(sel) as HTMLElement | null
  if (!el) return
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  setTimeout(() => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })), 40)
}

async function pressAndHold(page: Page, el: Locator): Promise<void> {
  const box = await el.boundingBox()
  if (!box) throw new Error('no box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
}

test('任意可用按钮按下立即缩放，释放后回弹', async ({ page }) => {
  await open(page, NORMAL)
  await enterHome(page)
  const btn = page.getByRole('button', { name: /卡牌图鉴|COLLECTION/ }).first()
  const rest = await transformOf(btn)
  await pressAndHold(page, btn)
  await page.waitForTimeout(60)
  const pressed = await transformOf(btn)
  expect(pressed).not.toBe(rest)
  expect(pressed).toContain('matrix')
  // 移开指针取消这次按下，按钮回弹且不触发跳转
  await page.mouse.move(10, 10)
  await page.mouse.up()
  await page.waitForTimeout(280)
  expect(await transformOf(btn)).toBe(rest)
  await expect(page.getByTestId('screen-home')).toBeVisible()
})

test('gogo 每次按下同时有旋转和缩放', async ({ page }) => {
  await open(page, NORMAL)
  await enterHome(page)
  await startRace(page, 0, 0)
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 20_000 })
  await expect(page.getByTestId('gogo')).toBeVisible()
  const seen = await sampleAnimations(page, '[data-testid="gogo"]', 600, pressGogo)
  expect(seen).toContain('gogo-punch')
  // 连按两次都要播放：动画连续触发时重置当前动画，不排队堆积
  const again = await sampleAnimations(page, '[data-testid="gogo"]', 600, pressGogo)
  expect(again).toContain('gogo-punch')
})

test('状态首次新增播放一次徽章动效；普通计时 tick 不重复播放', async ({ page }) => {
  await open(page, 'mockDelay=0&raceSpeed=6')
  await enterHome(page)
  await startRace(page, 0, 0)
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 20_000 })
  await page.evaluate(() => {
    const w = window as unknown as { __r?: number }
    w.__r = window.setInterval(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })), 30)
    }, 500)
  })
  await expect(page.getByTestId('card-panel')).toBeVisible({ timeout: 60_000 })
  await page.getByTestId('card-choice-0').locator('.card-root').click()
  const seen = await sampleAnimations(page, '[data-testid^="buff-"]', 900)
  expect(seen).toContain('badge-pop')

  // 普通 tick 不重播：动效播完就没有第二次，采样窗口里不再出现
  await page.waitForTimeout(400)
  const later = await sampleAnimations(page, '[data-testid^="buff-"]', 700)
  expect(later).not.toContain('badge-pop')
  await page.evaluate(() => {
    const w = window as unknown as { __r?: number }
    if (w.__r) window.clearInterval(w.__r)
  })
})

test('开启减弱动效后取消旋转与大幅缩放，但保留按下反馈，且流程不变', async ({ page }) => {
  await open(page, NORMAL)
  await enterHome(page)
  await page.getByRole('button', { name: /游戏设置|SETTINGS/ }).first().click()
  await expect(page.getByTestId('screen-settings')).toBeVisible()
  const toggle = page.locator('.chip', { hasText: /^关$|^Off$/ }).first()
  if (await toggle.count()) await toggle.click()
  await page.getByRole('button', { name: /返回|Back/ }).first().click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  await expect(page.locator('.stage-host')).toHaveClass(/reduced/)

  await startRace(page, 0, 0)
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 20_000 })
  await expect(page.getByTestId('gogo')).toBeVisible()
  const seen = await sampleAnimations(page, '[data-testid="gogo"]', 600, pressGogo)
  expect(seen).not.toContain('gogo-punch')

  // 按下反馈仍在：.reduced 下换成阴影闪现
  const gogo = page.getByTestId('gogo')
  await pressAndHold(page, gogo)
  await page.waitForTimeout(60)
  const shadow = await gogo.evaluate((n) => getComputedStyle(n as HTMLElement).boxShadow)
  expect(shadow).not.toBe('none')
  await page.mouse.up()
})
