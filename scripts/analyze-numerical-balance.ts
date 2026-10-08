/** Balance experiments through the production solver: replicated controlled offers plus natural legal drafts. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { keccak256, toBytes } from 'viem'
import { PAID_RULESET_HASH, paidCardRule } from '../src/race/paid/cardRules.ts'
import { sampleHorse } from '../src/race/paid/trace.ts'
import { derivePaidCoreInput } from '../src/race/paid/race.ts'
import { solvePaidCore, type PaidCoreInput, type PaidSolveResult } from '../src/race/paid/solver.ts'
import { EV_DEATH, EV_EXHAUST_ENTER, EV_EXHAUST_EXIT, EV_CARD, EV_RESOURCE } from '../src/race/paid/events.ts'
import { pickAt } from '../src/race/paid/testkit.ts'
import { decidePonyAction, legalPonyActions, playPonyStrategy } from './pony-strategy-policy.ts'

const outputFlag=process.argv.indexOf('--out')
const out=resolve(outputFlag>=0?process.argv[outputFlag+1]!:'.cache/balance-refresh')
const hash=(s:string)=>keccak256(toBytes(`balance-refresh/v1/${s}`))
const batches=['A','B','C']
export function context(batch:string,n:number,pony:number) {
  const rivals=Array.from({length:9},(_,i)=>(i+n)%9).filter(p=>p!==pony).slice(0,4)
  const slot=n%5, roster=[...rivals];roster.splice(slot,0,pony)
  return derivePaidCoreInput({seed:hash(`${batch}/${n}/seed`),openAnchor:hash(`${batch}/${n}/open`),
    playerHorseId:slot,roster,stakeTier:(n%4+1) as 1|2|3|4,choices:[null,null,null]})
}
export function offers(core:PaidCoreInput,plan:number[]):PaidCoreInput {
  const deck=Array<number>(14).fill(0)
  plan.forEach((id,k)=>{if(id)deck[3*k]=id})
  const unused=Array.from({length:40},(_,i)=>i+1).filter(id=>!plan.includes(id))
    .sort((a,b)=>hash(`${core.seed}/filler/${a}`).localeCompare(hash(`${core.seed}/filler/${b}`)))
  for(let i=0;i<14;i++)if(!deck[i])deck[i]=unused.shift()!
  return {...core,playerDeck:deck}
}
export function play(core:PaidCoreInput,plan:number[],forced=true,trace=false) {
  let current=forced?offers(core,plan):core
  for(const k of [1,2,3] as const) {
    const panel=solvePaidCore(current,{stopAtPanel:k,trace:false}).panel
    if(panel?.mode==='manual')current=pickAt(current,k,plan[k-1]??0,{delaySec:1n})
  }
  const result=solvePaidCore(current,{trace})
  if(result.checkpoints.some(p=>p.invalidReason!==0))throw Error('ILLEGAL_EXPERIMENT_CHOICE')
  if(result.finishTime.some(t=>t>600000n))throw Error('UNFINISHED_EXPERIMENT')
  return result
}
type Stat={n:number; complete:number; gains:number[]; times:number[]; exhaust:number; deaths:number; wins:number; examples:{seed:string;gain:number;time:number;acquired:number[]}[]}
function empty():Stat{return {n:0,complete:0,gains:[],times:[],exhaust:0,deaths:0,wins:0,examples:[]}}
function add(s:Stat,core:PaidCoreInput,plan:number[],r:PaidSolveResult,reference:PaidSolveResult){
  const h=core.playerHorseId,t=Number(r.finishTime[h]!)/1000,gain=(Number(reference.finishTime[h]!)-Number(r.finishTime[h]!))/1000
  s.n++;s.times.push(t);s.gains.push(gain);s.complete+=Number(plan.filter(Boolean).every(id=>r.acquired.includes(id)))
  s.exhaust+=r.events.filter(e=>e.horse===h&&e.code===EV_EXHAUST_ENTER).length
  s.deaths+=r.events.filter(e=>e.horse===h&&e.code===EV_DEATH).length;s.wins+=Number(r.rawRank===1)
  s.examples.push({seed:core.seed,gain,time:t,acquired:r.acquired});
}
const mean=(a:number[])=>a.reduce((x,y)=>x+y,0)/a.length
function summary(key:string,s:Stat){const sorted=[...s.gains].sort((a,b)=>a-b);return {key,n:s.n,completed:s.complete,
  meanGainSeconds:mean(s.gains),medianGainSeconds:sorted[Math.floor(sorted.length/2)],minGainSeconds:sorted[0],maxGainSeconds:sorted.at(-1),
  equivalentDistance:mean(s.gains)*1800,meanFinishSeconds:mean(s.times),meanExhaustions:s.exhaust/s.n,meanDeaths:s.deaths/s.n,winRate:s.wins/s.n,
  batches:s.examples,}}
function supplement() {
  const path=resolve(out,'simulation.json'),report=JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown> & {
    rulesetHash:string; pairs:Array<ReturnType<typeof summary> & {interactionGainSeconds?:number}>
  }
  if(report.rulesetHash!==PAID_RULESET_HASH)throw Error('STALE_BALANCE_REPORT')
  const individual=new Map<string,number>(),references=new Map<string,number>()
  for(const batch of batches)for(let n=0;n<3;n++){
    const core=context(batch,n+20,1),h=core.playerHorseId,reference=play(core,[],false)
    references.set(core.seed,Number(reference.finishTime[h]!)/1000)
    for(let card=1;card<=40;card++)for(let slot=0;slot<2;slot++){
      const plan=[0,0];plan[slot]=card
      individual.set(`${core.seed}/${card}@${slot+1}`,(Number(reference.finishTime[h]!)-Number(play(core,plan).finishTime[h]!))/1000)
    }
  }
  for(const row of report.pairs){const [a,b]=row.key.split('-').map(Number)
    row.interactionGainSeconds=mean(row.batches.map((x:{seed:string;gain:number;time:number})=>{
      if(Math.abs(references.get(x.seed)!-x.time-x.gain)>1e-8)throw Error('REFERENCE_MISMATCH')
      return x.gain-individual.get(`${x.seed}/${a}@1`)!-individual.get(`${x.seed}/${b}@2`)!
    }))
  }
  const audit=[]
  for(const batch of batches)for(let n=0;n<9;n++)for(const id of [2,22])for(let slot=0;slot<3;slot++){
    const core=context(batch,n,n),plan=[0,0,0];plan[slot]=id
    const r=play(core,plan,true,true),h=core.playerHorseId
    const card=r.events.find(e=>e.horse===h&&e.code===EV_CARD&&e.arg===BigInt(id))
    if(!card)throw Error('AUDIT_CARD_NOT_ACQUIRED')
    const payment=r.events.find(e=>e.horse===h&&e.code===EV_RESOURCE&&e.tau===card.tau&&e.arg<=0n)
    const luck=r.trace!.instances.find(i=>i.horse===h&&i.cardId===2&&i.kind==='buff')
    const state=sampleHorse(r.trace!,h,card.tau)
    const entered=r.events.find(e=>e.horse===h&&e.code===EV_EXHAUST_ENTER&&e.tau===card.tau)
    audit.push({batch,seed:core.seed,id,checkpoint:slot+1,paid:payment?Number(-payment.arg)/1e6:0,
      exhaustedAtAcquire:state.exhausted,enteredAtAcquire:!!entered,
      baseAtAcquire:Number(state.b)/1000,speedAtAcquire:Number(state.v)/1000,
      exitAfterAcquire:r.events.find(e=>e.horse===h&&e.code===EV_EXHAUST_EXIT&&e.tau>card.tau)?.tau.toString()??null,
      luckExpired:luck?.endReason==='expired',time:Number(r.finishTime[h]!)/1000})
  }
  report.audit=audit;report.supplementaryRaces=720+audit.length+9
  writeFileSync(path,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({supplementaryRaces:report.supplementaryRaces,topInteractions:[...report.pairs]
    .filter(r=>r.completed===r.n).sort((a,b)=>(b.interactionGainSeconds??0)-(a.interactionGainSeconds??0)).slice(0,10)
    .map(({batches,...r})=>r)}))
}
/** Process-local parameter experiments; production source and the Git index are never changed by this mode. */
function optimizationAudit() {
  const original={k:paidCardRule(22).fixedSpeed!,rainbow:paidCardRule(8).pBps!,rage:paidCardRule(26).costDeltaBps!}
  const previous={k:2400,rainbow:700,rage:7000}
  const variants=[{name:'before',...previous},
    ...[1400,1200,1100,1000,900,800,700,600].map(k=>({name:`C22-K-${k}`,...previous,k})),
    ...[1000,1200,1500].map(rainbow=>({name:`C08-bps-${rainbow}`,...previous,rainbow})),
    {name:'C26-cost-6000',...previous,rage:6000},{name:'after',...original}]
  const plans=[[22,0,0],[0,22,0],[0,0,22],[8,0,0],[0,8,0],[0,0,8],
    [26,0,0],[0,26,0],[0,0,26],[8,32,31],[7,8,32],[7,8,30],[31,8,32],
    [22,1,27],[14,15,16],[15,24,38],[16,26,0],[26,16,0],[7,26,16],[16,22,0],[22,16,0]]
  const rows=[]
  let races=0
  try {
    for(const variant of variants)for(const cohort of ['tuning','holdout'] as const){
      if(cohort==='holdout'&&!['before','after'].includes(variant.name))continue
      paidCardRule(22).fixedSpeed=variant.k;paidCardRule(8).pBps=variant.rainbow;paidCardRule(26).costDeltaBps=variant.rage
      const inputs=batches.flatMap(b=>Array.from({length:9},(_,n)=>context(cohort==='tuning'?b:`holdout/${b}`,n,n)))
      const references=inputs.map(c=>play(c,[],false));races+=inputs.length
      for(const plan of plans){
        const stat=empty()
        inputs.forEach((c,i)=>{add(stat,c,plan,play(c,plan),references[i]!);races++})
        rows.push({variant,cohort,...summary(plan.join('-'),stat)})
      }
      console.log(`optimization ${variant.name}/${cohort} complete`)
    }
  } finally {
    paidCardRule(22).fixedSpeed=original.k;paidCardRule(8).pBps=original.rainbow;paidCardRule(26).costDeltaBps=original.rage
  }
  mkdirSync(out,{recursive:true})
  writeFileSync(resolve(out,'optimization.json'),JSON.stringify({productionRulesetHash:PAID_RULESET_HASH,races,rows,
    method:'Old and final full rules compared on matched tuning and independently prefixed holdout seeds. Each variant has its own matched forfeit baseline because CPU card numbers change too. Intermediate candidates vary one field against old rules; all variant fields are explicit. Hash identifies final production rules, not intermediate variants.'},null,2)+'\n')
}
function refreshRollouts() {
  type Action={cardId:number;refreshSlots:number[]}
  const results=[]
  let evaluated=0
  const finish=(core:PaidCoreInput,action:Action)=>{
    let current=pickAt(core,1,action.cardId,{delaySec:1n,refreshSlots:action.refreshSlots,anchor:hash(`${core.seed}/rollout/1`)})
    let refreshes=action.refreshSlots.length
    for(const k of [2,3] as const){
      const panel=solvePaidCore(current,{stopAtPanel:k,trace:false}).panel
      if(panel?.mode!=='manual')continue
      const next=decidePonyAction(current,k)
      refreshes+=next.refreshSlots.length
      current=pickAt(current,k,next.cardId,{delaySec:1n,refreshSlots:next.refreshSlots,anchor:hash(`${core.seed}/rollout/${k}`)})
    }
    const r=solvePaidCore(current,{trace:false})
    if(r.checkpoints.some(cp=>cp.invalidReason!==0))throw Error('ILLEGAL_REFRESH_ROLLOUT')
    evaluated++
    return {time:Number(r.finishTime[core.playerHorseId]!)/1000,refreshes,acquired:r.acquired,rank:r.rawRank,digest:r.digest}
  }
  for(const batch of batches)for(let pony=0;pony<9;pony++){
    let chosen:PaidCoreInput|undefined
    for(let n=100;n<5000;n++){
      const core=context(`refresh-rollout/${batch}`,n,pony)
      const panel=solvePaidCore(core,{stopAtPanel:1,trace:false}).panel
      if(panel?.mode==='manual'&&panel.candidates.includes(5)){chosen=core;break}
    }
    if(!chosen)throw Error('NO_TREASURE_OFFER')
    const panel=solvePaidCore(chosen,{stopAtPanel:1,trace:false}).panel!
    const treasure=finish(chosen,{cardId:5,refreshSlots:[]})
    const alternatives=legalPonyActions(chosen,panel).filter(a=>a.cardId!==5).map(a=>({action:a,...finish(chosen,a)}))
      .sort((a,b)=>a.time-b.time)
    results.push({batch,pony,seed:chosen.seed,roster:chosen.roster,playerHorseId:chosen.playerHorseId,
      offer:panel.candidates,treasure,bestAlternative:alternatives[0],allAlternatives:alternatives,
      gain:alternatives[0]!.time-treasure.time})
    console.log(`refresh rollout ${batch}, role ${pony} complete`)
  }
  const file=resolve(out,'simulation.json'),report=JSON.parse(readFileSync(file,'utf8'))
  if(report.rulesetHash!==PAID_RULESET_HASH)throw Error('STALE_REFRESH_ROLLOUT')
  report.refreshRollouts={evaluated,scenarios:results,method:'Condition on C05 in the original first offer; nine roles in each batch. Force C05 without refreshing now, then use legal two-anchor lookahead at checkpoints 2/3. Compare every other legal first action with the same later policy and execution anchors. Best alternative is an ex-post contrast, not a blind optimal player strategy.'}
  writeFileSync(file,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({refreshRolloutScenarios:results.length,evaluated,
    meanGainSeconds:mean(results.map(r=>r.gain)),treasureWins:results.filter(r=>r.gain>0).length,
    refreshesUsed:results.reduce((s,r)=>s+r.treasure.refreshes,0)}))
}
function main() {
const single=new Map<string,Stat>(),pairs=new Map<string,Stat>(),triples=new Map<string,Stat>()
const ensure=(m:Map<string,Stat>,key:string)=>{if(!m.has(key))m.set(key,empty());return m.get(key)!}
const tripleSets=[[22,16,15],[7,22,16],[11,32,22],[8,32,22],[8,32,31],[19,20,29],[1,27,22],
  [18,22,40],[11,18,40],[14,15,16],[15,24,38],[7,15,25],[14,25,38],[15,16,38],
  [1,18,28],[11,27,32],[7,26,16],[7,8,32],[7,8,30],[15,22,38],[17,19,21],[3,18,28],[39,0,22],[5,22,16]]
const permutations=(ids:number[]):number[][]=>ids.length===0?[[]]:ids.flatMap((id,i)=>permutations(ids.filter((_,j)=>i!==j)).map(rest=>[id,...rest]))
const triplePlans=[...new Map(tripleSets.flatMap(permutations).map(p=>[p.join('-'),p])).values()]
let races=0
for(const batch of batches) {
  for(let n=0;n<9;n++) {
    const core=context(batch,n,n),ref=play(core,[],false)
    for(let id=1;id<=40;id++)for(let slot=0;slot<3;slot++){
      const plan=[0,0,0];plan[slot]=id;add(ensure(single,`${id}@${slot+1}`),core,plan,play(core,plan),ref);races++
    }
    for(const plan of triplePlans){add(ensure(triples,plan.join('-')),core,plan,play(core,plan),ref);races++}
  }
  console.log(`${batch}: singles/triples complete; ${races} controlled races`)
  // Pair comparisons use Shadow, whose refresh changes draft access but contributes no movement modifier.
  for(let n=0;n<3;n++) {
    const core=context(batch,n+20,1),ref=play(core,[],false)
    for(let a=1;a<=40;a++)for(let b=1;b<=40;b++)if(a!==b){
      const plan=[a,b];add(ensure(pairs,plan.join('-')),core,plan,play(core,plan),ref);races++
    }
  }
  console.log(`${batch}: all ordered pairs complete; ${races} controlled races`)
}
const natural=[]
for(const batch of batches)for(let tier=0;tier<4;tier++)for(let pony=0;pony<9;pony++) {
  const core=context(`natural/${batch}`,pony+9*tier,pony)
  // Derive the exact intended tier, rather than letting the index's modulo choose it.
  const exact=derivePaidCoreInput({seed:core.seed,openAnchor:core.openAnchor,playerHorseId:core.playerHorseId,
    roster:core.roster,stakeTier:(tier+1) as 1|2|3|4,choices:[null,null,null]})
  const reference=play(exact,[],false)
  for(const policy of ['first','finish'] as const){
    const p=playPonyStrategy(exact,policy),r=p.result,h=exact.playerHorseId
    if(r.checkpoints.some(cp=>cp.invalidReason!==0))throw Error('ILLEGAL_NATURAL_CHOICE')
    natural.push({batch,pony,tier:tier+1,seed:exact.seed,policy,time:Number(r.finishTime[h]!)/1000,
      gain:(Number(reference.finishTime[h]!)-Number(r.finishTime[h]!))/1000,rank:r.rawRank,acquired:r.acquired,
      refreshes:p.decisions.reduce((s,d)=>s+d.action.refreshSlots.length,0),
      exhaust:r.events.filter(e=>e.horse===h&&e.code===EV_EXHAUST_ENTER).length,digest:r.digest})
  }
  if(pony===8)console.log(`natural ${batch}, tier ${tier+1} complete`)
}
const sort=(m:Map<string,Stat>)=>[...m].map(([k,v])=>summary(k,v)).sort((a,b)=>b.meanGainSeconds-a.meanGainSeconds)
const report={rulesetHash:PAID_RULESET_HASH,batches,controlledRaces:races,naturalRaces:natural.length,
  method:{clock:'simulation seconds',stamina:'implemented time cost: player 20/s, regen 10/s; exhaustion 15/s',
    profiles:'player 300/150/1800 and stamina 300; CPU profiles and decks are production-derived',
    baseline:'actively forfeit all three manual checkpoints at openSec+1; includes pony forfeit rewards',
    controlled:'only player offered deck is arranged; all actions use real checkpoints, CPU cards, events and finish cutoffs',
    pairs:'all 1560 ordered pairs, nine independent seed contexts, neutral movement Shadow',
    triples:'144 predeclared ordered triples, 27 contexts across nine roles; exploratory comparisons',
    natural:'unchanged production-derived decks, legal refreshes; first-card policy versus two-anchor one-checkpoint lookahead',
    equivalentDistance:'1800 * baseline minus build finish seconds; a time advantage expressed as distance, not literal lead at a shared time',
    limits:'small seed sample; not global optimality or an expected win rate guarantee; incomplete planned builds stay labeled'},
  singles:sort(single),pairs:sort(pairs),triples:sort(triples),natural}
mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'simulation.json'),JSON.stringify(report,null,2)+'\n')
for(const [name,rows] of [['singles',report.singles],['pairs',report.pairs],['triples',report.triples]] as const){
  writeFileSync(resolve(out,`${name}.tsv`),'plan\tn\tcompleted\tmean_gain_s\teq_distance\tfinish_s\texhaust\n'+
    rows.map(r=>[r.key,r.n,r.completed,r.meanGainSeconds.toFixed(4),r.equivalentDistance.toFixed(1),r.meanFinishSeconds.toFixed(4),r.meanExhaustions.toFixed(4)].join('\t')).join('\n')+'\n')
}
console.log(JSON.stringify({rulesetHash:PAID_RULESET_HASH,controlledRaces:races,naturalRaces:natural.length,triples:triplePlans.length,
  topSingles:report.singles.slice(0,8).map(({batches,...r})=>r),topPairs:report.pairs.filter(r=>r.completed===r.n).slice(0,8).map(({batches,...r})=>r),
  topTriples:report.triples.filter(r=>r.completed===r.n).slice(0,8).map(({batches,...r})=>r)}))

}
if (import.meta.main) { if(process.argv.includes('--optimization-audit'))optimizationAudit();else if(process.argv.includes('--audit'))supplement();else if(process.argv.includes('--refresh-rollouts'))refreshRollouts();else main() }
