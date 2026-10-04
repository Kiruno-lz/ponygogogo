import { expect, test } from 'bun:test'
import { decodeFunctionData, encodeFunctionData } from 'viem'
import {
  chooseCardCall, forfeitSessionCall, openSessionCall, ponyGameAbi, sealAnchorsCall, settleSessionCall,
} from './paidCalls.ts'

const GAME = '0x1111111111111111111111111111111111111111' as const
const SESSION = `0x${'ab'.repeat(32)}` as const
const STAKE = 3n * 10n ** 17n // tier 1 = 0.3 MON

test('entry sends the complete stake directly to Game', () => {
  expect(openSessionCall(GAME, 2, STAKE)).toEqual({
    to: GAME, data: encodeFunctionData({ abi: ponyGameAbi, functionName: 'openSession', args: [2, STAKE] }), value: STAKE,
  })
})

test('entry rejects invalid horses, off-tier stakes and missing Game', () => {
  expect(() => openSessionCall(GAME, 5, STAKE)).toThrow('INVALID_PAID_ENTRY')
  expect(() => openSessionCall(GAME, 0, 0n)).toThrow('INVALID_PAID_ENTRY')
  expect(() => openSessionCall(GAME, 0, 5n * 10n ** 16n)).toThrow('INVALID_PAID_ENTRY')
  expect(() => openSessionCall(`0x${'00'.repeat(20)}`, 0, STAKE)).toThrow('INVALID_CONTRACT_ADDRESS')
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
