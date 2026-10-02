import { expect, test } from 'bun:test'
import { staminaPayment, restoredStamina } from './resources.ts'
for (const [stamina, paid, bps] of [[0n,0n,0n],[150n,150n,1750n],[300n,300n,3500n],[1000n,300n,3500n]]) {
  test(`C-22 resource boundary at ${stamina}`, () => expect(staminaPayment(stamina * 1_000_000n)).toEqual({ paid: paid * 1_000_000n, bps }))
}
test('ordinary recovery saturates and preserves existing overcap', () => {
  expect(restoredStamina(950_000_000n,300_000_000n)).toBe(1_000_000_000n)
  expect(restoredStamina(1_500_000_000n,300_000_000n)).toBe(1_500_000_000n)
  expect(restoredStamina(0n,300_000_000n)).toBe(300_000_000n)
})
