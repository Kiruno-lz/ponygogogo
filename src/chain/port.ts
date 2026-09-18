/**
 * 一局比赛与链之间的唯一接口：入场、结算、游戏余额。
 * 账户身份不在这里——那是 wallet.ts 的事，这个端口不知道「谁」在玩。
 *
 * 当前由 mock.ts 实现：还没有合约，下注与返还都是本地账，与钱包里的真实 MON 无关。
 */
import type { RaceResult } from '../race/core/types.ts'

export interface ChainPort {
  /** 游戏余额。合约上线前是本地账，不等于钱包链上余额 */
  getBalance(): Promise<bigint>
  enterRace(stake: bigint): Promise<{ seed: string; raceId: string }>
  settleRace(result: RaceResult): Promise<{ receiptId: string }>
  /** 读取最近一场战绩 */
  lastResult(): RaceResult | null
}

/** MON 的最小单位换算 */
export const MON = 1_000_000_000_000_000_000n

export function formatMon(v: bigint, digits = 2): string {
  const neg = v < 0n
  const abs = neg ? -v : v
  const whole = abs / MON
  const frac = ((abs % MON) * 10n ** BigInt(digits)) / MON
  const s = `${whole}.${frac.toString().padStart(digits, '0')}`
  return neg ? '-' + s : s
}
