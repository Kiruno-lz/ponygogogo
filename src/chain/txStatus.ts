/**
 * 钱包里一笔资金交易（充值、提款、根账户迁入）的界面状态机。
 *
 * 签名中 → 已提交（有调用 ID 或交易哈希）→ 已入块 / 失败 / 未确认。
 * 调用 ID 不是交易哈希，也不证明入块；「未确认」表示等满超时仍查不到终态——
 * 那时不能谎报失败，只能让玩家刷新余额去看链上的实际结果。
 */
import type { Hex } from 'viem'
import type { CallProgress } from './alchemy.ts'

export type TxKind = 'deposit' | 'withdraw' | 'migrate'

export type TxState =
  | { phase: 'idle' }
  | { phase: 'signing'; kind: TxKind }
  | { phase: 'submitted'; kind: TxKind; callId: string | null; hash: Hex | null }
  | { phase: 'included'; kind: TxKind; hash: Hex | null }
  | { phase: 'failed'; kind: TxKind; hash: Hex | null; reason: string }
  | { phase: 'unconfirmed'; kind: TxKind; callId: string | null; hash: Hex | null }

export type TxEvent =
  | { type: 'start'; kind: TxKind }
  | { type: 'submitted'; callId?: string; hash?: Hex }
  | { type: 'progress'; progress: CallProgress }
  | { type: 'receipt'; status: 'success' | 'reverted'; hash: Hex }
  | { type: 'timeout' }
  | { type: 'error'; reason: string }
  | { type: 'reset' }

export const TX_IDLE: TxState = { phase: 'idle' }

/** 签名或等待入块期间不允许再发第二笔：同一账户的并发交易会互相顶掉 nonce 或撞 Monad 的储备余额规则 */
export function isTxBusy(s: TxState): boolean {
  return s.phase === 'signing' || s.phase === 'submitted'
}

function lastHash(hashes: readonly Hex[]): Hex | null {
  return hashes.length > 0 ? hashes[hashes.length - 1]! : null
}

export function txReducer(s: TxState, e: TxEvent): TxState {
  switch (e.type) {
    case 'start':
      return isTxBusy(s) ? s : { phase: 'signing', kind: e.kind }
    case 'submitted':
      if (s.phase !== 'signing') return s
      return { phase: 'submitted', kind: s.kind, callId: e.callId ?? null, hash: e.hash ?? null }
    case 'progress': {
      if (s.phase !== 'submitted') return s
      const p = e.progress
      if (p.state === 'pending') return s
      const hash = lastHash(p.transactionHashes) ?? s.hash
      return p.state === 'included'
        ? { phase: 'included', kind: s.kind, hash }
        : { phase: 'failed', kind: s.kind, hash, reason: 'reverted' }
    }
    case 'receipt':
      if (s.phase !== 'submitted') return s
      return e.status === 'success'
        ? { phase: 'included', kind: s.kind, hash: e.hash }
        : { phase: 'failed', kind: s.kind, hash: e.hash, reason: 'reverted' }
    case 'timeout':
      if (s.phase !== 'submitted') return s
      return { phase: 'unconfirmed', kind: s.kind, callId: s.callId, hash: s.hash }
    case 'error':
      if (s.phase === 'signing') return { phase: 'failed', kind: s.kind, hash: null, reason: e.reason }
      if (s.phase === 'submitted') return { phase: 'failed', kind: s.kind, hash: s.hash, reason: e.reason }
      return s
    case 'reset':
      return TX_IDLE
  }
}
