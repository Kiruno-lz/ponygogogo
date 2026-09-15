/**
 * 这个文件是全项目唯一允许出现「链」这个概念的地方。
 * 整个项目与链之间只有这一个接口。Demo 阶段由 mock.ts 实现，不连接钱包、RPC 或合约。
 */
import type { RaceResult } from '../race/core/types.ts'

export interface AccountInfo {
  /** 账户摘要，mock 生成，不对应任何真实账户 */
  address: string
  label: string
}

export interface ChainPort {
  connect(): Promise<AccountInfo>
  disconnect(): Promise<void>
  getAccount(): AccountInfo | null
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
