import { describe, expect, test } from 'bun:test'
import type { SmartWalletClient } from '@alchemy/wallet-apis'
import { toFunctionSelector, type Address } from 'viem'
import { AlchemyAccount } from './alchemy.ts'

const ROOT = '0x1111111111111111111111111111111111111111' as Address
const SMART = '0x2222222222222222222222222222222222222222' as Address

function fakeClient(overrides: Partial<Pick<SmartWalletClient, 'requestAccount' | 'sendCalls' | 'getCallsStatus' | 'grantPermissions'>> = {}) {
  const calls: unknown[] = []
  const client = {
    requestAccount: async (args: unknown) => {
      calls.push(['request', args])
      return { type: 'json-rpc', address: SMART }
    },
    sendCalls: async (args: unknown) => {
      calls.push(['send', args])
      return { id: 'call-1' }
    },
    getCallsStatus: async (args: unknown) => {
      calls.push(['status', args])
      return { status: 'pending', receipts: [] }
    },
    grantPermissions: async (args: unknown) => {
      calls.push(['grant', args])
      return { context: '0x1234' }
    },
    ...overrides,
  } as unknown as Pick<SmartWalletClient, 'requestAccount' | 'sendCalls' | 'getCallsStatus' | 'grantPermissions'>
  return { client, calls }
}

describe('independent Alchemy account', () => {
  test('requests sma-b with createAdditional and transacts from it', async () => {
    const { client, calls } = fakeClient()
    const account = new AlchemyAccount(client, ROOT, 'policy-test')
    expect(await account.resolve()).toBe(SMART)
    await account.send([{ to: ROOT, data: '0x' }])
    expect(calls[0]).toEqual(['request', {
      signerAddress: ROOT,
      creationHint: { accountType: 'sma-b', createAdditional: true },
    }])
    expect(calls[1]).toEqual(['send', {
      account: SMART, calls: [{ to: ROOT, data: '0x' }], capabilities: { paymaster: { policyId: 'policy-test' } },
    }])
  })

  test('requires a sponsorship policy before sending from an unfunded smart account', async () => {
    const { client } = fakeClient()
    const account = new AlchemyAccount(client, ROOT)
    await account.resolve()
    await expect(account.send([{ to: ROOT, data: '0x' }])).rejects.toThrow('ALCHEMY_POLICY_ID_REQUIRED')
  })

  test('rejects the root address and refuses an unresolved send', async () => {
    const { client } = fakeClient({ requestAccount: async () => ({ type: 'json-rpc', address: ROOT }) })
    const account = new AlchemyAccount(client, ROOT)
    await expect(account.send([{ to: SMART, data: '0x' }])).rejects.toThrow('ALCHEMY_ACCOUNT_NOT_RESOLVED')
    await expect(account.resolve()).rejects.toThrow('ALCHEMY_RETURNED_ROOT_ACCOUNT')
  })

  test('does not confuse a call ID with an included transaction', async () => {
    const { client } = fakeClient()
    const account = new AlchemyAccount(client, ROOT)
    expect(await account.progress('call-1')).toEqual({ state: 'pending', callId: 'call-1' })
  })

  test('exposes transaction hash only after a successful receipt', async () => {
    const hash = `0x${'ab'.repeat(32)}` as const
    const { client } = fakeClient({
      getCallsStatus: async () => ({
        status: 'success',
        receipts: [{ transactionHash: hash, status: 'success' }],
      }) as Awaited<ReturnType<SmartWalletClient['getCallsStatus']>>,
    })
    const account = new AlchemyAccount(client, ROOT)
    expect(await account.progress('call-1')).toEqual({ state: 'included', callId: 'call-1', transactionHashes: [hash] })
  })

  test('rejects a different account after the first resolution', async () => {
    let address = SMART
    const { client } = fakeClient({
      requestAccount: async () => ({ type: 'json-rpc', address }),
    })
    const account = new AlchemyAccount(client, ROOT)
    await account.resolve()
    address = '0x3333333333333333333333333333333333333333'
    await expect(account.resolve()).rejects.toThrow('ALCHEMY_ACCOUNT_CHANGED')
  })

  test('coalesces concurrent account requests', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let requests = 0
    const { client } = fakeClient({
      requestAccount: async () => {
        requests++
        await gate
        return { type: 'json-rpc', address: SMART }
      },
    })
    const account = new AlchemyAccount(client, ROOT)
    const first = account.resolve()
    const second = account.resolve()
    release?.()
    expect(await Promise.all([first, second])).toEqual([SMART, SMART])
    expect(requests).toBe(1)
  })

  test('agent session grants only the Game entry selector with a deadline', async () => {
    const { client, calls } = fakeClient()
    const account = new AlchemyAccount(client, ROOT)
    await account.resolve()
    const sessionKey = '0x3333333333333333333333333333333333333333' as Address
    const context = await account.grantAgentSession(ROOT, sessionKey, Math.floor(Date.now() / 1000) + 3600)
    expect(context).toBe('0x1234')
    expect(calls[1]).toEqual(['grant', {
      account: SMART,
      expirySec: expect.any(Number),
      key: { publicKey: sessionKey, type: 'secp256k1' },
      permissions: [{ type: 'functions-on-contract', data: {
        address: ROOT, functions: [toFunctionSelector('openAgentSession(uint8,uint256)')],
      } }],
    }])
  })
})
