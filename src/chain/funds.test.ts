import { describe, expect, test } from 'bun:test'
import { type Address } from 'viem'
import type { CallAccount, CallProgress, ContractCall } from './alchemy.ts'
import { MON } from './amount.ts'
import { readFunds, trackCall, trackTransaction } from './funds.ts'

const PLAYER = '0x1111111111111111111111111111111111111111' as Address
const HASH = `0x${'ab'.repeat(32)}` as const

function account(address: Address | null = PLAYER, script: Array<CallProgress | Error> = []) {
  const sent: ContractCall[][] = []
  const acct: CallAccount = {
    getAddress: () => address,
    send: async (calls) => { sent.push([...calls]); return 'call-1' },
    progress: async () => {
      const next = script.shift()
      if (!next) return { state: 'pending', callId: 'call-1' }
      if (next instanceof Error) throw next
      return next
    },
  }
  return { acct, sent }
}

test('funds read the smart account MON balance at one uncached block', async () => {
  const requests: unknown[] = []
  const reader = {
    getBlockNumber: async (args: unknown) => { requests.push(args); return 7n },
    getBalance: async (args: unknown) => { requests.push(args); return MON },
  } as Parameters<typeof readFunds>[0]
  expect(await readFunds(reader, PLAYER)).toEqual({ blockNumber: 7n, player: PLAYER, wallet: MON })
  expect(requests).toEqual([{ cacheTime: 0 }, { address: PLAYER, blockNumber: 7n }])
})

describe('call tracking', () => {
  const fastClock = () => {
    let t = 0
    return { now: () => t, sleep: async (ms: number) => { t += ms } }
  }

  test('reports every progress and stops at inclusion, riding out transient errors', async () => {
    const seen: string[] = []
    const { acct } = account(PLAYER, [new Error('flaky'), { state: 'pending', callId: 'call-1' },
      { state: 'included', callId: 'call-1', transactionHashes: [HASH] }])
    const result = await trackCall(acct, 'call-1', { ...fastClock(), onProgress: (p) => seen.push(p.state) })
    expect(result).toEqual({ state: 'included', callId: 'call-1', transactionHashes: [HASH] })
    expect(seen).toEqual(['pending', 'included'])
  })

  test('gives up as timeout, not as failure', async () => {
    const { acct } = account()
    expect(await trackCall(acct, 'call-1', { ...fastClock(), pollMs: 1000, timeoutMs: 5000 })).toEqual({ state: 'timeout', callId: 'call-1' })
  })

  test('EOA receipts: missing receipt means keep waiting', async () => {
    let calls = 0
    const client = {
      getTransactionReceipt: async () => {
        if (calls++ < 2) throw new Error('not found')
        return { status: 'reverted' }
      },
    } as unknown as Parameters<typeof trackTransaction>[0]
    expect(await trackTransaction(client, HASH, fastClock())).toEqual({ state: 'reverted', hash: HASH })
    const never = { getTransactionReceipt: async () => { throw new Error('not found') } } as unknown as Parameters<typeof trackTransaction>[0]
    expect(await trackTransaction(never, HASH, { ...fastClock(), timeoutMs: 3000 })).toEqual({ state: 'timeout', hash: HASH })
  })
})
