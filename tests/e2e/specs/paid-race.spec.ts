/**
 * L3 有奖比赛全栈动线（DEV_CHAIN=anvil）：浏览器 → PonyGame/PonyVault（本地 anvil）→ 浏览器。
 *
 * 前置：`PORT=5178 DEV_CHAIN=anvil DEV_DETACH=1 bash scripts/dev.sh`（anvil + 部署 + `vite --mode anvil`），
 * 结束后 `bash scripts/dev.sh stop`。没有这套环境时本文件整体跳过（信息文件 .cache/dev-chain/anvil.json 缺失
 * 或 RPC/Vite 不通），不影响其余用例。
 *
 * 动线一：注册（开发链领水 = anvil_setBalance）→ 选马与 0.3 档（最多赢 0.9）→ 入场交易（已提交/已入块）→ 规范时间线上的比赛
 *        → 每个手选面板点第一张牌（等 openSec 之后才发送，已入块后显示 tx）→ 冲线「待链上验证」→ 自动结算
 *        → 结算页的链上名次、返还、净盈亏、tx 链接与「已结算」印章，并与链上 SessionSettled 核对。
 * 动线二：开赛并完成第一次选择后刷新页面 → 登录同一把通行密钥 → 恢复窗口（含结算期限）→ 继续比赛（按规范时间落到当前时刻）
 *        → 把 anvil 的链上时间快进到玩家冲线之后（等同切后台很久再回来：画面直接跳到位）→ 自动结算。
 * 动线三：结算时 RPC 故障（拦下 settleSession 的 eth_estimateGas）→ 印章「结算失败」、按钮行下方的说明、结算期限与
 *        「重试结算」→ 恢复后重试 → 已结算。
 * 有奖比赛以链上时间为准不能加速；按规则一场可能跑到四分钟（死亡 + 力竭），动线一完整跑自然时间。
 * 每个关键截图后按清单核对：关键 DOM 可见、文案完整无乱码、无重叠与溢出、URL 与标题。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, toFunctionSelector, type Address, type Hex } from 'viem'
import { ponyGameAbi } from '../../../src/chain/paidCalls.ts'
import { readSessionFacts, recoverPaidSession, type SessionReader } from '../../../src/chain/paidSession.ts'
import { solveFromFacts } from '../../../src/race/paidResult.ts'
import { addAuthenticator, readAddress, registerAs } from '../walletHarness.ts'
import { checkScreen, enterHome, open } from '../helpers.ts'

const SHOT = 'tests/e2e/screenshots'
const INFO = fileURLToPath(new URL('../../../.cache/dev-chain/anvil.json', import.meta.url))
const BASE = process.env.PAID_E2E_URL ?? 'http://localhost:5178'

type DevChainInfo = { rpcUrl: string; chainId: number; game: Address; vault: Address; solver: Address; solverKind: 'mock' | 'real' }

function info(): DevChainInfo | null {
  if (!existsSync(INFO)) return null
  try {
    return JSON.parse(readFileSync(INFO, 'utf8')) as DevChainInfo
  } catch {
    return null
  }
}

async function stackUp(): Promise<boolean> {
  const i = info()
  if (!i) return false
  try {
    const [rpc, vite] = await Promise.all([
      fetch(i.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' }),
      fetch(BASE),
    ])
    return rpc.ok && vite.ok
  } catch {
    return false
  }
}

test.use({ baseURL: BASE })
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.skip(!(await stackUp()), 'needs the local stack: PORT=5178 DEV_CHAIN=anvil DEV_DETACH=1 bash scripts/dev.sh')
})

function chain() {
  const i = info()!
  return { i, pub: createPublicClient({ transport: http(i.rpcUrl) }) }
}

async function settledOnChain(player: Address): Promise<{ rank: number; payout: bigint; hash: Hex } | null> {
  const { i, pub } = chain()
  const event = ponyGameAbi.find((x) => x.type === 'event' && x.name === 'SessionSettled')!
  const logs = await pub.getLogs({ address: i.game, event: event as never, args: { player } as never, fromBlock: 0n, toBlock: 'latest' })
  const last = logs.at(-1) as unknown as { args: { playerSettlementRank: number; payout: bigint }; transactionHash: Hex } | undefined
  return last ? { rank: last.args.playerSettlementRank, payout: last.args.payout, hash: last.transactionHash } : null
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(info()!.rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await res.json() as { result?: unknown; error?: { message: string } }
  if (body.error) throw new Error(body.error.message)
  return body.result
}

/** 把链上时间快进到该账户会话里玩家冲线之后 2 s（anvil evm_increaseTime + 立刻出一块）。 */
async function warpPastFinish(player: Address): Promise<void> {
  const { i, pub } = chain()
  const facts = await recoverPaidSession(pub as unknown as SessionReader, i.game, player)
  expect(facts).not.toBeNull()
  const finishWall = Number(solveFromFacts(facts!).finishWall[facts!.horseId])
  const head = Number((await pub.getBlock({ blockTag: 'latest' })).timestamp)
  const target = facts!.openedAt + Math.ceil(finishWall / 1000) + 2
  if (target > head) await rpc('evm_increaseTime', [target - head])
  await rpc('evm_mine', [])
}

/** `shot` 给出时截下「有奖档已开放」的选马页并按清单核对（动线一用一次就够） */
async function startPaid(page: Page, horseId: number, shot?: string): Promise<void> {
  await page.getByRole('button', { name: /开始游戏|START/ }).first().click()
  await expect(page.getByTestId('screen-select')).toBeVisible()
  await page.getByTestId(`horse-${horseId}`).click()
  const chips = page.getByTestId('bet-panel').locator('.chip')
  await expect(chips.nth(1)).toBeEnabled()
  await expect(page.getByTestId('paid-closed')).toHaveCount(0)
  await chips.nth(1).click()
  await expect(page.getByTestId('potential-win')).toHaveText('0.9 MON')
  if (shot) {
    for (let i = 1; i < 5; i++) await expect(chips.nth(i)).toBeEnabled()
    await page.screenshot({ path: `${SHOT}/${shot}.png` })
    await checkScreen(page, {
      ids: ['bet-panel'], texts: ['select-balance', 'potential-win', 'difficulty'],
      disjoint: ['select-balance', 'potential-win', 'difficulty'], url: /localhost:5178/,
    })
  }
  const countdown = page.getByTestId('countdown').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('button.btn-star').last().click()
  await countdown
}

/**
 * Plays panels until `stop` resolves true: every manual, unlocked panel gets its first card clicked.
 * Returns how many choices were sent. The first panel is screenshotted and checked.
 */
async function playPanels(page: Page, stop: () => Promise<boolean>, shots: string, maxMs = 240_000): Promise<number> {
  const deadline = Date.now() + maxMs
  let picks = 0
  let shotPanel = false
  while (Date.now() < deadline) {
    if (await stop()) return picks
    const panel = page.getByTestId('card-panel')
    if (await panel.isVisible().catch(() => false)) {
      const manual = await page.getByTestId('card-skip').isVisible().catch(() => false)
      const locked = await page.getByTestId('card-locked').isVisible().catch(() => false)
      if (manual && !locked) {
        if (!shotPanel) {
          await page.waitForTimeout(600)
          await page.screenshot({ path: `${SHOT}/${shots}-panel.png` })
          await checkScreen(page, {
            ids: ['card-panel', 'choice-timer', 'card-choice-0', 'card-choice-1', 'card-choice-2', 'card-skip'],
            texts: ['choice-timer', 'card-skip'],
            disjoint: ['card-choice-0', 'card-choice-1', 'card-choice-2'],
            url: /localhost:5178/, title: /Ponygogogo/,
          })
          shotPanel = true
        }
        const card = page.getByTestId('card-choice-0').locator('.card-root')
        if (await card.isVisible().catch(() => false)) {
          await card.click({ timeout: 3000 }).catch(() => undefined)
          // the panel closes on click; the choice chip reports queued → submitted → on chain
          if (await page.getByTestId('card-panel').isHidden().catch(() => false)) {
            picks++
            await expect(page.getByTestId('paid-choice-tx')).toBeVisible({ timeout: 15_000 })
            await expect(page.getByTestId('paid-choice-tx')).toHaveAttribute('href', /^https:\/\/testnet\.monadexplorer\.com\/tx\/0x[0-9a-f]{64}$/)
          }
        }
      }
    }
    await page.waitForTimeout(200)
  }
  throw new Error('race did not reach the expected point in time')
}

async function expectSettled(page: Page, player: Address, prefix: string): Promise<void> {
  await expect(page.getByTestId('screen-result')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('settle-stamp')).toHaveAttribute('data-phase', 'settled', { timeout: 60_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOT}/${prefix}-result.png` })
  await checkScreen(page, {
    ids: ['screen-result', 'settle-stamp', 'settle-tx', 'result-mode', 'result-prize', 'result-net-value', 'result-verify'],
    texts: ['settle-stamp', 'settle-tx', 'result-mode', 'result-prize', 'result-net-value', 'result-verify'],
    disjoint: ['settle-stamp', 'settle-tx', 'result-prize'],
    url: /localhost:5178/, title: /Ponygogogo/,
  })
  await expect(page.getByTestId('settle-stamp')).toHaveText(/已结算|Settled/)
  await expect(page.getByTestId('result-mode')).toHaveText(/0\.3 MON/)
  await expect(page.getByTestId('result-prize')).toHaveText(/^\d+\.\d{4} MON$/)
  await expect(page.getByTestId('result-net-value')).toHaveText(/^[+-]?\d+\.\d{4}$/)
  await expect(page.getByTestId('settle-detail')).toHaveCount(0)
  const onChain = await settledOnChain(player)
  expect(onChain).not.toBeNull()
  await expect(page.getByTestId('result-rank')).toHaveText(String(onChain!.rank))
  await expect(page.getByTestId('result-verify')).toContainText(String(onChain!.rank))
  await expect(page.getByTestId('settle-tx')).toHaveAttribute('href', `https://testnet.monadexplorer.com/tx/${onChain!.hash}`)
  const payout = Number(onChain!.payout) / 1e18
  await expect(page.getByTestId('result-prize')).toHaveText(`${payout.toFixed(4)} MON`)
}

test('有奖动线：入场 → 选牌上链 → 冲线待验证 → 自动结算 → 链上名次与返还', async ({ page }) => {
  test.setTimeout(600_000)
  await addAuthenticator(page)
  await open(page, 'e2e=paid')
  await enterHome(page)
  await registerAs(page, 'paid-e2e')
  const player = (await readAddress(page)) as Address

  await startPaid(page, 2, 'paid-00-select')
  await page.screenshot({ path: `${SHOT}/paid-01-entry.png` })
  await checkScreen(page, { ids: ['screen-race', 'countdown'], url: /localhost:5178/, title: /Ponygogogo/ })
  // the entry batch (deposit shortfall + openSession) is reported until it is included
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 60_000 })
  await expect(page.getByTestId('gogo')).toBeVisible()
  await expect(page.getByTestId('gogo')).toContainText(/有奖 · 0\.3 MON|Paid · 0\.3 MON/)
  await page.screenshot({ path: `${SHOT}/paid-02-race.png` })
  await checkScreen(page, {
    ids: ['stamina-bar', 'leaderboard', 'gogo'], texts: ['board-row-0'], disjoint: ['leaderboard', 'gogo'],
    url: /localhost:5178/, title: /Ponygogogo/,
  })

  const picks = await playPanels(page, async () => page.getByTestId('paid-pending-verify').isVisible().catch(() => false), 'paid-03', 480_000)
  expect(picks).toBeGreaterThanOrEqual(1)
  await page.screenshot({ path: `${SHOT}/paid-04-finish.png` })
  await checkScreen(page, {
    ids: ['paid-pending-verify', 'leaderboard'], texts: ['paid-pending-verify'], disjoint: ['paid-pending-verify', 'leaderboard'],
    url: /localhost:5178/, title: /Ponygogogo/, transient: true,
  })

  await expectSettled(page, player, 'paid-05')

  // balances refresh after settlement: the Vault game balance now holds the payout
  const onChain = await settledOnChain(player)
  await page.getByTestId('result-btn-home').click()
  await expect(page.getByTestId('screen-home')).toBeVisible()
  await page.getByTestId('wallet-open').click()
  await expect(page.getByTestId('wallet-game-balance')).toHaveText(`${(Number(onChain!.payout) / 1e18).toFixed(4)} MON`)
})

test('刷新恢复：第一次选择上链后刷新 → 登录 → 恢复窗口 → 继续比赛 → 结算', async ({ page }) => {
  test.setTimeout(360_000)
  await addAuthenticator(page)
  await open(page, 'e2e=paid-resume')
  await enterHome(page)
  await registerAs(page, 'paid-resume')
  const player = (await readAddress(page)) as Address

  await startPaid(page, 4)
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 60_000 })
  const picked = await playPanels(page, async () => page.getByTestId('paid-choice-tx').isVisible().catch(() => false), 'resume-01', 90_000)
  expect(picked).toBeGreaterThanOrEqual(0)

  await page.reload()
  await expect(page.getByTestId('screen-loading')).toBeVisible()
  await enterHome(page)
  await page.getByRole('button', { name: /^登录|Sign in/ }).first().click()
  await expect(page.getByTestId('paid-resume')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${SHOT}/resume-02-modal.png` })
  await checkScreen(page, {
    ids: ['paid-resume', 'paid-resume-later', 'paid-resume-deadline'], texts: ['paid-resume-later', 'paid-resume-deadline'],
    url: /localhost:5178/, title: /Ponygogogo/,
  })
  await expect(page.getByTestId('paid-resume')).toContainText(/0\.3 MON/)
  // no refunds (session protocol v2): the modal states the settlement deadline, conservatively in whole minutes
  await expect(page.getByTestId('paid-resume-deadline')).toHaveText(/请在约 \d+ 分钟内结算，否则视为放弃/)
  await page.getByRole('button', { name: /继续比赛|Resume race/ }).click()
  await expect(page.getByTestId('screen-race')).toBeVisible()
  // resume skips the visual countdown and lands on the current canonical moment
  await expect(page.getByTestId('countdown')).toHaveCount(0)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOT}/resume-03-race.png` })
  await checkScreen(page, { ids: ['stamina-bar', 'leaderboard'], url: /localhost:5178/, title: /Ponygogogo/ })
  // the on-chain choice survived the reload: the preview keeps it (checked against the chain facts)
  const { i, pub } = chain()
  const facts = await recoverPaidSession(pub as unknown as SessionReader, i.game, player)
  expect(facts?.choices.some((c) => c !== null) ?? false).toBe(picked > 0)

  await warpPastFinish(player)
  await expect(page.getByTestId('screen-result')).toBeVisible({ timeout: 60_000 })
  await expectSettled(page, player, 'resume-05')
  const settled = await readSessionFacts(pub as unknown as SessionReader, i.game, facts!.sessionId)
  expect(settled.state).toBe(2)
})

test('结算失败：印章「结算失败」、按钮行下方的说明与重试；恢复后重试即已结算', async ({ page }) => {
  test.setTimeout(300_000)
  await addAuthenticator(page)
  await open(page, 'e2e=paid-retry')
  await enterHome(page)
  await registerAs(page, 'paid-retry')
  const player = (await readAddress(page)) as Address

  // the browser talks to anvil directly; fail only the gas estimate of settleSession
  const selector = toFunctionSelector('settleSession(bytes32)').slice(2)
  let outage = true
  const rpcPort = new URL(info()!.rpcUrl).port
  await page.route((url) => url.port === rpcPort, async (route) => {
    const body = route.request().postData() ?? ''
    if (outage && body.includes('eth_estimateGas') && body.includes(selector)) {
      const req = JSON.parse(body) as { id: number }
      await route.fulfill({
        status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32000, message: 'stubbed RPC outage' } }),
      })
      return
    }
    await route.continue()
  })

  await startPaid(page, 1)
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 60_000 })
  await warpPastFinish(player)
  await expect(page.getByTestId('screen-result')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('settle-stamp')).toHaveAttribute('data-phase', 'failed', { timeout: 60_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOT}/retry-01-failed.png` })
  await checkScreen(page, {
    ids: ['screen-result', 'settle-stamp', 'settle-detail', 'settle-retry', 'result-verify'],
    texts: ['settle-stamp', 'settle-retry', 'result-verify'],
    disjoint: ['settle-detail', 'result-btn-home', 'result-btn-share', 'result-btn-again'],
    url: /localhost:5178/, title: /Ponygogogo/,
  })
  // the stamp sits on the paper; the star button's transparent box covers that corner by design, so only the
  // paper rows are checked against it
  await checkScreen(page, { ids: ['settle-stamp'], disjoint: ['settle-stamp', 'result-prize', 'result-net-value'] })
  await expect(page.getByTestId('settle-stamp')).toHaveText(/结算失败|Failed/)
  await expect(page.getByTestId('settle-detail')).toContainText('stubbed RPC outage')
  await expect(page.getByTestId('settle-deadline')).toHaveText(/请在约 \d+ 分钟内结算，否则视为放弃/)
  await checkScreen(page, { ids: ['settle-deadline'], texts: ['settle-deadline'], disjoint: ['settle-deadline', 'settle-retry'] })
  await expect(page.getByTestId('result-prize')).toHaveText(/待链上验证|Awaiting chain/)
  await expect(page.getByTestId('result-verify')).toContainText(/待链上验证|awaiting chain/)
  // the settle-detail row sits below the button row
  const detail = (await page.getByTestId('settle-detail').boundingBox())!
  const home = (await page.getByTestId('result-btn-home').boundingBox())!
  expect(detail.y).toBeGreaterThanOrEqual(home.y + home.height - 2)
  expect(await settledOnChain(player)).toBeNull()

  outage = false
  await page.getByTestId('settle-retry').click()
  await expectSettled(page, player, 'retry-02')
})
