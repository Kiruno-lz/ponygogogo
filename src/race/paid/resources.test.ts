import { expect, test } from 'bun:test'
import { staminaPayment, restoredStamina } from './resources.ts'
for (const [stamina, paid] of [[0n,0n],[150n,150n],[300n,300n],[1000n,300n]]) {
  test(`C-22 resource boundary at ${stamina}`, () => expect(staminaPayment(stamina * 1_000_000n)).toEqual({ paid: paid * 1_000_000n }))
}
test('direct restoration adds in full below and above capacity', () => {
  expect(restoredStamina(950_000_000n,300_000_000n)).toBe(1_250_000_000n)
  expect(restoredStamina(1_500_000_000n,300_000_000n)).toBe(1_800_000_000n)
  expect(restoredStamina(0n,300_000_000n)).toBe(300_000_000n)
})
