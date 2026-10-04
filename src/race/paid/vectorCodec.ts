import type { Hex } from 'viem'
import type { PaidDrawState } from '../core/paidDrawRules.ts'
import {
  solvePaidCore, type PaidChoiceSlot, type PaidChoiceSlots, type PaidCoreInput, type PaidPanelMode, type PaidSolveResult,
} from './solver.ts'

/** JSON shape of tests/vectors/paid-race-v4.json: every bigint is a decimal string, small ids stay numbers. */
export type PaidVectorSlot = { txSec: string; cardId: number; refreshSlots: number[]; anchor: Hex }
export type PaidVectorInput = {
  roster?: number[]
  profiles: { base: string; acceleration: string; cap: string }[]
  playerHorseId: number
  playerDeck: number[]
  cpuDecks: number[][]
  seed: Hex
  openAnchor: Hex
  choices: (PaidVectorSlot | null)[]
}
export type PaidVectorCheckpoint = {
  reached: boolean
  mode: PaidPanelMode | null
  openTau: string
  openWall: string
  openSec: string
  deadlineSec: string
  closeWall: string
  closeTau: string
  reason: string
  cardId: number
  candidates: number[]
  invalidReason: number
}
export type PaidVectorEvent = { code: number; tau: string; horse: number; arg: string }
export type PaidVectorRace = {
  finishTime: string[]
  finishWall: string[]
  rawOrder: number[]
  settlementOrder: number[]
  rawRank: number
  settlementRank: number
  versionAnswer: boolean
  acquired: number[]
  acquiredByCheckpoint: number[]
  checkpoints: PaidVectorCheckpoint[]
  eventCount: number
  stepCount: number
  digest: Hex
  events: PaidVectorEvent[]
}
export type PaidVectorPanel = {
  status: string
  panel: {
    checkpoint: number
    mode: PaidPanelMode
    openTau: string
    openWall: string
    openSec: string
    deadlineSec: string
    drawState: PaidDrawState
    candidates: number[]
  } | null
  eventCount: number
  digest: Hex
}
export type PaidVectorCase = {
  name: string
  stakeTier?: number // present only for production-derived roster vectors
  input: PaidVectorInput
  stopAtPanel?: 1 | 2 | 3
  expected: PaidVectorRace | PaidVectorPanel
}

const str = (v: bigint) => v.toString()

export function encodeInput(input: PaidCoreInput): PaidVectorInput {
  return {
    profiles: input.profiles.map((p) => ({ base: str(p.base), acceleration: str(p.acceleration), cap: str(p.cap) })),
    ...(input.roster ? { roster: [...input.roster] } : {}),
    playerHorseId: input.playerHorseId,
    playerDeck: [...input.playerDeck],
    cpuDecks: input.cpuDecks.map((d) => [...d]),
    seed: input.seed,
    openAnchor: input.openAnchor,
    choices: input.choices.map((c) => c === null ? null
      : { txSec: str(c.txSec), cardId: c.cardId, refreshSlots: [...c.refreshSlots], anchor: c.anchor }),
  }
}

export function decodeInput(v: PaidVectorInput): PaidCoreInput {
  const slot = (c: PaidVectorSlot | null): PaidChoiceSlot | null => c === null ? null
    : { txSec: BigInt(c.txSec), cardId: c.cardId, refreshSlots: [...c.refreshSlots], anchor: c.anchor }
  return {
    profiles: v.profiles.map((p) => ({ base: BigInt(p.base), acceleration: BigInt(p.acceleration), cap: BigInt(p.cap) })),
    ...(v.roster ? { roster: [...v.roster] } : {}),
    playerHorseId: v.playerHorseId,
    playerDeck: [...v.playerDeck],
    cpuDecks: v.cpuDecks.map((d) => [...d]),
    seed: v.seed,
    openAnchor: v.openAnchor,
    choices: [slot(v.choices[0]!), slot(v.choices[1]!), slot(v.choices[2]!)] as PaidChoiceSlots,
  }
}

export function encodeRace(r: PaidSolveResult): PaidVectorRace {
  return {
    finishTime: r.finishTime.map(str),
    finishWall: r.finishWall.map(str),
    rawOrder: r.rawOrder,
    settlementOrder: r.settlementOrder,
    rawRank: r.rawRank,
    settlementRank: r.settlementRank,
    versionAnswer: r.versionAnswer,
    acquired: r.acquired,
    acquiredByCheckpoint: r.acquiredByCheckpoint,
    checkpoints: r.checkpoints.map((c) => ({
      reached: c.reached, mode: c.mode, openTau: str(c.openTau), openWall: str(c.openWall), openSec: str(c.openSec),
      deadlineSec: str(c.deadlineSec), closeWall: str(c.closeWall), closeTau: str(c.closeTau), reason: c.reason,
      cardId: c.cardId, candidates: c.candidates, invalidReason: c.invalidReason,
    })),
    eventCount: r.eventCount,
    stepCount: r.stepCount,
    digest: r.digest,
    events: r.events.map((e) => ({ code: e.code, tau: str(e.tau), horse: e.horse, arg: str(e.arg) })),
  }
}

export function encodePanel(r: PaidSolveResult): PaidVectorPanel {
  const p = r.panel
  return {
    status: r.status,
    panel: p === null ? null : {
      checkpoint: p.checkpoint, mode: p.mode, openTau: str(p.openTau), openWall: str(p.openWall), openSec: str(p.openSec),
      deadlineSec: str(p.deadlineSec), drawState: { ...p.drawState }, candidates: p.candidates,
    },
    eventCount: r.eventCount,
    digest: r.digest,
  }
}

/** Solves one case with the reference solver and returns its vector entry. */
export function solveVectorCase(name: string, input: PaidCoreInput, stopAtPanel?: 1 | 2 | 3): PaidVectorCase {
  if (stopAtPanel === undefined) {
    return { name, input: encodeInput(input), expected: encodeRace(solvePaidCore(input, { trace: false })) }
  }
  return { name, input: encodeInput(input), stopAtPanel, expected: encodePanel(solvePaidCore(input, { stopAtPanel, trace: false })) }
}
