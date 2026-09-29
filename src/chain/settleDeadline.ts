/**
 * 结算期限（会话协议 v2）：没有退款，所需随机锚过窗（EIP-2935，8191 块）且未封存时任何人可判负，返还 0。
 *
 * 所需锚 = 开场块与每个已存选择所在块；已封存的锚不再过期。期限由最早未封存的那个决定：
 * 最后一个仍可读的块是 `b + 8191`，结算交易必须落在它之内，所以还剩 `b + 8191 − 链头` 块。
 * 块数按本会话实测的块时间折算（开场块到链头的平均值），再与默认值取小，只会把期限说得更早。
 */
import type { Hex } from 'viem'

/** RandomAnchor.HISTORY_WINDOW */
export const ANCHOR_HISTORY_BLOCKS = 8191n
/** 8191 块约 47 分钟（docs/plan/onchain-services.md「会话协议 v2」），即约 344 ms/块 */
export const DEFAULT_BLOCK_MS = 344
/** 少于这么多块时平均块时间受整秒时间戳影响太大，只用默认值 */
const MIN_SPAN_BLOCKS = 64n

const ZERO_HASH = `0x${'00'.repeat(32)}` as Hex

export type AnchorView = {
  openedAt: bigint
  openedBlock: bigint
  openAnchor: Hex
  choices: readonly { present: boolean; blockNumber: bigint; anchor: Hex }[]
}

export type ChainHead = { number: bigint; timestamp: bigint }

export type SettleDeadline =
  /** 所需锚都已封存：结算没有截止时间 */
  | { state: 'sealed' }
  | { state: 'open'; anchorBlock: bigint; blocksLeft: bigint; blockMs: number; msLeft: number }
  /** 最早的未封存锚已过窗（或只剩当前块）：结算必然失败，会话只能判负 */
  | { state: 'lost'; anchorBlock: bigint }

/** 最早未封存的所需锚所在块；都已封存为 null。 */
export function earliestUnsealedAnchor(view: AnchorView): bigint | null {
  const blocks: bigint[] = []
  if (view.openAnchor === ZERO_HASH) blocks.push(view.openedBlock)
  for (const c of view.choices) if (c.present && c.anchor === ZERO_HASH) blocks.push(c.blockNumber)
  return blocks.length === 0 ? null : blocks.reduce((a, b) => (b < a ? b : a))
}

/** 本会话实测的平均块时间（开场块 → 链头），不超过默认值。 */
export function measuredBlockMs(view: Pick<AnchorView, 'openedAt' | 'openedBlock'>, head: ChainHead): number {
  const span = head.number - view.openedBlock
  if (span < MIN_SPAN_BLOCKS) return DEFAULT_BLOCK_MS
  const ms = Number((head.timestamp - view.openedAt) * 1000n) / Number(span)
  return ms > 0 ? Math.min(DEFAULT_BLOCK_MS, ms) : DEFAULT_BLOCK_MS
}

export function settleDeadline(view: AnchorView, head: ChainHead): SettleDeadline {
  const anchorBlock = earliestUnsealedAnchor(view)
  if (anchorBlock === null) return { state: 'sealed' }
  const blocksLeft = anchorBlock + ANCHOR_HISTORY_BLOCKS - head.number
  if (blocksLeft <= 0n) return { state: 'lost', anchorBlock }
  const blockMs = measuredBlockMs(view, head)
  return { state: 'open', anchorBlock, blocksLeft, blockMs, msLeft: Math.floor(Number(blocksLeft) * blockMs) }
}

/** 界面文案用的整分钟数，向下取整（保守）；不到 1 分钟为 0。 */
export function deadlineMinutes(msLeft: number): number {
  return Math.max(0, Math.floor(msLeft / 60_000))
}
