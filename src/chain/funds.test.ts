import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, type Address } from 'viem'
import type { CallAccount, CallProgress, ContractCall } from './alchemy.ts'
import { MON } from './amount.ts'
import { FundsError, depositToVault, trackCall, trackTransaction, withdrawFromVault, type FundsSnapshot } from './funds.ts'
import { vaultAbi } from './vault.ts'

const PLAYER = '0x1111111111111111111111111111111111111111' as Address
const VAULT = '0x2222222222222222222222222222222222222222' as Address
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

const ready = (wallet: bigint, available: bigint): FundsSnapshot => ({
  blockNumber: 1n, player: PLAYER, wallet, vault: { state: 'ready', address: VAULT, available },
})

async function code(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => null, (e: unknown) => e)
  return err instanceof FundsError ? err.code : String(err)
}

describe('vault deposit and withdraw', () => {
  test('deposit sends the payable call with value from the smart account', async () => {
    const { acct, sent } = account()
    expect(await depositToVault(acct, ready(MON, 0n), MON)).toBe('call-1')
    expect(sent).toHaveLength(1)
    const [call] = sent[0]!
    expect(call!.to).toBe(VAULT)
    expect(call!.value).toBe(MON)
    expect(decodeFunctionData({ abi: vaultAbi, data: call!.data }).functionName).toBe('deposit')
  })

  test('withdraw sends withdraw(amount) without value', async () => {
    const { acct, sent } = account()
    await withdrawFromVault(acct, ready(0n, 2n * MON), MON)
    const [call] = sent[0]!
    expect(call!.value).toBeUndefined()
    expect(decodeFunctionData({ abi: vaultAbi, data: call!.data })).toEqual({ functionName: 'withdraw', args: [MON] })
  })

  test('refuses what would certainly fail, before asking the user to sign', async () => {
    const notDeployed: FundsSnapshot = { blockNumber: 1n, player: PLAYER, wallet: MON, vault: { state: 'not-deployed', reason: 'unset' } }
    expect(await code(depositToVault(account().acct, notDeployed, 1n))).toBe('vault-not-deployed')
    expect(await code(depositToVault(account().acct, ready(MON, 0n), 0n))).toBe('invalid-amount')
    expect(await code(depositToVault(account().acct, ready(MON, 0n), MON + 1n))).toBe('insufficient-wallet')
    expect(await code(withdrawFromVault(account().acct, ready(0n, MON), MON + 1n))).toBe('insufficient-available')
    expect(await code(depositToVault(account(null).acct, ready(MON, 0n), 1n))).toBe('account-not-resolved')
    const other = account('0x3333333333333333333333333333333333333333')
    expect(await code(depositToVault(other.acct, ready(MON, 0n), 1n))).toBe('stale-funds')
    expect(other.sent).toHaveLength(0)
  })
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
