/** 玩家资金只读取智能账户的原生 MON；比赛开场直接支付，结算直接收款。 */
import type { Address, Hex, PublicClient } from 'viem'
import type { CallAccount, CallProgress } from './alchemy.ts'

export type FundsSnapshot = {
  readonly blockNumber: bigint
  readonly player: Address
  readonly wallet: bigint
}

type FundsReader = Pick<PublicClient, 'getBlockNumber' | 'getBalance'>

export async function readFunds(client: FundsReader, player: Address): Promise<FundsSnapshot> {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
  const wallet = await client.getBalance({ address: player, blockNumber })
  return { blockNumber, player, wallet }
}

export type TrackOptions = {
  pollMs?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  onProgress?: (progress: CallProgress) => void
}

export type TrackResult = CallProgress | { state: 'timeout'; callId: string }

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 轮询调用状态直到入块、失败或超时。单次查询出错按「还没结果」处理继续等；
 * 超时不是失败——交易可能已上链，调用方应提示玩家刷新余额核对。
 */
export async function trackCall(account: CallAccount, callId: string, opts: TrackOptions = {}): Promise<TrackResult> {
  const { pollMs = 1000, timeoutMs = 90_000, sleep = defaultSleep, now = Date.now, onProgress } = opts
  const deadline = now() + timeoutMs
  for (;;) {
    const progress = await account.progress(callId).catch(() => null)
    if (progress) {
      onProgress?.(progress)
      if (progress.state !== 'pending') return progress
    }
    if (now() >= deadline) return { state: 'timeout', callId }
    await sleep(pollMs)
  }
}

export type ReceiptResult = { state: 'success' | 'reverted'; hash: Hex } | { state: 'timeout'; hash: Hex }

/** 普通 EOA 交易（根账户迁入）的回执轮询，语义同 `trackCall`。 */
export async function trackTransaction(
  client: Pick<PublicClient, 'getTransactionReceipt'>, hash: Hex, opts: Omit<TrackOptions, 'onProgress'> = {},
): Promise<ReceiptResult> {
  const { pollMs = 1000, timeoutMs = 90_000, sleep = defaultSleep, now = Date.now } = opts
  const deadline = now() + timeoutMs
  for (;;) {
    try {
      const receipt = await client.getTransactionReceipt({ hash })
      return { state: receipt.status === 'success' ? 'success' : 'reverted', hash }
    } catch {
      // 还没入块（TransactionReceiptNotFoundError）与网络抖动同样处理：继续等到超时
    }
    if (now() >= deadline) return { state: 'timeout', hash }
    await sleep(pollMs)
  }
}
