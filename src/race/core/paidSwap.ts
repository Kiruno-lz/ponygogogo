import { keccak256, toBytes, type Hex } from 'viem'
import { chainEntropy } from './chainEntropy.ts'

const SWAP_DOMAIN = keccak256(toBytes('swap'))

export function paidSwapTriggerMs(appliedAtMs: bigint, triggerIndex: number): bigint | null {
  if (appliedAtMs < 0n || !Number.isInteger(triggerIndex) || triggerIndex < 0) throw new Error('INVALID_SWAP_TRIGGER')
  return triggerIndex < 15 ? appliedAtMs + BigInt(triggerIndex) * 2000n : null
}

export type PaidSwapHorse = {
  laneIndex: number
  pos: bigint
  dist: bigint
  finished: boolean
  immune: boolean
}

/** One C-09 attempt; a blocked target still consumes its event index. */
export function paidSwap(
  horses: readonly PaidSwapHorse[], ownerHorseId: number,
  seed: Hex, cardAnchor: Hex, cardCheckpoint: number, triggerIndex: bigint,
) {
  if (horses.length !== 5 || !Number.isInteger(ownerHorseId) || ownerHorseId < 0 || ownerHorseId > 4
    || new Set(horses.map((horse) => horse.laneIndex)).size !== 5
    || horses.some((horse) => !Number.isInteger(horse.laneIndex) || horse.laneIndex < 0 || horse.laneIndex > 4)) {
    throw new Error('INVALID_SWAP_STATE')
  }
  const next = horses.map((horse) => ({ ...horse }))
  const owner = next[ownerHorseId]!
  const ownerLane = owner.laneIndex
  const draw = Number(chainEntropy(seed, cardAnchor, cardCheckpoint, SWAP_DOMAIN, triggerIndex) % 4n)
  const targetLane = draw >= ownerLane ? draw + 1 : draw
  const targetHorseId = next.findIndex((horse) => horse.laneIndex === targetLane)
  const target = next[targetHorseId]!
  if (owner.finished || owner.immune || target.finished || target.immune) {
    return { horses: next, targetHorseId, swapped: false }
  }
  const oldPos = owner.pos
  owner.pos = target.pos
  target.pos = oldPos
  owner.laneIndex = targetLane
  target.laneIndex = ownerLane
  return { horses: next, targetHorseId, swapped: true }
}
