import {expect,test} from 'bun:test'
import {paidCardRule} from './cardRules.ts'
import {solvePaidCore} from './solver.ts'
import {newCardInput,pickAt} from './testkit.ts'
import {sampleHorse} from './trace.ts'
import {EV_CARD,EV_EXHAUST_ENTER,EV_EXHAUST_EXIT,EV_RESOURCE} from './events.ts'

function input(ids:number[]) {
  return newCardInput(ids,{playerHorseId:0,roster:[4,0,1,2,3],
    profiles:Array.from({length:5},()=>({base:300n,acceleration:150n,cap:1800n}))})
}
test('C22 payment enters exhaustion immediately while its 1000 extra speed survives the base cap',()=>{
  const core=pickAt(input([22]),1,22)
  const r=solvePaidCore(core),h=0,t=r.events.find(e=>e.horse===h&&e.code===EV_CARD&&e.arg===22n)!.tau
  expect(paidCardRule(22).fixedSpeed).toBe(1000)
  expect(r.events.find(e=>e.horse===h&&e.code===EV_EXHAUST_ENTER)!.tau).toBe(t)
  expect(r.events.find(e=>e.horse===h&&e.code===EV_RESOURCE&&e.tau===t)!.arg).toBeLessThan(0n)
  expect(sampleHorse(r.trace!,h,t)).toMatchObject({stamina:0n,b:1200000n,v:2200000n,exhausted:true})
  expect(r.events.find(e=>e.horse===h&&e.code===EV_EXHAUST_EXIT)!.tau).toBe(t+9000n)
  expect(sampleHorse(r.trace!,h,t+9000n)).toMatchObject({b:1200000n,v:2200000n,exhausted:false})
  expect(sampleHorse(r.trace!,h,t+13000n).v).toBe(2800000n)
  const dist=sampleHorse(r.trace!,h,t+13000n).dist-sampleHorse(r.trace!,h,t).dist
  expect(2800000n*13000n-dist).toBe(6600000000n)
  expect(sampleHorse(r.trace!,h,t+14000n).v).toBe(1800000n)
})
test('C22 under active C16 retains one stamina and does not enter exhaustion',()=>{
  let core=pickAt(input([16,22]),1,16);core=pickAt(core,2,22)
  const r=solvePaidCore(core),t=r.events.find(e=>e.horse===0&&e.code===EV_CARD&&e.arg===22n)!.tau
  expect(sampleHorse(r.trace!,0,t)).toMatchObject({stamina:1000000n,v:2800000n,exhausted:false})
  expect(r.events.some(e=>e.horse===0&&e.code===EV_EXHAUST_ENTER&&e.tau===t)).toBe(false)
})
test('C26 sixty-percent cost adds to rocket half-cost without changing its thirty-percent speed',()=>{
  let core=pickAt(input([7,26]),1,7);core=pickAt(core,2,26)
  const r=solvePaidCore(core),t=r.events.find(e=>e.horse===0&&e.code===EV_CARD&&e.arg===26n)!.tau
  expect(paidCardRule(26).costDeltaBps).toBe(6000)
  const f=r.trace!.keyframes[0]!.filter(f=>f.tau0<=t).at(-1)!
  expect(f.stamina.cost).toBe(22000n)
  expect(sampleHorse(r.trace!,0,t).pBps).toBe(4500n)
})
test('C08 grants ten percent and C32 preserves the full sixty-second renewal with its independent ten percent',()=>{
  let core=pickAt(input([8,32]),1,8);core=pickAt(core,2,32)
  const r=solvePaidCore(core),t=r.events.find(e=>e.horse===0&&e.code===EV_CARD&&e.arg===32n)!.tau
  expect(paidCardRule(8).pBps).toBe(1000)
  expect(sampleHorse(r.trace!,0,t).pBps).toBe(2000n)
  const buff=r.trace!.instances.find(i=>i.horse===0&&i.cardId===32&&i.kind==='buff')!
  expect(buff.plannedEndTau).toBe(t+60000n)
})
