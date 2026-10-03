/**
 * 有奖比赛入口的唯一开关：App 的 startRace 与恢复入口都只看这里。
 *
 * 入口要同时满足三件事才开放：
 * 1. 构建期：代码里的功能开关打开，且 Vault、Game 两个地址都已配置（`paidRaceAvailable`）；
 * 2. 运行期：两个地址上都有合约代码（`paidContractsDeployed`，选马页打开时读一次链）；
 * 3. 游戏账户已连上。
 * 功能开关是源码常量而不是环境变量——部署时填上合约地址不能顺手把有奖场次打开。
 */
import { isAddressEqual, type Address, type Hex, type PublicClient } from 'viem'
import { PONY_GAME_ADDRESS, PONY_VAULT_ADDRESS } from './network.ts'

/** 自 2026-09-29 起在 Monad 测试网开放（会话协议 v2 / 有奖规则 v3 合约已部署并跑通）；地址与代码两道条件照旧 */
export const PAID_RACE_FEATURE: boolean = true

/**
 * 本地开发与 E2E 的覆盖：只在 **dev 构建**（`import.meta.env.DEV`）且 `VITE_PAID_RACE_DEV=1` 时生效，
 * 由 `DEV_CHAIN=anvil bash scripts/dev.sh` 写进 `.env.anvil.local`。生产构建里 DEV 被静态替换为 false，
 * 该覆盖不可达；它不读 URL 参数。
 */
export const PAID_RACE_DEV_OVERRIDE: boolean =
  import.meta.env?.DEV === true && import.meta.env?.VITE_PAID_RACE_DEV === '1'

/** 免费本地试玩：经 src/race/driver.ts 在本地跑与有奖相同的事件求时器，不建立链上会话、不碰任何余额，结果不构成奖金 */
export const PRACTICE_TIER = 0

export type PaidRaceConfig = { vault: Address | null; game: Address | null; feature: boolean }

export function isPaidRaceAvailable({ vault, game, feature }: PaidRaceConfig): boolean {
  return feature && vault !== null && game !== null && !isAddressEqual(vault, game)
}

export const paidRaceAvailable = isPaidRaceAvailable({
  vault: PONY_VAULT_ADDRESS,
  game: PONY_GAME_ADDRESS,
  feature: PAID_RACE_FEATURE || PAID_RACE_DEV_OVERRIDE,
})

const hasCode = (code: Hex | undefined) => code !== undefined && code !== '0x'

/** 两个地址上都有合约代码才算部署：地址配错、合约不在这条链上时有奖档保持关闭。读失败原样抛出 */
export async function paidContractsDeployed(
  client: Pick<PublicClient, 'getCode'>, vault: Address, game: Address,
): Promise<boolean> {
  const [v, g] = await Promise.all([client.getCode({ address: vault }), client.getCode({ address: game })])
  return hasCode(v) && hasCode(g)
}

/** 运行期那一道：checking = 还没读到（或上次读失败，下次进选马页再读） */
export type PaidDeployment = 'checking' | 'deployed' | 'missing'

/** 选马页的有奖入口：能不能选，灰着时给哪条说明（i18n 键）。合约缺失优先，其次是登录，最后是还在确认 */
export function paidEntry(
  built: boolean, deployment: PaidDeployment, signedIn: boolean,
): { open: boolean; hint: string | null } {
  if (!built || deployment === 'missing') return { open: false, hint: 'select.paidNotDeployed' }
  if (!signedIn) return { open: false, hint: 'select.paidLogin' }
  if (deployment === 'checking') return { open: false, hint: 'select.paidChecking' }
  return { open: true, hint: null }
}

/** 档位能否开赛：试玩档永远可以，有奖档（1–4）只在入口开放时可以 */
export function isTierPlayable(tier: number, paidOpen: boolean): boolean {
  if (tier === PRACTICE_TIER) return true
  return paidOpen && Number.isInteger(tier) && tier >= 1 && tier <= 4
}
