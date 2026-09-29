import { describe, expect, test } from 'bun:test'
import { TX_IDLE, isTxBusy, txReducer, type TxEvent, type TxState } from './txStatus.ts'

const H1 = `0x${'11'.repeat(32)}` as const
const H2 = `0x${'22'.repeat(32)}` as const

function run(events: TxEvent[], from: TxState = TX_IDLE): TxState {
  return events.reduce(txReducer, from)
}

describe('fund transaction status', () => {
  test('sponsored call: signing → submitted with call id → included with the last receipt hash', () => {
    const submitted = run([{ type: 'start', kind: 'deposit' }, { type: 'submitted', callId: 'call-1' }])
    expect(submitted).toEqual({ phase: 'submitted', kind: 'deposit', callId: 'call-1', hash: null })
    expect(isTxBusy(submitted)).toBe(true)
    const pending = txReducer(submitted, { type: 'progress', progress: { state: 'pending', callId: 'call-1' } })
    expect(pending).toBe(submitted)
    const done = txReducer(pending, { type: 'progress', progress: { state: 'included', callId: 'call-1', transactionHashes: [H1, H2] } })
    expect(done).toEqual({ phase: 'included', kind: 'deposit', hash: H2 })
    expect(isTxBusy(done)).toBe(false)
  })

  test('a reverted call is a failure that keeps its hash for the explorer link', () => {
    const s = run([
      { type: 'start', kind: 'withdraw' },
      { type: 'submitted', callId: 'c' },
      { type: 'progress', progress: { state: 'failed', callId: 'c', transactionHashes: [H1] } },
    ])
    expect(s).toEqual({ phase: 'failed', kind: 'withdraw', hash: H1, reason: 'reverted' })
  })

  test('EOA transaction: hash first, then its receipt decides', () => {
    const base: TxEvent[] = [{ type: 'start', kind: 'migrate' }, { type: 'submitted', hash: H1 }]
    expect(run([...base, { type: 'receipt', status: 'success', hash: H1 }])).toEqual({ phase: 'included', kind: 'migrate', hash: H1 })
    expect(run([...base, { type: 'receipt', status: 'reverted', hash: H1 }])).toEqual({ phase: 'failed', kind: 'migrate', hash: H1, reason: 'reverted' })
  })

  test('running out of patience is "unconfirmed", never a reported failure', () => {
    const s = run([{ type: 'start', kind: 'deposit' }, { type: 'submitted', callId: 'c' }, { type: 'timeout' }])
    expect(s).toEqual({ phase: 'unconfirmed', kind: 'deposit', callId: 'c', hash: null })
    expect(isTxBusy(s)).toBe(false)
  })

  test('errors before and after submission', () => {
    expect(run([{ type: 'start', kind: 'deposit' }, { type: 'error', reason: 'rejected' }]))
      .toEqual({ phase: 'failed', kind: 'deposit', hash: null, reason: 'rejected' })
    expect(run([{ type: 'start', kind: 'migrate' }, { type: 'submitted', hash: H1 }, { type: 'error', reason: 'rpc' }]))
      .toEqual({ phase: 'failed', kind: 'migrate', hash: H1, reason: 'rpc' })
  })

  test('a second transaction cannot start while one is in flight, and stray events are ignored', () => {
    const busy = run([{ type: 'start', kind: 'deposit' }])
    expect(txReducer(busy, { type: 'start', kind: 'withdraw' })).toBe(busy)
    expect(txReducer(TX_IDLE, { type: 'submitted', callId: 'x' })).toBe(TX_IDLE)
    expect(txReducer(TX_IDLE, { type: 'receipt', status: 'success', hash: H1 })).toBe(TX_IDLE)
    expect(txReducer(TX_IDLE, { type: 'timeout' })).toBe(TX_IDLE)
    expect(txReducer(TX_IDLE, { type: 'error', reason: 'x' })).toBe(TX_IDLE)
    const included = run([{ type: 'start', kind: 'deposit' }, { type: 'submitted', hash: H1 }, { type: 'receipt', status: 'success', hash: H1 }])
    expect(txReducer(included, { type: 'progress', progress: { state: 'failed', callId: 'c', transactionHashes: [] } })).toBe(included)
    expect(txReducer(included, { type: 'start', kind: 'withdraw' })).toEqual({ phase: 'signing', kind: 'withdraw' })
    expect(txReducer(busy, { type: 'reset' })).toBe(TX_IDLE)
  })

  test('failure without receipts keeps the hash already known', () => {
    const s = run([
      { type: 'start', kind: 'deposit' },
      { type: 'submitted', callId: 'c', hash: H1 },
      { type: 'progress', progress: { state: 'failed', callId: 'c', transactionHashes: [] } },
    ])
    expect(s).toEqual({ phase: 'failed', kind: 'deposit', hash: H1, reason: 'reverted' })
  })
})
