import { expect, test } from 'bun:test'
import { MON } from './amount.ts'
import { MIGRATION_MIN_WEI, MIGRATION_OFFER_WEI, planMigration, shouldOfferMigration } from './migration.ts'

const GWEI = 10n ** 9n

test('sends everything above the full gas-limit fee reserve', () => {
  const plan = planMigration(2n * MON, 21_000n, 122n * GWEI)
  expect(plan).toEqual({ ok: true, amount: 2n * MON - 21_000n * 122n * GWEI, feeReserve: 21_000n * 122n * GWEI })
})

test('skips when what would arrive is dust or nothing', () => {
  const reserve = 21_000n * 122n * GWEI
  expect(planMigration(reserve + MIGRATION_MIN_WEI - 1n, 21_000n, 122n * GWEI)).toEqual({ ok: false, reason: 'too-small', feeReserve: reserve })
  expect(planMigration(0n, 21_000n, 122n * GWEI)).toEqual({ ok: false, reason: 'too-small', feeReserve: reserve })
  expect(planMigration(reserve + MIGRATION_MIN_WEI, 21_000n, 122n * GWEI)).toEqual({ ok: true, amount: MIGRATION_MIN_WEI, feeReserve: reserve })
})

test('offers the action only for a meaningful root balance', () => {
  expect(shouldOfferMigration(null)).toBe(false)
  expect(shouldOfferMigration(MIGRATION_OFFER_WEI - 1n)).toBe(false)
  expect(shouldOfferMigration(MIGRATION_OFFER_WEI)).toBe(true)
})
