import { expect, test } from 'bun:test'
import { decodeFunctionData, encodeFunctionData, parseAbi } from 'viem'
import {
  chooseCardCall, forfeitSessionCall, openSessionCalls, ponyGameAbi, sealAnchorsCall, settleSessionCall,
} from './paidCalls.ts'

const GAME = '0x1111111111111111111111111111111111111111' as const
const VAULT = '0x2222222222222222222222222222222222222222' as const
const SESSION = `0x${'ab'.repeat(32)}` as const
const STAKE = 3n * 10n ** 17n // tier 1 = 0.3 MON

test('entry batches a deposit for the shortfall only, then openSession', () => {
  const full = openSessionCalls(VAULT, GAME, 2, STAKE, STAKE)
  expect(full).toEqual([
    { to: VAULT, data: encodeFunctionData({ abi: parseAbi(['function deposit() payable']), functionName: 'deposit' }), value: STAKE },
    { to: GAME, data: encodeFunctionData({ abi: parseAbi(['function openSession(uint8,uint256)']), functionName: 'openSession', args: [2, STAKE] }) },
  ])
  const part = openSessionCalls(VAULT, GAME, 2, STAKE, 1n)
  expect(part[0]).toMatchObject({ to: VAULT, value: 1n })
  const none = openSessionCalls(VAULT, GAME, 2, STAKE, 0n)
  expect(none).toEqual([full[1]!])
})

test('entry rejects bad horses, off-tier stakes, bad shortfalls and a vault equal to the game', () => {
  expect(() => openSessionCalls(VAULT, GAME, 5, STAKE, 0n)).toThrow('INVALID_PAID_ENTRY')
  expect(() => openSessionCalls(VAULT, GAME, 0, 5n * 10n ** 16n, 0n)).toThrow('INVALID_PAID_ENTRY') // v1 0.05 MON
  expect(() => openSessionCalls(VAULT, GAME, 0, 0n, 0n)).toThrow('INVALID_PAID_ENTRY')
  expect(() => openSessionCalls(VAULT, GAME, 0, STAKE, STAKE + 1n)).toThrow('INVALID_PAID_ENTRY')
  expect(() => openSessionCalls(VAULT, GAME, 0, STAKE, -1n)).toThrow('INVALID_PAID_ENTRY')
  expect(() => openSessionCalls(GAME, GAME, 0, STAKE, 0n)).toThrow('INVALID_PAID_ENTRY')
  expect(() => openSessionCalls(`0x${'00'.repeat(20)}`, GAME, 0, STAKE, 0n)).toThrow('INVALID_CONTRACT_ADDRESS')
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
