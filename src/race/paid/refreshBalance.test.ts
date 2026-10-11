import { expect, test } from 'bun:test'
import { fixtureInput, pickAt } from './testkit.ts'
import { solvePaidCore } from './solver.ts'
import { sampleHorse } from './trace.ts'
import { paidCardRule } from './cardRules.ts'

function input(playerPony = 1) {
  return fixtureInput({playerHorseId:0,roster:[playerPony,...[0,1,2,3,4,5,6,7,8].filter(p=>p!==playerPony).slice(0,4)],
    profiles:Array.from({length:5},(_,h)=>h===0?{base:300n,acceleration:150n,cap:1800n}:{base:1200n,acceleration:12n,cap:1800n}),
    playerDeck:[5,19,20,7,8,14,15,16,17,18,21,1,2,3]})
}
test('Shadow starts with one legal refresh and no unconditional speed bonus',()=>{
  const core=input(), p=solvePaidCore(core,{stopAtPanel:1})
  expect(sampleHorse(p.trace!,0,0n).v).toBe(300000n)
  expect(p.panel!.drawState.refreshCredits).toBe(1)
  const chosen=pickAt(core,1,3,{refreshSlots:[0]})
  expect(solvePaidCore(chosen).checkpoints[0]!.invalidReason).toBe(0)
})
test('C05 adds three refreshes and accumulates with the unused Shadow credit',()=>{
  expect(paidCardRule(5).count).toBe(3)
  const core=pickAt(input(),1,5), p=solvePaidCore(core,{stopAtPanel:2}).panel!
  expect(p.drawState.refreshCredits).toBe(4)
  const after=solvePaidCore(pickAt(core,2,1,{refreshSlots:[0,1,2]}),{stopAtPanel:3})
  expect(after.checkpoints[1]!.invalidReason).toBe(0)
  expect(after.panel!.drawState.refreshCredits).toBe(1)
  expect(after.panel!.drawState.tailCursor).toBe(11)
})
test('Shadow used by a CPU does not grant the player a refresh or the CPU speed',()=>{
  const core=input(4);core.roster=[4,1,0,2,3]
  const r=solvePaidCore(core,{stopAtPanel:1})
  expect(r.panel!.drawState.refreshCredits).toBe(0)
  expect(sampleHorse(r.trace!,1,0n).pBps).toBe(0n)
})
