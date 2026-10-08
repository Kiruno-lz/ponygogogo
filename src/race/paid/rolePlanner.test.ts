import {test,expect} from 'bun:test'
import {fixtureInput} from './testkit.ts'
import {solvePaidCore} from './solver.ts'
import {legalActions,play} from '../../../scripts/pony-balance-planner.ts'
import {classifyPaidDraw} from '../core/paidDrawRules.ts'

test('payout planner executes legal refreshes through the same production inputs it evaluates',()=>{
 const core=fixtureInput({playerHorseId:0,roster:[1,0,2,3,4],playerDeck:[5,19,20,7,8,14,15,16,17,18,21,1,2,3],
 profiles:Array.from({length:5},(_,h)=>h===0?{base:300n,acceleration:150n,cap:1800n}:{base:1200n,acceleration:12n,cap:1800n})})
 const panel=solvePaidCore(core,{stopAtPanel:1,trace:false}).panel!
 for(const a of legalActions(core,panel))expect(classifyPaidDraw(core.playerDeck,panel.drawState,a.refreshSlots,a.cardId)).toBe(0)
 const played=play(core,'expert')
 expect(played.result.checkpoints.every(cp=>cp.invalidReason===0)).toBe(true)
 expect(solvePaidCore(played.input,{trace:false}).digest).toBe(played.result.digest)
 expect(played.decisions).toHaveLength(3)
})
