/**
 * L3 键盘与读屏可达性：只用键盘在选牌面板里选一张牌；模态窗口用 Escape 关、焦点回到打开它的按钮、
 * Tab 困在窗口里；点遮罩关、在输入框里拖选到遮罩上松手不关；窗口在顶层渲染仍贴合舞台；音量滑块有名字。
 */
import { expect, test, type Page } from '@playwright/test'
import { BASE_URL } from '../playwright.config.ts'
import { checkScreen, enterHome, noConsoleErrors, open, playUntilResult, startRace } from '../helpers.ts'

const SHOT = 'tests/e2e/screenshots'
// 端口来自 PLAYWRIGHT_PORT，URL 校验跟着配置走
const URL_PATTERN = new RegExp(new URL(BASE_URL).host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

/** 按 Tab 直到焦点落在匹配 selector 的元素上（至多 limit 次），到不了就失败 */
async function tabUntil(page: Page, selector: string, limit = 24): Promise<void> {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector)) return
  }
  throw new Error(`focus never reached ${selector}`)
}

test('键盘选牌：Tab 到第二张牌、Enter 选中，只选一次，结算页记的就是它', async ({ page }) => {
  const errors = await noConsoleErrors(page)
  await open(page)
  await enterHome(page)
  await startRace(page, 1)
  await page.evaluate(() => {
    const w = window as unknown as { __rhythm?: number }
    w.__rhythm = window.setInterval(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })), 30)
    }, 500)
  })
  await expect(page.getByTestId('card-panel')).toBeVisible({ timeout: 60_000 })
  // 发牌动画结束（opacity 到 1）才可交互
  for (let i = 0; i < 3; i++) await expect(page.getByTestId(`card-choice-${i}`)).toHaveCSS('opacity', '1')
  await page.evaluate(() => {
    const w = window as unknown as { __rhythm?: number }
    if (w.__rhythm) window.clearInterval(w.__rhythm)
  })

  const target = page.getByTestId('card-choice-1').locator('.card-root')
  await expect(target).toHaveAttribute('role', 'button')
  await expect(target).toHaveAttribute('tabindex', '0')
  const name = await target.getAttribute('aria-label')
  expect(name && name.length > 0).toBe(true)
  // 读屏名 = 卡名，说明 = 效果描述
  await expect(page.getByRole('button', { name: name!, exact: true })).toHaveCount(1)
  await expect(target).toHaveAccessibleDescription(/\S/)

  await tabUntil(page, '[data-testid="card-choice-1"] .card-root')
  await expect(target).toBeFocused()
  // 键盘焦点的金光：与选中同一个 drop-shadow
  await expect(target).toHaveCSS('filter', /drop-shadow/)
  await page.screenshot({ path: `${SHOT}/40-keyboard-card-focus.png` })
  await checkScreen(page, {
    ids: ['card-panel', 'choice-timer', 'card-choice-0', 'card-choice-1', 'card-choice-2', 'card-skip'],
    texts: ['card-skip'],
    disjoint: ['card-choice-0', 'card-choice-1', 'card-choice-2'],
    url: URL_PATTERN,
    title: /Ponygogogo/,
  })

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('card-panel')).toBeHidden({ timeout: 20_000 })

  await playUntilResult(page)
  await expect(page.getByTestId('result-choice-0')).toContainText(name!)
  await page.screenshot({ path: `${SHOT}/41-keyboard-card-result.png` })
  expect(errors).toEqual([])
})

test('模态窗口：Escape 关闭且焦点回到入口、Tab 困在窗口里、点遮罩关闭、拖选到遮罩上不关闭', async ({ page }) => {
  const errors = await noConsoleErrors(page)
  await open(page)
  await enterHome(page)
  const signUp = page.getByRole('button', { name: /^注册|Sign up/ }).first()
  const modal = page.getByTestId('register-modal')

  // --- 打开：原生模态 dialog，名字是标题，初始焦点在输入框 ---
  await signUp.click()
  await expect(modal).toBeVisible()
  await expect(modal).toHaveJSProperty('open', true)
  expect(await modal.evaluate((d) => d.matches(':modal'))).toBe(true)
  await expect(page.getByRole('dialog', { name: /给这把通行密钥起个名字|Name this passkey/ })).toBeVisible()
  await expect(page.getByTestId('register-name')).toBeFocused()

  // 顶层渲染脱离了舞台的 scale，按 --stage-* 贴回：窗口的框与舞台的框重合
  const [dialogBox, stageBox] = await Promise.all([modal.boundingBox(), page.getByTestId('stage').boundingBox()])
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(dialogBox![k] - stageBox![k])).toBeLessThanOrEqual(1)
  await page.screenshot({ path: `${SHOT}/42-modal-open.png` })
  await checkScreen(page, {
    ids: ['register-modal', 'register-name', 'register-cancel'],
    texts: ['register-cancel'],
    disjoint: ['register-name', 'register-cancel'],
    url: URL_PATTERN,
    title: /Ponygogogo/,
  })

  // --- Tab 困在窗口里：焦点只会在窗口内（或回到文档本身），不会落到背后的首页按钮上 ---
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    const inside = await modal.evaluate((d) => d.contains(document.activeElement) || document.activeElement === document.body)
    expect(inside).toBe(true)
  }

  // --- Escape 关闭，焦点回到「注册」 ---
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  await expect(signUp).toBeFocused()
  await page.screenshot({ path: `${SHOT}/43-modal-escaped.png` })

  // --- 在输入框里按下、拖到遮罩上松开：是拖选文字，不是点遮罩 ---
  await signUp.click()
  await expect(modal).toBeVisible()
  const input = await page.getByTestId('register-name').boundingBox()
  await page.mouse.move(input!.x + 10, input!.y + input!.height / 2)
  await page.mouse.down()
  await page.mouse.move(stageBox!.x + 12, stageBox!.y + 12, { steps: 4 })
  await page.mouse.up()
  await expect(modal).toBeVisible()

  // --- 点在面板里不关，点遮罩（面板外、舞台内）关 ---
  await page.locator('.wallet-dialog h2').click()
  await expect(modal).toBeVisible()
  await page.mouse.click(stageBox!.x + 12, stageBox!.y + 12)
  await expect(modal).toBeHidden()

  // --- 设置页：音量滑块以旁边的文字为名 ---
  await page.getByRole('button', { name: /游戏设置|SETTINGS/ }).first().click()
  await expect(page.getByTestId('screen-settings')).toBeVisible()
  for (const label of [/^总音量$|^Master$/, /^音乐$|^Music$/]) await expect(page.getByRole('slider', { name: label })).toBeVisible()

  expect(errors).toEqual([])
})
