import { paidCardRule } from './cardRules.ts'

/** C-22 pays up to 300 stamina; its extra speed does not scale with payment. */
export function staminaPayment(stamina: bigint): { paid: bigint } {
  const r = paidCardRule(22), budget = BigInt(r.staminaMicro!)
  const paid = stamina < budget ? stamina : budget
  return { paid }
}

/** All direct card restoration adds its full amount, including above the capacity. */
export function restoredStamina(stamina: bigint, amount: bigint): bigint {
  return stamina + amount
}
