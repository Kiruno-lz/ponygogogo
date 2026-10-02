/** Reproducible full-pool runs: actual derived decks, tail refreshes, finish cutoffs and CPU actions. */
import { readFileSync, writeFileSync } from 'node:fs'
import { keccak256, toBytes } from 'viem'
import { derivePaidCoreInput } from '../src/race/paid/race.ts'
import { solvePaidCore, type PaidCoreInput } from '../src/race/paid/solver.ts'
import { PAID_RULESET_HASH } from '../src/race/paid/cardRules.ts'
import { sampleHorse, sampleStatus } from '../src/race/paid/trace.ts'
import { EV_TRIGGER, EV_GUARD, EV_EQUIP_REFRESH } from '../src/race/paid/events.ts'
import { withSlot } from '../src/race/paid/testkit.ts'
const output = new URL('../tests/vectors/paid-card-builds.json', import.meta.url)
const plans = [[7,25],[16,26],[1,27],[28,33],[19,29],[31,7],[11,32],[2,37],[2,38],[39,0],[40,14]]
const samples = 80
function play(input: PaidCoreInput, pair: number[] | null) {
 let current = input, refreshes = 0
 const obtained = new Set<number>()
 for (const k of [1,2,3] as const) {
  const stop = solvePaidCore(current, { stopAtPanel:k })
  const p = stop.panel
  if (!p || p.mode !== 'manual') continue
  const desired = pair?.filter(id=>!obtained.has(id)) ?? []
  let offer = [...p.candidates], slots:number[]=[]
  if (pair && p.drawState.refreshCredits > 0 && !offer.some(id=>desired.includes(id))) {
   slots=[0]; offer[0]=current.playerDeck[p.drawState.tailCursor-1]!;refreshes++
  }
  let card:number
  if (!pair) {
   card=offer[Number(BigInt(keccak256(toBytes(`${current.seed}/choice/${k}`)))%3n)]!
  } else if (pair[0] === 39 && obtained.has(39) && !obtained.has(0)) card = 0
  else {
   const own=sampleHorse(stop.trace!,current.playerHorseId,p.openTau)
   const first=!Array.from({length:5},(_,h)=>h).some(h=>h!==current.playerHorseId && sampleHorse(stop.trace!,h,p.openTau).pos>=own.pos)
   const priorities=[...desired,5, own.stamina<400_000_000n?36:0, first?35:34,18,17,7,8,1,14,16,27,25]
   card=priorities.find(id=>id!==0&&offer.includes(id))??offer[0]!
  }
  current=withSlot(current,k,{txSec:p.openSec,cardId:card,refreshSlots:slots,anchor:keccak256(toBytes(`${input.seed}/tx/${k}`))})
  obtained.add(card)
 }
 const result=solvePaidCore(current)
 return {result,refreshes}
}
function synergy(result: ReturnType<typeof solvePaidCore>, pair: number[], h: number): boolean {
 const trace=result.trace!
 const active=(card:number,t:bigint)=>trace.instances.some(i=>i.horse===h&&i.cardId===card&&i.kind!=='bonus'&&i.startTau<=t&&(i.endTau===null||t<i.endTau))
 const event=(card:number)=>result.events.filter(e=>e.horse===h&&e.code===EV_TRIGGER&&e.arg/256n===BigInt(card))
 if(pair[0]===11) return result.events.some(e=>e.horse===h&&e.code===EV_EQUIP_REFRESH&&trace.instances[Number(e.arg)-1]?.cardId===11)
 if(pair[0]===31) return event(31).some(e=>sampleStatus(trace,h,e.tau).equipment.torso===7)
 if(pair[0]===39) return event(39).length>0
 if(pair[0]===2) {
  const luck=trace.instances.find(i=>i.horse===h&&i.cardId===2&&i.kind==='buff')
  if(!luck||luck.endReason!=='expired')return false
  return pair[1]===37?result.events.some(e=>e.horse===h&&e.code===EV_GUARD&&e.tau===luck.endTau):event(38).some(e=>e.tau===luck.endTau)
 }
 if(pair[0]===19) return trace.keyframes[h]!.some(f=>{
  if(!active(29,f.tau0))return false
  return trace.cards.filter(c=>c.horse===h&&c.tau<=f.tau0&&[19,20].includes(c.cardId)).at(-1)?.cardId===19
 })
 if(pair[0]===40) {
  const regen=trace.instances.find(i=>i.horse===h&&i.cardId===14&&i.kind==='buff')
  return !!regen&&active(40,regen.startTau)&&event(40).some(e=>e.tau>=regen.startTau)
 }
 return trace.keyframes[h]!.some(f=>{
  if(!pair.every(id=>active(id,f.tau0)))return false
  if(pair[0]===28) {const status=sampleStatus(trace,h,f.tau0);return !status.airborne&&Object.values(status.equipment).every(id=>id===0)}
  return true
 })
}
const rows = plans.map(pair=>({pair,races:0,acquiredBoth:0,triggered:0,threeCheckpointsReached:0,thirdCard:0,refreshes:0,ranks:[0,0,0,0,0]}))
const random={races:0,rawRanks:[0,0,0,0,0],settlementRanks:[0,0,0,0,0],versionAnswer:0}
for (let n=0;n<samples;n++) {
 const input=derivePaidCoreInput({seed:keccak256(toBytes(`card-builds/v4/seed/${n}`)),openAnchor:keccak256(toBytes(`card-builds/v4/anchor/${n}`)),stakeTier:(n%4+1) as 1|2|3|4,playerHorseId:n%5,choices:[null,null,null]})
 const base=play(input,null).result;random.races++;random.rawRanks[base.rawRank-1]!++;random.settlementRanks[base.settlementRank-1]!++;if(base.versionAnswer)random.versionAnswer++
 for(const row of rows) {
  const {result,refreshes}=play(input,row.pair); row.races++;row.refreshes+=refreshes;row.ranks[result.rawRank-1]!++
  const picked=result.acquiredByCheckpoint.filter(Boolean)
  const completed=row.pair.every(id=>id===0?result.checkpoints.some(c=>c.reason==='forfeit-tx'):picked.includes(id))
  if(completed) {row.acquiredBoth++;if(synergy(result,row.pair,input.playerHorseId))row.triggered++;if(picked.length===3)row.thirdCard++}
  if(result.checkpoints.every(c=>c.reached))row.threeCheckpointsReached++
 }
}
const doc={rulesetHash:PAID_RULESET_HASH,samples,policy:'Full pool, actual checkpoint windows; aim for both pieces, take C-05 if missing, refresh slot 0 once when needed, then choose a situational third card. AcquiredBoth counts cards received; triggered additionally checks actual overlap or a corresponding solver trigger. A forfeit is a consumed choice, not a card. This policy is not an optimal strategy or a payout guarantee.',random,builds:rows}
const json=JSON.stringify(doc,null,2)+'\n'
if(process.argv.includes('--check')) {if(readFileSync(output,'utf8')!==json)throw Error('BUILD_STATS_STALE')}
else writeFileSync(output,json)
console.log(JSON.stringify(doc))
