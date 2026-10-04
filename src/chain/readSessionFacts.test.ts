import { describe, expect, test } from 'bun:test'
import { keccak256, toHex, type Address, type Hex } from 'viem'
import { readSessionFacts, type SessionReader } from './paidSession.ts'
import { LEGACY_PAID_RULESET_HASH } from '../race/paid/cardRules.ts'

const GAME = '0x1111111111111111111111111111111111111111' as Address
const PLAYER = '0x3333333333333333333333333333333333333333' as Address
const SESSION = keccak256(toHex('session')) as Hex
const ZERO = `0x${'00'.repeat(32)}` as Hex
const SEALED = keccak256(toHex('sealed')) as Hex
const hashOf = (n: bigint) => keccak256(toHex(`block-${n}`)) as Hex

const choice = (blockNumber: bigint, anchor: Hex = ZERO) =>
  ({ present: true, txSec: 30, blockNumber, cardId: 5, refreshSlots: [], anchor })
const absent = { present: false, txSec: 0, blockNumber: 0n, cardId: 0, refreshSlots: [], anchor: ZERO }

/** getSession 给定视图；getBlock 交给 block() 决定何时、如何返回 */
function reader(choices: readonly unknown[], block: (n: bigint) => Promise<{ hash: Hex | null }>): SessionReader {
  return {
    readContract: (async ({ functionName }: { functionName: string }) => functionName === 'rulesetHash' ? LEGACY_PAID_RULESET_HASH : ({
      player: PLAYER, state: 1, playerHorseId: 2, stakeTier: 2, stake: 10n ** 17n, openedAt: 1_790_000_000n,
      openedBlock: 100n, seed: SEALED, openAnchor: ZERO, lastCheckpoint: 3, choices,
    })) as never,
    getBlock: (async ({ blockNumber }: { blockNumber: bigint }) => await block(blockNumber)) as never,
    getTransactionReceipt: (async () => { throw new Error('unused') }) as never,
    getLogs: (async () => []) as never,
    getBalance: (async () => 0n) as never,
  }
}

describe('readSessionFacts anchors', () => {
  test('unsealed anchors are all requested before any returns; results match the sequential read', async () => {
    const asked: bigint[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const pending = readSessionFacts(reader([choice(130n), choice(140n, SEALED), choice(150n)], async (n) => {
      asked.push(n)
      await gate
      return { hash: hashOf(n) }
    }), GAME, SESSION)
    await new Promise((r) => setTimeout(r, 0))
    // 逐个读时这里只会有开场锚一个在途；封存过的锚（第 2 个选择）不读块
    expect(asked).toEqual([100n, 130n, 150n])
    release()
    const facts = await pending
    expect(facts.openAnchor).toBe(hashOf(100n))
    expect(facts.choices.map((c) => c?.anchor)).toEqual([hashOf(130n), SEALED, hashOf(150n)])
    expect(facts.choices.map((c) => c?.checkpoint)).toEqual([1, 2, 3])
  })

  test('absent choices stay null and read no block', async () => {
    const asked: bigint[] = []
    const facts = await readSessionFacts(reader([choice(130n), absent, absent], async (n) => {
      asked.push(n)
      return { hash: hashOf(n) }
    }), GAME, SESSION)
    expect(asked).toEqual([100n, 130n])
    expect(facts.choices).toEqual([expect.objectContaining({ checkpoint: 1, anchor: hashOf(130n) }), null, null])
  })

  test('with several failures the error is the one the sequential read would hit first', async () => {
    let later!: () => void
    const slow = new Promise<void>((r) => { later = r })
    const pending = readSessionFacts(reader([choice(130n), choice(140n), absent], async (n) => {
      // 第 2 个选择立刻失败、开场锚晚一步才失败：Promise.all 会报先到的 rpc down，逐个读报的是开场锚
      if (n === 140n) throw new Error('rpc down')
      if (n === 100n) {
        await slow
        return { hash: null }
      }
      return { hash: hashOf(n) }
    }), GAME, SESSION)
    await new Promise((r) => setTimeout(r, 0))
    later()
    await expect(pending).rejects.toThrow('NO_BLOCK_HASH_100')
  })
})
