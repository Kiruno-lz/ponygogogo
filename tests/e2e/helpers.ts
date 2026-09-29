import { expect, type Page } from '@playwright/test'

export const FAST = 'raceSpeed=16'

export async function open(page: Page, query = FAST): Promise<void> {
  await page.goto(`/?${query}`)
  await expect(page.getByTestId('screen-loading')).toBeVisible()
}

export async function enterHome(page: Page): Promise<void> {
  await expect(page.getByTestId('loading-progress')).toContainText('100%', { timeout: 30_000 })
  await page.getByRole('button', { name: /进入游戏|Enter/ }).click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
}

/** E2E 构建没有合约地址，有奖档位是灰的，默认只能选 0 档免费试玩（有奖动线见 specs/paid-race.spec.ts） */
export async function startRace(page: Page, horseId = 0, tierIndex = 0): Promise<void> {
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  await page.getByTestId(`horse-${horseId}`).click()
  await page.getByTestId('bet-panel').locator('.chip').nth(tierIndex).click()
  await page.locator('button.btn-star').last().click()
}

/** 用现实节奏驱动 gogo，直到比赛结束或超时 */
export async function playUntilResult(page: Page, pickIndex = 0): Promise<void> {
  const deadline = Date.now() + 90_000
  await page.evaluate(() => {
    const w = window as unknown as { __rhythm?: number }
    w.__rhythm = window.setInterval(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })), 30)
    }, 500)
  })
  while (Date.now() < deadline) {
    if (await page.getByTestId('screen-result').isVisible().catch(() => false)) break
    const panel = page.getByTestId('card-panel')
    if (await panel.isVisible().catch(() => false)) {
      const card = page.getByTestId(`card-choice-${pickIndex}`)
      if (await card.isVisible().catch(() => false)) {
        await card.locator('.card-root').click({ timeout: 5000 }).catch(() => undefined)
      }
    }
    await page.waitForTimeout(250)
  }
  await page.evaluate(() => {
    const w = window as unknown as { __rhythm?: number }
    if (w.__rhythm) window.clearInterval(w.__rhythm)
  })
  await expect(page.getByTestId('screen-result')).toBeVisible({ timeout: 30_000 })
}

export async function noConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return errors
}

/**
 * 截图后的逐项核对（项目 L3 规则）：
 * 1. 关键 DOM 可见；2. 文案非空、无乱码（U+FFFD）、没被截断（scrollWidth ≤ clientWidth）；
 * 3. 关键元素互不重叠、不溢出视口；4. URL 与标题符合预期。任何一项不满足即失败。
 * 可见性先等待（`transient` 为真时不等：元素马上会消失，例如冲线后 1.2 s 就切到结算页），
 * 其余测量在同一次 evaluate 里取，保证是同一帧的画面。
 */
export async function checkScreen(
  page: Page,
  opts: { ids: string[]; texts?: string[]; disjoint?: string[]; url?: RegExp; title?: RegExp; transient?: boolean },
): Promise<void> {
  const all = [...new Set([...opts.ids, ...(opts.texts ?? []), ...(opts.disjoint ?? [])])]
  if (!opts.transient) for (const id of all) await expect(page.getByTestId(id).first(), `${id} visible`).toBeVisible()
  const facts = await page.evaluate((ids) => ids.map((id) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
    if (!el) return { id, found: false, visible: false, text: '', clipped: false, x: 0, y: 0, w: 0, h: 0 }
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      id, found: true, visible: r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      text: el.innerText.trim(), clipped: el.scrollWidth > el.clientWidth + 1 && style.overflow !== 'visible',
      x: r.x, y: r.y, w: r.width, h: r.height,
    }
  }), all)
  const byId = new Map(facts.map((f) => [f.id, f]))
  const viewport = page.viewportSize()!
  for (const f of facts) {
    expect(f.found && f.visible, `${f.id} visible`).toBe(true)
    expect(f.x, `${f.id} inside viewport`).toBeGreaterThanOrEqual(-1)
    expect(f.y, `${f.id} inside viewport`).toBeGreaterThanOrEqual(-1)
    expect(f.x + f.w, `${f.id} inside viewport`).toBeLessThanOrEqual(viewport.width + 1)
    expect(f.y + f.h, `${f.id} inside viewport`).toBeLessThanOrEqual(viewport.height + 1)
  }
  for (const id of opts.texts ?? []) {
    const f = byId.get(id)!
    expect(f.text.length, `${id} has text`).toBeGreaterThan(0)
    expect(f.text.includes('\uFFFD'), `${id} not garbled: ${f.text}`).toBe(false)
    expect(f.clipped, `${id} not truncated: ${f.text}`).toBe(false)
  }
  const boxes = (opts.disjoint ?? []).map((id) => byId.get(id)!)
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!
      const b = boxes[j]!
      const overlap = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1
      expect(overlap, `${a.id} and ${b.id} do not overlap`).toBe(false)
    }
  }
  if (opts.url) expect(page.url()).toMatch(opts.url)
  if (opts.title) expect(await page.title()).toMatch(opts.title)
}
