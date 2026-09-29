import { describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import { PONY_GAME_ADDRESS, PONY_VAULT_ADDRESS } from './network.ts'
import {
  PAID_RACE_DEV_OVERRIDE, PAID_RACE_FEATURE, PRACTICE_TIER, isPaidRaceAvailable, isTierPlayable, paidContractsDeployed,
  paidEntry, paidRaceAvailable,
} from './paidGate.ts'

const VAULT = '0x1111111111111111111111111111111111111111' as const
const GAME = '0x2222222222222222222222222222222222222222' as const

/** 按地址给出固定字节码的假读取器；不在表里的地址没有代码 */
function codeReader(codes: Partial<Record<Address, Hex | undefined>>) {
  return { getCode: async ({ address }: { address: Address }) => codes[address] }
}

describe('paid race gate', () => {
  test('feature switch is on; the build gate then follows the configured addresses alone', () => {
    expect(PAID_RACE_FEATURE).toBe(true)
    // the dev override needs a Vite dev build; a test or production runtime never sees DEV === true
    expect(PAID_RACE_DEV_OVERRIDE).toBe(false)
    // bun test may or may not load a local .env; the gate must equal "both addresses configured" either way
    expect(paidRaceAvailable).toBe(isPaidRaceAvailable({ vault: PONY_VAULT_ADDRESS, game: PONY_GAME_ADDRESS, feature: true }))
  })

  test('needs both contract addresses and the feature switch', () => {
    expect(isPaidRaceAvailable({ vault: VAULT, game: GAME, feature: true })).toBe(true)
    expect(isPaidRaceAvailable({ vault: VAULT, game: GAME, feature: false })).toBe(false)
    expect(isPaidRaceAvailable({ vault: null, game: GAME, feature: true })).toBe(false)
    expect(isPaidRaceAvailable({ vault: VAULT, game: null, feature: true })).toBe(false)
    expect(isPaidRaceAvailable({ vault: VAULT, game: VAULT, feature: true })).toBe(false)
  })

  test('contracts count as deployed only when both addresses have code', async () => {
    expect(await paidContractsDeployed(codeReader({ [VAULT]: '0x60', [GAME]: '0x60' }), VAULT, GAME)).toBe(true)
    expect(await paidContractsDeployed(codeReader({ [VAULT]: '0x', [GAME]: '0x60' }), VAULT, GAME)).toBe(false)
    expect(await paidContractsDeployed(codeReader({ [VAULT]: '0x60' }), VAULT, GAME)).toBe(false)
    const down = { getCode: async () => { throw new Error('rpc down') } }
    await expect(paidContractsDeployed(down, VAULT, GAME)).rejects.toThrow('rpc down')
  })

  test('select screen entry: open only when built, deployed and signed in; otherwise the most useful hint', () => {
    expect(paidEntry(true, 'deployed', true)).toEqual({ open: true, hint: null })
    expect(paidEntry(false, 'checking', true)).toEqual({ open: false, hint: 'select.paidNotDeployed' })
    expect(paidEntry(true, 'missing', false)).toEqual({ open: false, hint: 'select.paidNotDeployed' })
    expect(paidEntry(true, 'deployed', false)).toEqual({ open: false, hint: 'select.paidLogin' })
    expect(paidEntry(true, 'checking', false)).toEqual({ open: false, hint: 'select.paidLogin' })
    expect(paidEntry(true, 'checking', true)).toEqual({ open: false, hint: 'select.paidChecking' })
  })

  test('practice tier is always playable, paid tiers only while the gate is open', () => {
    expect(isTierPlayable(PRACTICE_TIER, false)).toBe(true)
    for (const tier of [1, 2, 3, 4]) {
      expect(isTierPlayable(tier, false)).toBe(false)
      expect(isTierPlayable(tier, true)).toBe(true)
    }
    for (const tier of [5, -1, 1.5]) expect(isTierPlayable(tier, true)).toBe(false)
  })
})
