import type { Hex } from 'viem'
import { derivePaidProfiles } from '../core/paidProfiles.ts'
import { EV_CHOICE_INVALID } from './events.ts'
import {
  solvePaidCore, type PaidChoiceSlot, type PaidChoiceSlots, type PaidCoreInput, type PaidCoreProfile,
  type PaidSolveResult,
} from './solver.ts'

/** Deterministic fixtures shared by the L1 tests and scripts/gen-paid-vectors.ts. */
export const FIXTURE_SEED: Hex = `0x${'11'.repeat(32)}`
export const FIXTURE_ANCHOR: Hex = `0x${'22'.repeat(32)}`

export function fixtureAnchor(n: number): Hex {
  return `0x${n.toString(16).padStart(2, '0').repeat(32)}` as Hex
}

/** Nine offered slots hold no-effect cards, so timeouts and forfeits leave the race untouched. */
export const QUIET_DECK: readonly number[] = [22, 23, 24, 25, 26, 20, 19, 1, 2, 6, 7, 8, 10, 12]
export const QUIET_CPU_DECK: readonly number[] = [24, 25, 26]

export function fixtureProfiles(playerHorseId = 1): PaidCoreProfile[] {
  return derivePaidProfiles(FIXTURE_SEED, FIXTURE_ANCHOR, 2, playerHorseId).map((p) => ({
    base: BigInt(p.base), acceleration: BigInt(p.acceleration), cap: BigInt(p.cap),
  }))
}

export type FixtureOverrides = Partial<Omit<PaidCoreInput, 'cpuDecks'>> & {
  /** Sparse CPU deck overrides by horseId; others stay quiet. */
  cpu?: Readonly<Record<number, readonly number[]>>
}

export function fixtureInput(over: FixtureOverrides = {}): PaidCoreInput {
  const playerHorseId = over.playerHorseId ?? 1
  const cpuDecks: number[][] = []
  for (let h = 0; h < 5; h++) cpuDecks.push([...(over.cpu?.[h] ?? QUIET_CPU_DECK)])
  return {
    profiles: over.profiles ?? fixtureProfiles(playerHorseId),
    playerHorseId,
    playerDeck: over.playerDeck ?? QUIET_DECK,
    cpuDecks,
    seed: over.seed ?? FIXTURE_SEED,
    openAnchor: over.openAnchor ?? FIXTURE_ANCHOR,
    choices: over.choices ?? [null, null, null],
  }
}

export function withSlot(input: PaidCoreInput, k: 1 | 2 | 3, slot: PaidChoiceSlot | null): PaidCoreInput {
  const choices = [...input.choices] as [PaidChoiceSlot | null, PaidChoiceSlot | null, PaidChoiceSlot | null]
  choices[k - 1] = slot
  return { ...input, choices: choices as PaidChoiceSlots }
}

export type PickOptions = { delaySec?: bigint; refreshSlots?: number[]; anchor?: Hex }

/** Records a real transaction for checkpoint k, timed from the canonical panel opening. */
export function pickAt(input: PaidCoreInput, k: 1 | 2 | 3, cardId: number, opts: PickOptions = {}): PaidCoreInput {
  const stop = solvePaidCore(input, { stopAtPanel: k, trace: false })
  if (stop.panel === null || stop.panel.mode !== 'manual') throw new Error('PANEL_NOT_MANUAL')
  return withSlot(input, k, {
    txSec: stop.panel.openSec + (opts.delaySec ?? 0n),
    cardId,
    refreshSlots: opts.refreshSlots ?? [],
    anchor: opts.anchor ?? fixtureAnchor(0x30 + k),
  })
}

export type IgnoredChoice = { reason: number; equivalent: boolean }

function eventKeys(r: PaidSolveResult, dropCheckpoint: number): string[] {
  return r.events
    .filter((e) => !(e.code === EV_CHOICE_INVALID && e.arg >> 4n === BigInt(dropCheckpoint)))
    .map((e) => `${e.code}:${e.tau}:${e.horse}:${e.arg}`)
}

function outcomeKey(r: PaidSolveResult, clearCheckpoint: number): string {
  const records = r.checkpoints.map((c) => ({ ...c, invalidReason: c.checkpoint === clearCheckpoint ? 0 : c.invalidReason }))
  return JSON.stringify([r.finishTime, r.finishWall, r.acquiredByCheckpoint, r.settlementOrder, r.stepCount, records],
    (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v)
}

/**
 * 有奖规则 v3 oracle: null when choice k takes effect; else its CHOICE_INVALID reason and whether the solve equals
 * the solve without that choice except for the one CHOICE_INVALID event (and the record's invalidReason).
 */
export function ignoredChoice(input: PaidCoreInput, k: 1 | 2 | 3): IgnoredChoice | null {
  const withChoice = solvePaidCore(input, { trace: false })
  const reason = withChoice.checkpoints[k - 1]!.invalidReason
  if (reason === 0) return null
  const without = solvePaidCore(withSlot(input, k, null), { trace: false })
  const equivalent = outcomeKey(withChoice, k) === outcomeKey(without, k)
    && JSON.stringify(eventKeys(withChoice, k)) === JSON.stringify(eventKeys(without, k))
  return { reason, equivalent }
}
