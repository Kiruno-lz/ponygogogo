import type { Hex } from 'viem'
import type { CollectibleGrant } from '../chain/rewards.ts'
import type { DeadlineView } from '../ui/race/paidText.ts'

export type PaidSettlePhase = 'waiting' | 'pending' | 'settled' | 'failed' | 'forfeited'

/** 有奖结算页的全部链上相关展示；金额一律 wei。 */
export interface PaidResultView {
  stakeLabel: string
  stake: bigint
  /** 浏览器预览的结算名次（待链上验证） */
  previewRank: number
  phase: PaidSettlePhase
  /** 已提交的结算交易（可能尚未入块） */
  txHash: Hex | null
  /** 等待中的说明或失败原因 */
  detail: string | null
  settlement: { rank: number; payout: bigint } | null
  /** 链上名次与预览不一致 */
  mismatch: boolean
  /** 结算期限（冲线后、结算前显示） */
  deadline: DeadlineView
  /** 每个检查点在没有卡时的说明（断卡、自动、冲线时关闭等） */
  choiceNotes: (string | null)[]
  onRetry: () => void
  grant?: CollectibleGrant | null
  grantError?: string | null
  onRetryGrant?: () => void
}

