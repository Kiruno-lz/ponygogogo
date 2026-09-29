import { expect, test } from 'bun:test'
import { keccak256, toBytes, type Hex } from 'viem'
import type { PaidTier } from '../core/paidProfiles.ts'
import { derivePaidCoreInput } from './race.ts'
import { solvePaidCore } from './solver.ts'
import { FIXTURE_ANCHOR, FIXTURE_SEED, fixtureAnchor, QUIET_CPU_DECK, QUIET_DECK, withSlot } from './testkit.ts'

/**
 * No effects: quiet decks everywhere, so only personalities, stamina and the time mapping remain. The expected values
 * are the frozen output of the pre-solver no-card race and no-effect timeline models (paidNoCardRace /
 * paidNoEffectTimeline, removed once the unified solver replaced them), so the solver keeps reproducing them.
 */
function quietCore(seed: Hex, anchor: Hex, tier: PaidTier, player: number) {
  const core = derivePaidCoreInput({ seed, openAnchor: anchor, stakeTier: tier, playerHorseId: player, choices: [null, null, null] })
  return { ...core, playerDeck: QUIET_DECK, cpuDecks: core.cpuDecks.map(() => [...QUIET_CPU_DECK]) }
}

test('no cards + three timeouts reproduces the frozen no-effect timeline exactly', () => {
  const r = solvePaidCore(quietCore(FIXTURE_SEED, FIXTURE_ANCHOR, 2, 1), { trace: false })
  expect(r.finishTime).toEqual([61449n, 63889n, 62279n, 63547n, 61651n])
  expect(r.finishWall).toEqual([117402n, 119842n, 118232n, 119500n, 117604n])
  expect(r.checkpoints.map((c) => c.openWall)).toEqual([19024n, 54280n, 87527n])
  expect(r.checkpoints.map((c) => c.closeWall)).toEqual([40000n, 75000n, 108000n])
  expect(r.rawOrder).toEqual([0, 4, 2, 3, 1])
})

test('an active forfeit at 20 s matches the frozen actual-choice timeline', () => {
  const input = withSlot(quietCore(FIXTURE_SEED, FIXTURE_ANCHOR, 2, 1), 1, { txSec: 20n, cardId: 0, refreshSlots: [], anchor: fixtureAnchor(1) })
  const r = solvePaidCore(input, { trace: false })
  expect(r.finishWall).toEqual([99402n, 101842n, 100232n, 101500n, 99604n])
  expect(r.checkpoints.map((c) => c.openWall)).toEqual([19024n, 36280n, 69527n])
})

/** [finishTime, finishWall, checkpoint openWall] per regression-seed-i (tier i % 4 + 1, player horse i % 5). */
const FROZEN: readonly (readonly bigint[])[][] = [
  [[63889n, 65575n, 63183n, 64301n, 67112n], [119842n, 121528n, 119136n, 120254n, 123065n], [19024n, 54280n, 87527n]],
  [[64133n, 63889n, 61695n, 61960n, 63082n], [120086n, 119842n, 117648n, 117913n, 119035n], [19024n, 54280n, 87527n]],
  [[60484n, 60261n, 63889n, 59774n, 59324n], [116437n, 116214n, 119842n, 115727n, 115277n], [19024n, 54280n, 87527n]],
  [[57009n, 55765n, 58872n, 63889n, 58260n], [112962n, 111718n, 114825n, 119842n, 114213n], [19024n, 54280n, 87527n]],
  [[68249n, 62034n, 67723n, 66193n, 63889n], [124202n, 117987n, 123676n, 122146n, 119842n], [19024n, 54280n, 87527n]],
  [[63889n, 63312n, 62488n, 63560n, 62614n], [119842n, 119265n, 118441n, 119513n, 118567n], [19024n, 54280n, 87527n]],
  [[59746n, 63889n, 58843n, 60952n, 59314n], [115699n, 119842n, 114796n, 116905n, 115267n], [19024n, 54280n, 87527n]],
  [[56202n, 57510n, 63889n, 57170n, 57916n], [112155n, 113463n, 119842n, 113123n, 113869n], [19024n, 54280n, 87527n]],
  [[66112n, 67408n, 67585n, 63889n, 68080n], [122065n, 123361n, 123538n, 119842n, 124033n], [19024n, 54280n, 87527n]],
  [[63426n, 61267n, 60836n, 61496n, 63889n], [119379n, 117220n, 116789n, 117449n, 119842n], [19024n, 54280n, 87527n]],
  [[63889n, 60856n, 59161n, 58431n, 60331n], [119842n, 116809n, 115114n, 114384n, 116284n], [19024n, 54280n, 87527n]],
  [[56591n, 63889n, 58617n, 55828n, 58664n], [112544n, 119842n, 114570n, 111781n, 114617n], [19024n, 54280n, 87527n]],
]

test('the frozen no-effect timelines hold across tiers, horses and seeds (no stamina event before any finish)', () => {
  for (let i = 0; i < FROZEN.length; i++) {
    const seed = keccak256(toBytes(`regression-seed-${i}`))
    const anchor = keccak256(toBytes(`regression-anchor-${i}`))
    const tier = (i % 4 + 1) as PaidTier
    const player = i % 5
    const r = solvePaidCore(quietCore(seed, anchor, tier, player), { trace: false })
    const [finishTime, finishWall, openWall] = FROZEN[i]!
    expect(r.finishTime).toEqual([...finishTime!])
    expect(r.finishWall).toEqual([...finishWall!])
    expect(r.checkpoints.map((c) => c.openWall)).toEqual([...openWall!])
    expect(r.events.some((e) => e.code === 24)).toBe(false)
  }
})
