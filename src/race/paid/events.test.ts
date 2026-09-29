import { expect, test } from 'bun:test'
import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from 'viem'
import {
  EV_CHOICE_INVALID, foldPaidEvent, INVALID_NOT_OFFERED, PAID_CHOICE_INVALID_NAMES, PAID_EVENT_NAMES, ZERO_DIGEST,
} from './events.ts'

const FIELDS = parseAbiParameters('bytes32 digest, uint8 code, uint32 tau, uint8 horse, int256 arg')

function reference(digest: Hex, code: number, tau: bigint, horse: number, arg: bigint): Hex {
  return keccak256(encodeAbiParameters(FIELDS, [digest, code, Number(tau), horse, arg]))
}

test('digest step equals keccak256(abi.encode(bytes32, uint8, uint32, uint8, int256))', () => {
  let digest = ZERO_DIGEST
  const cases: [number, bigint, number, bigint][] = [
    [1, 61_449n, 0, 100_001_901_288n], [21, 19_121n, 1, -1_000n], [9, 0n, 255, 0n],
    [27, 0xffff_ffffn, 4, (1n << 255n) - 1n], [3, 600_000n, 2, -(1n << 255n)],
  ]
  for (const [code, tau, horse, arg] of cases) {
    const next = foldPaidEvent(digest, code, tau, horse, arg)
    expect(next).toBe(reference(digest, code, tau, horse, arg))
    digest = next
  }
})

test('out-of-range event fields are rejected rather than truncated', () => {
  expect(() => foldPaidEvent(ZERO_DIGEST, 256, 0n, 0, 0n)).toThrow('INVALID_EVENT')
  expect(() => foldPaidEvent(ZERO_DIGEST, 1, -1n, 0, 0n)).toThrow('INVALID_EVENT')
  expect(() => foldPaidEvent(ZERO_DIGEST, 1, 1n << 32n, 0, 0n)).toThrow('INVALID_EVENT')
  expect(() => foldPaidEvent(ZERO_DIGEST, 1, 0n, 256, 0n)).toThrow('INVALID_EVENT')
  expect(() => foldPaidEvent(ZERO_DIGEST, 1, 0n, 0, 1n << 255n)).toThrow('INVALID_EVENT')
})

test('event code table is dense and unique', () => {
  const codes = Object.keys(PAID_EVENT_NAMES).map(Number)
  expect(codes).toEqual(Array.from({ length: 28 }, (_, i) => i + 1))
  expect(new Set(Object.values(PAID_EVENT_NAMES)).size).toBe(28)
  expect(PAID_EVENT_NAMES[EV_CHOICE_INVALID]).toBe('CHOICE_INVALID')
})

test('CHOICE_INVALID reasons are dense, unique and fit the low nibble of k·16 + reason', () => {
  const codes = Object.keys(PAID_CHOICE_INVALID_NAMES).map(Number)
  expect(codes).toEqual(Array.from({ length: INVALID_NOT_OFFERED }, (_, i) => i + 1))
  expect(new Set(Object.values(PAID_CHOICE_INVALID_NAMES)).size).toBe(codes.length)
  expect(Math.max(...codes)).toBeLessThan(16)
})
