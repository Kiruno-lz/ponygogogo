import { expect, test } from 'bun:test'
import { fixtureInput, pickAt } from '../../../src/race/paid/testkit.ts'
import { solvePaidCore } from '../../../src/race/paid/solver.ts'
import { classifyPaidDraw } from '../../../src/race/core/paidDrawRules.ts'
import { decidePonyAction, legalPonyActions, playPonyStrategy, ponyAbilityMetrics, staminaLedger } from '../../../scripts/pony-strategy-policy.ts'
import { ponyPreferences, ponyStrategyRosters, strategyPayoutBps } from '../../../scripts/analyze-pony-strategies.ts'

function scenario(pony: number, first: number[]) {
  const deck = [...first, ...Array.from({ length: 40 }, (_, n) => n + 1).filter(id => !first.includes(id))].slice(0, 14)
  return fixtureInput({ playerHorseId: 0, roster: [pony, ...[0,1,2,3,4,5,6,7,8].filter(id => id !== pony).slice(0,4)],
    playerDeck: deck, profiles: Array.from({length:5}, () => ({ base:1200n, acceleration:12n, cap:1800n })) })
}

test('every opponent combination has all 24 permutations and five player lanes', () => {
  for (let pony=0;pony<9;pony++) {
    const rows=[...ponyStrategyRosters(pony)]
    expect(rows).toHaveLength(8400)
    expect(new Set(rows.map(row=>row.roster.join(','))).size).toBe(8400)
    const combinations=new Map<string,number>()
    for (const row of rows) {
      expect(row.roster[row.lane]).toBe(pony)
      const key=row.roster.filter(id=>id!==pony).sort((a,b)=>a-b).join(',')
      combinations.set(key,(combinations.get(key)??0)+1)
    }
    expect(combinations.size).toBe(70)
    expect([...combinations.values()].every(count=>count===24*5)).toBe(true)
  }
})

test('return estimates read the actual Game schedule including breakeven third place', () => {
  expect(strategyPayoutBps()).toEqual([30000,15000,10000,0,0])
})

test('potential food preferences include immediate reserve recovery and repeat history survives equal-tau openings', () => {
  const food=ponyPreferences(7,[{mode:'manual',cardId:24,candidates:[24,17,19]}])
  expect(food[0]).toEqual({preferredOffered:true,preferredAcquired:true})
  const repeat=ponyPreferences(8,[{mode:'manual',cardId:17,candidates:[17,19,20]},
    {mode:'manual',cardId:27,candidates:[27,19,20]}])
  expect(repeat.map(record=>record.preferredAcquired)).toEqual([false,true])
})

test('rare specialization changes the choice between a compatible common speed card and a weak immediate rare card', () => {
  const kiruno = scenario(0, [27,21,19]), shadow = scenario(1, [27,21,19])
  expect(decidePonyAction(kiruno, 1).cardId).toBe(21)
  expect(decidePonyAction(shadow, 1).cardId).toBe(27)
})

test('repeat and diverse roles make opposite second-pick choices after a power acquisition', () => {
  const diverse = pickAt(scenario(3,[17,18,1,20,27,19]),1,17)
  const repeat = pickAt(scenario(8,[17,18,1,20,27,19]),1,17)
  expect(decidePonyAction(diverse,2).cardId).toBe(20)
  expect(decidePonyAction(repeat,2).cardId).toBe(27)
})

test('ox consumption changes a paid-resource follow-up from direct acceleration to phased supply', () => {
  const ox=pickAt(scenario(5,[22,19,20,23,1,17]),1,22)
  const neutral=pickAt(scenario(2,[22,19,20,23,1,17]),1,22)
  expect(decidePonyAction(ox,2).cardId).toBe(23)
  expect(decidePonyAction(neutral,2).cardId).toBe(1)
})

test('equipment extension matters early but cannot earn extra coverage after a near-finish acquisition', () => {
  const early=(pony:number)=>solvePaidCore(pickAt(scenario(pony,[11,19,20]),1,11))
  const berry=early(2),neutral=early(7)
  expect(ponyAbilityMetrics(berry,0,2).coverageTauMs).toBe(6000n)
  expect(berry.finishTime[0]).toBeLessThan(neutral.finishTime[0])
  const late=(pony:number)=>solvePaidCore(pickAt(pickAt(pickAt(
    scenario(pony,[17,19,20,18,21,22,11,23,24]),1,17),2,18),3,11))
  const lateBerry=late(2),lateNeutral=late(7)
  expect(ponyAbilityMetrics(lateBerry,0,2).coverageTauMs).toBe(0n)
  expect(lateBerry.finishTime[0]).toBe(lateNeutral.finishTime[0])
})

test('active forfeit is an evaluated action, distinct from waiting for timeout', () => {
  expect(decidePonyAction(scenario(6,[19,20,17]),1).cardId).toBe(0)
  const input = scenario(6,[19,20,17])
  const played = playPonyStrategy(input,'finish')
  expect(played.result.checkpoints[0].reason).toBe('forfeit-tx')
  expect(played.result.checkpoints.every(cp => cp.invalidReason === 0)).toBe(true)
})

test('refresh search emits only real tail cards and legal signed sequences', () => {
  const input = pickAt(scenario(0,[5,19,20]),1,5)
  const panel = solvePaidCore(input,{stopAtPanel:2}).panel!
  const actions = legalPonyActions(input,panel)
  expect(actions.some(action => action.refreshSlots.length === 1)).toBe(true)
  for (const action of actions) {
    expect(classifyPaidDraw(input.playerDeck,panel.drawState,action.refreshSlots,action.cardId)).toBe(0)
    expect(action.refreshSlots.length).toBeLessThanOrEqual(panel.drawState.refreshCredits)
  }
})

test('stamina trace ledger balances continuous changes and event jumps, including death', () => {
  const base = scenario(5,[2,19,20,15,17,18])
  base.profiles = Array.from({length:5}, () => ({base:800n,acceleration:3n,cap:1000n}))
  const input = pickAt(pickAt(base,1,2),2,15)
  const result = solvePaidCore(input)
  expect(result.events.some(e => e.horse === 0 && e.code === 15)).toBe(true)
  const ledger = staminaLedger(result,0)
  expect(ledger.initial + ledger.continuousGain - ledger.continuousLoss + ledger.eventGain - ledger.eventLoss).toBe(ledger.final)
  expect(ledger.eventGain).toBe(200_000_000n)
  expect(ledger.continuousLoss).toBeGreaterThan(0n)
})
