import {expect,test} from 'bun:test'
import {PAID_CARD_RULES,paidCardRule} from './cardRules.ts'
import {paidCardDef} from '../cards/paidCards.ts'
import {REWARD_ASSETS} from './rewardRules.ts'
import {fixtureInput,pickAt} from './testkit.ts'
import {solvePaidCore} from './solver.ts'
import {derivePaidDeck} from '../core/paidDeck.ts'
import {FIXTURE_SEED,FIXTURE_ANCHOR} from './testkit.ts'

const common=[4,6,11,13,16,22,26,30,31,32,38,39]
const rare=[7,29]
test('requested card qualities reach the rule table, runtime faces and reward eligibility',()=>{
 for(const id of common){
  expect(paidCardRule(id).rare).toBe(false)
  expect(paidCardDef(`C-${String(id).padStart(2,'0')}`)!.quality).toBe('common')
  expect(REWARD_ASSETS.some(a=>a.assetKind===0&&a.assetId===id)).toBe(false)
 }
 for(const id of rare){
  expect(paidCardRule(id).rare).toBe(true)
  expect(paidCardDef(`C-${String(id).padStart(2,'0')}`)!.quality).toBe('rare')
  expect(REWARD_ASSETS.some(a=>a.assetKind===0&&a.assetId===id)).toBe(true)
 }
 expect(PAID_CARD_RULES.filter(c=>c.rare).map(c=>c.id)).toEqual([2,3,5,7,9,10,18,21,29,34,35,37,40])
})
test('Kiruno bonuses follow changed quality; ordinary C04 keeps its own future-card bonuses',()=>{
 for(const id of [4,7,16,29]){
  const deck=[id,...Array.from({length:40},(_,n)=>n+1).filter(c=>c!==id)].slice(0,14)
  const core=fixtureInput({playerHorseId:0,roster:[0,1,2,3,4],playerDeck:deck})
  const r=solvePaidCore(pickAt(core,1,id)),traits=r.trace!.instances.filter(i=>i.horse===0&&i.cardId===id&&i.ponyId===0)
  expect(traits.length).toBe(rare.includes(id)?1:0)
  if(id===4)expect(r.trace!.instances.some(i=>i.horse===0&&i.kind==='bonus'&&i.initialP===2000n)).toBe(true)
 }
 const deck=derivePaidDeck(FIXTURE_SEED,FIXTURE_ANCHOR)
 expect(deck.slice(12).every(id=>paidCardRule(id).rare)).toBe(true)
})
