import { paidCardRule } from './cardRules.ts'
import { STAMINA_CAPACITY } from './constants.ts'

/** C-22 pays available stamina once; the multiplier floors at integer basis points. */
export function staminaPayment(stamina: bigint): { paid: bigint; bps: bigint } {
  const r = paidCardRule(22), budget = BigInt(r.staminaMicro!)
  const paid = stamina < budget ? stamina : budget
  return { paid, bps: BigInt(r.pBps!) * paid / budget }
}

/** Normal restoration preserves existing adrenaline overcap and cannot create new overcap. */
export function restoredStamina(stamina: bigint, amount: bigint): bigint {
  const room = stamina < STAMINA_CAPACITY ? STAMINA_CAPACITY - stamina : 0n
  return stamina + (amount < room ? amount : room)
}
