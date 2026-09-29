/**
 * 把根 EOA 里的原生 MON 迁入 sma-b 的金额规划。纯计算，不碰网络。
 *
 * Monad 按 gas 上限而不是实际用量收费，所以留给手续费的是 `gasLimit × maxFeePerGas` 整额；
 * 实际扣费不会超过它，余下的零头留在根地址。迁移是根地址唯一会发的交易，
 * 属于 Monad 储备余额规则里的「清空交易」（未委托、前 k 块内没有别的交易），允许把余额降到 10 MON 以下。
 */
import { MON } from './amount.ts'

/** 扣掉手续费后低于这个数就不迁：不值得为零头签一次名 */
export const MIGRATION_MIN_WEI = MON / 1000n
/** 根地址余额达到这个数才在钱包里露出迁移入口，平时根地址只剩手续费零头 */
export const MIGRATION_OFFER_WEI = MON / 100n

export type MigrationPlan =
  | { ok: true; amount: bigint; feeReserve: bigint }
  | { ok: false; reason: 'too-small'; feeReserve: bigint }

export function planMigration(balance: bigint, gasLimit: bigint, maxFeePerGas: bigint): MigrationPlan {
  const feeReserve = gasLimit * maxFeePerGas
  const amount = balance - feeReserve
  if (amount < MIGRATION_MIN_WEI) return { ok: false, reason: 'too-small', feeReserve }
  return { ok: true, amount, feeReserve }
}

export function shouldOfferMigration(rootBalance: bigint | null): boolean {
  return rootBalance !== null && rootBalance >= MIGRATION_OFFER_WEI
}
