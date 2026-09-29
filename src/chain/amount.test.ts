import { describe, expect, test } from 'bun:test'
import { MON, formatMon, formatMonTrim, parseMonAmount } from './amount.ts'

describe('formatMonTrim', () => {
  test('drops trailing zeros only after the point', () => {
    expect([MON * 9n / 10n, MON * 3n, MON * 15n, MON * 30n, MON * 100n, 0n].map((v) => formatMonTrim(v))).toEqual(['0.9', '3', '15', '30', '100', '0'])
    expect(formatMonTrim(MON * 3n / 10n + 1n, 4)).toBe('0.3')
  })
})

describe('formatMon', () => {
  test('truncates instead of rounding so a balance is never over-reported', () => {
    expect(formatMon(10n * MON)).toBe('10.00')
    expect(formatMon(MON - 1n)).toBe('0.99')
    expect(formatMon(MON - 1n, 4)).toBe('0.9999')
    expect(formatMon(0n)).toBe('0.00')
    expect(formatMon(5n * MON / 100n, 0)).toBe('0')
    expect(formatMon(-3n * MON / 2n)).toBe('-1.50')
  })
})

describe('parseMonAmount', () => {
  test('accepts plain decimal notations', () => {
    expect(parseMonAmount('1')).toEqual({ ok: true, wei: MON })
    expect(parseMonAmount(' 0.5 ')).toEqual({ ok: true, wei: MON / 2n })
    expect(parseMonAmount('.25')).toEqual({ ok: true, wei: MON / 4n })
    expect(parseMonAmount('3.')).toEqual({ ok: true, wei: 3n * MON })
    expect(parseMonAmount('0.000000000000000001')).toEqual({ ok: true, wei: 1n })
    expect(parseMonAmount('007.10')).toEqual({ ok: true, wei: 71n * MON / 10n })
  })

  test('rejects empty, zero and malformed input with a distinct reason', () => {
    expect(parseMonAmount('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseMonAmount('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(parseMonAmount('0')).toEqual({ ok: false, reason: 'zero' })
    expect(parseMonAmount('0.000')).toEqual({ ok: false, reason: 'zero' })
    for (const bad of ['.', '-1', '+1', '1e18', '1,5', '1.2.3', '0x10', 'abc', '1 000', '１']) {
      expect(parseMonAmount(bad)).toEqual({ ok: false, reason: 'format' })
    }
    expect(parseMonAmount('9'.repeat(41))).toEqual({ ok: false, reason: 'format' })
  })

  test('rejects more precision than wei can hold rather than truncating', () => {
    expect(parseMonAmount('0.0000000000000000001')).toEqual({ ok: false, reason: 'precision' })
  })
})
