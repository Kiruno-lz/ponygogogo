import { expect, test } from 'bun:test'
import { decodeFunctionData, encodeFunctionData } from 'viem'
import {
  chooseCardCall, forfeitSessionCall, openSessionCall, ponyGameAbi, sealAnchorsCall, settleSessionCall,
} from './paidCalls.ts'

const GAME = '0x1111111111111111111111111111111111111111' as const
const SESSION = `0x${'ab'.repeat(32)}` as const
const STAKE = 3n * 10n ** 17n // tier 1 = 0.3 MON

test('entry sends the complete stake directly to Game with the default roster', () => {
  expect(openSessionCall(GAME, 2, STAKE)).toEqual({
    to: GAME,
    data: encodeFunctionData({ abi: ponyGameAbi, functionName: 'openSession', args: [2, STAKE, [0, 1, 2, 3, 4]] }),
    value: STAKE,
  })
})

test('entry encodes the visible roster without an ownership gate and rejects malformed rosters', () => {
  const roster = [8, 5, 6, 7, 0] as const
  const call = openSessionCall(GAME, 2, STAKE, roster)
  expect(call.value).toBe(STAKE)
  const decoded = decodeFunctionData({ abi: ponyGameAbi, data: call.data })
  expect(decoded.functionName).toBe('openSession')
  expect(decoded.args).toEqual([2, STAKE, roster])
  for (const invalid of [[0, 1, 2, 3, 3], [0, 1, 2, 3, 9], [0, 1, 2, 3], [0, 1, 2, 3, 4, 5]]) {
    expect(() => openSessionCall(GAME, 0, STAKE, invalid)).toThrow()
  }
})

test('entry rejects invalid horses, off-tier stakes and missing Game', () => {
  expect(() => openSessionCall(GAME, 5, STAKE)).toThrow('INVALID_PAID_ENTRY')
  expect(() => openSessionCall(GAME, 0, 0n)).toThrow('INVALID_PAID_ENTRY')
  expect(() => openSessionCall(GAME, 0, 5n * 10n ** 16n)).toThrow('INVALID_PAID_ENTRY') // v1 0.05 MON
  expect(() => openSessionCall(`0x${'00'.repeat(20)}`, 0, STAKE)).toThrow('INVALID_CONTRACT_ADDRESS')
})

/** 直付×名单的 ABI 对等面：合约侧由 tests/contracts/PonyGameRoster.t.sol 钉同一组签名。 */
test('the entry ABI is payable openSession(uint8,uint256,uint8[5]) with a 9-field SessionOpened', () => {
  const open = ponyGameAbi.find((i) => i.type === 'function' && i.name === 'openSession')!
  expect(open).toMatchObject({ stateMutability: 'payable' })
  expect((open as { inputs: readonly { type: string }[] }).inputs.map((i) => i.type)).toEqual(['uint8', 'uint256', 'uint8[5]'])
  const opened = ponyGameAbi.find((i) => i.type === 'event' && i.name === 'SessionOpened')!
  expect((opened as { inputs: readonly { type: string }[] }).inputs.map((i) => i.type))
    .toEqual(['bytes32', 'address', 'uint8', 'uint256', 'bytes32', 'uint64', 'uint64', 'bytes32', 'uint8[5]'])
})

test('chooseCard encodes checkpoints 1..3, forfeit 0 and ordered refresh slots', () => {
  const call = chooseCardCall(GAME, SESSION, 3, 0, [2, 0])
  expect(call.to).toBe(GAME)
  const decoded = decodeFunctionData({ abi: ponyGameAbi, data: call.data })
  expect(decoded.functionName).toBe('chooseCard')
  expect(decoded.args).toEqual([SESSION, 3, 0, [2, 0]])
  for (const k of [1, 2, 3]) expect(() => chooseCardCall(GAME, SESSION, k, 40, [])).not.toThrow()
  for (const bad of [0, 4, 1.5]) expect(() => chooseCardCall(GAME, SESSION, bad, 1, [])).toThrow('INVALID_CARD_CHOICE')
  expect(() => chooseCardCall(GAME, SESSION, 1, 41, [])).toThrow('INVALID_CARD_CHOICE')
  expect(() => chooseCardCall(GAME, SESSION, 1, 1, [3])).toThrow('INVALID_CARD_CHOICE')
  expect(() => chooseCardCall(GAME, SESSION, 1, 1, [1, 1])).toThrow('INVALID_CARD_CHOICE')
  expect(() => chooseCardCall(GAME, SESSION, 1, 1, [0, 1, 2, 0])).toThrow('INVALID_CARD_CHOICE')
  expect(() => chooseCardCall(GAME, `0x${'00'.repeat(32)}`, 1, 1, [])).toThrow('INVALID_SESSION_ID')
})

test('settle, forfeit and seal target only the Game; there is no refund entry', () => {
  for (const [call, name] of [
    [settleSessionCall(GAME, SESSION), 'settleSession'],
    [forfeitSessionCall(GAME, SESSION), 'forfeitSession'],
    [sealAnchorsCall(GAME, SESSION), 'sealAnchors'],
  ] as const) {
    expect(call.to).toBe(GAME)
    expect(call.value).toBeUndefined()
    const decoded = decodeFunctionData({ abi: ponyGameAbi, data: call.data })
    expect(decoded.functionName).toBe(name)
    expect(decoded.args).toEqual([SESSION])
  }
  expect(() => settleSessionCall(GAME, '0x12')).toThrow('INVALID_SESSION_ID')
  const names = ponyGameAbi.map((i) => ('name' in i ? i.name : '')).filter((n) => /refund/i.test(n))
  expect(names).toEqual([])
})
