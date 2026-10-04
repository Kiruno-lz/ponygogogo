import { expect, test } from 'bun:test'
import { encodeAbiParameters, keccak256, padHex } from 'viem'
import { REWARD_ASSETS, rewardSeed, selectReward, rewardAtRoll } from './rewardRules.ts'

test('collection draw chance has exact 1999/2000 boundary and excludes owned assets', () => {
  expect(rewardAtRoll(1999n, 0n, 0n)).toEqual(REWARD_ASSETS[0])
  expect(rewardAtRoll(2000n, 0n, 0n)).toBeNull()
  const owned = REWARD_ASSETS.reduce((mask, a) => mask | (1n << BigInt(a.bit)), 0n)
  expect(rewardAtRoll(0n, 0n, owned)).toBeNull()
  const first = REWARD_ASSETS[0]!
  expect(rewardAtRoll(0n, 0n, 1n << BigInt(first.bit))).toEqual(REWARD_ASSETS[1])
  const pony = REWARD_ASSETS.find(a => a.assetKind === 1)!
  const preceding = REWARD_ASSETS.filter(a => a.bit < pony.bit).reduce((sum, a) => sum + BigInt(a.weight), 0n)
  expect(rewardAtRoll(0n, preceding + 2n, 0n)).toEqual(pony)
  expect(rewardAtRoll(0n, preceding + 3n, 0n)).not.toEqual(pony)
})

test('reward seed matches abi.encode of settlement parent hash and context, never affects solver input', () => {
  const parent = padHex('0x1234', { size: 32 }), session = padHex('0xabcd', { size: 32 })
  const game = '0x0000000000000000000000000000000000000001', player = '0x0000000000000000000000000000000000000002'
  expect(rewardSeed(parent, 10143n, game, session, player)).toBe(keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'address' }],
    [parent, 10143n, game, session, player])))
  expect(selectReward(parent, 0n)).toEqual(selectReward(parent, 0n))
})
