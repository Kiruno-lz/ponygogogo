import {expect,test} from 'bun:test'
import {ponyRule} from './ponyRules.ts'
import {solvePaidCore} from './solver.ts'
import {fixtureInput,pickAt,newCardInput} from './testkit.ts'
import {sampleHorse} from './trace.ts'
import {EV_DEATH,EV_EXHAUST_ENTER,EV_EXHAUST_EXIT,EV_BASE_CAP,EV_CARD} from './events.ts'
import {idlePaidState} from '../paidSnapshot.ts'
import {FP} from '../core/fixed.ts'

test('role proposal fields use the approved starting values',()=>{
 expect([ponyRule(0).bonusBps,ponyRule(3).bonusBps,ponyRule(4).bonusBps,ponyRule(5).costDeltaBps,ponyRule(6).bonusBps]).toEqual([400,300,2500,1000,1600])
 expect(ponyRule(2)).toMatchObject({equipmentDurationBps:15000,bonusBps:1000})
})
function modern(cpu:number[]=[19,20,5]){
 return fixtureInput({playerHorseId:0,roster:[4,1,0,2,3],
  profiles:Array.from({length:5},(_,h)=>h===0?{base:300n,acceleration:150n,cap:1800n}:{base:1200n,acceleration:12n,cap:1800n}),
  cpu:{1:cpu,2:[19,20,5],3:[19,20,5],4:[19,20,5]}})
}
test('CPU death recovers at 150 to its own cap then restores its profile acceleration',()=>{
 const core=modern([2,15,19]);core.profiles=core.profiles.map((p,h)=>h===1?{base:600n,acceleration:12n,cap:1800n}:p)
 const r=solvePaidCore(core),death=r.events.find(e=>e.horse===1&&e.code===EV_DEATH)!
 const cap=r.events.find(e=>e.horse===1&&e.code===EV_BASE_CAP&&e.tau>death.tau)!
 expect(cap.tau-death.tau).toBe(12000n)
 const frame=r.trace!.keyframes[1]!.find(f=>f.tau0===death.tau)!
 expect(frame.motion.aEff).toBe(150n)
 expect(sampleHorse(r.trace!,1,death.tau+6000n).b).toBe(900000n)
})
test('CPU fatigue recovers fifteen per second to 135 and resumes with recovery acceleration',()=>{
 const core=modern([26,22,19]);core.profiles=core.profiles.map((p,h)=>h===1?{base:1000n,acceleration:0n,cap:1800n}:p)
 const r=solvePaidCore(core),entered=r.events.find(e=>e.horse===1&&e.code===EV_EXHAUST_ENTER)!,exit=r.events.find(e=>e.horse===1&&e.code===EV_EXHAUST_EXIT)!
 expect(exit.tau-entered.tau).toBe(9000n)
 expect(sampleHorse(r.trace!,1,entered.tau+1000n)).toMatchObject({stamina:15000000n,exhausted:true})
 expect(sampleHorse(r.trace!,1,exit.tau).stamina).toBe(135000000n)
 expect(r.trace!.keyframes[1]!.find(f=>f.tau0===exit.tau)!.motion.aEff).toBe(150n)
})
test('CPU fatigue caps high base speed at 1200 without the legacy ten-unit penalty',()=>{
 const core=modern([26,22,19]);core.profiles=core.profiles.map((p,h)=>h===1?{base:1800n,acceleration:0n,cap:1800n}:p)
 const r=solvePaidCore(core),e=r.events.find(e=>e.horse===1&&e.code===EV_EXHAUST_ENTER)!
 expect(sampleHorse(r.trace!,1,e.tau)).toMatchObject({b:1200000n,exhausted:true})
 expect(r.trace!.keyframes[1]!.find(f=>f.tau0===e.tau)!.motion.exhaustPenalty).toBe(0n)
})
test('Berry has one ten-percent equipment gate and a fifty-percent initial lifetime extension',()=>{
 let core=newCardInput([7,8,30],{playerHorseId:0,roster:[2,0,1,3,4],profiles:Array.from({length:5},()=>({base:1800n,acceleration:0n,cap:1800n}))})
 core=pickAt(core,1,7);core=pickAt(core,2,8);core=pickAt(core,3,30)
 const r=solvePaidCore(core),at=(id:number)=>r.events.find(e=>e.horse===0&&e.code===EV_CARD&&e.arg===BigInt(id))!.tau
 expect(sampleHorse(r.trace!,0,at(7)).pBps).toBe(2500n)
 expect(sampleHorse(r.trace!,0,at(8)).pBps).toBe(3500n)
 expect(r.trace!.instances.find(i=>i.horse===0&&i.cardId===7&&i.kind==='equip')!.plannedEndTau).toBe(at(7)+30000n)
})
test('Food player starts with capacity 400 in both solver and countdown; CPU capacity stays 1000',()=>{
 const core=modern();core.roster=[7,1,0,2,3]
 const r=solvePaidCore(core)
 expect(sampleHorse(r.trace!,0,0n).stamina).toBe(400000000n)
 expect(r.trace!.keyframes[0]![0]!.stamina.capacity).toBe(400000000n)
 expect(idlePaidState(0,0,core.roster).horses[0]!.stamina/FP).toBe(400)
 expect(sampleHorse(r.trace!,1,0n).stamina).toBe(1000000000n)
})
