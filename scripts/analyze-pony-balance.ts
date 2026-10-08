/** Paired role payout evidence; controlled neutral CPU abilities, production profiles/decks/rules. */
import {appendFileSync,mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {PAID_RULESET_HASH,PAID_CARD_RULES_HASH} from '../src/race/paid/cardRules.ts'
import {PONY_RULES} from '../src/race/paid/ponyRules.ts'
import {installNullPonies,makeCore,play,summarize,PAY,type Policy} from './pony-balance-planner.ts'

const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(`--${name}`);return i<0?fallback:process.argv[i+1]!}
const out=resolve(arg('out','.cache/role-convergence/calibration'))
if(process.argv.includes('--summary')){
 for(const file of readdirSync(out).filter(f=>/^manifest-\d+\.json$/.test(f))){
  const manifest=JSON.parse(readFileSync(resolve(out,file),'utf8'))
  if(manifest.rulesetHash!==PAID_RULESET_HASH||manifest.cardRulesHash!==PAID_CARD_RULES_HASH)throw Error('STALE_ROLE_REPORT')
 }
 const rows=readdirSync(out).filter(f=>/^shard-\d+\.jsonl$/.test(f)).flatMap(f=>readFileSync(resolve(out,f),'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)))
 const keys=rows.map(r=>`${r.n}/${r.tier}/${r.pony}`)
 if(new Set(keys).size!==keys.length)throw Error('DUPLICATE_SCENARIO')
 const refs=new Map(rows.filter(r=>r.pony===9).map(r=>[`${r.n}/${r.tier}`,r]))
 for(const row of rows){
  const reference=refs.get(`${row.n}/${row.tier}`)
  if(!reference)throw Error('MISSING_PAIRED_REFERENCE')
  for(const field of ['deck','cpuDecks','profiles'])if(JSON.stringify(row[field])!==JSON.stringify(reference[field]))throw Error('UNPAIRED_ROLE_INPUT')
 }
 if(rows.length!==refs.size*10)throw Error('INCOMPLETE_ROLE_MATRIX')
 const policies=Object.keys(rows[0]).filter(k=>['expert','myopic','timeout'].includes(k))
 const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length
 const roles=Array.from({length:9},(_,pony)=>({pony,policies:policies.map(policy=>{
  const a=rows.filter(r=>r.pony===pony&&refs.has(`${r.n}/${r.tier}`))
  const deltas=a.map(r=>PAY[r[policy].srank]!-PAY[refs.get(`${r.n}/${r.tier}`)![policy].srank]!)
  const perSeed=[...new Set(a.map(r=>r.n))].map(n=>mean(deltas.filter((_,i)=>a[i].n===n)))
  const average=mean(deltas),clusterMean=mean(perSeed)
  const se=perSeed.length>1?Math.sqrt(perSeed.reduce((s,x)=>s+(x-clusterMean)**2,0)/(perSeed.length-1)/perSeed.length):null
  return {policy,n:a.length,seeds:perSeed.length,deltaReturn:average,seedClusterSE:se,
   inTarget:average>=0.14&&average<=0.26,return:mean(a.map(r=>PAY[r[policy].srank]!)),
   time:mean(a.map(r=>r[policy].finish))/1000,deltaTime:mean(a.map(r=>refs.get(`${r.n}/${r.tier}`)![policy].finish-r[policy].finish))/1000,
   deltaWin:mean(a.map(r=>Number(r[policy].srank===1)-Number(refs.get(`${r.n}/${r.tier}`)![policy].srank===1))),
   tiers:[1,2,3,4].map(tier=>({tier,n:a.filter(r=>r.tier===tier).length,deltaReturn:mean(deltas.filter((_,i)=>a[i].tier===tier))}))}
 })}))
 const report={rulesetHash:PAID_RULESET_HASH,cardRulesHash:PAID_CARD_RULES_HASH,rows:rows.length,pairedContexts:refs.size,roles,
  method:'Same seed, player deck, CPU profiles/decks and execution/forecast anchors; four neutral experimental CPU identities. Differences against player with no role. Expert uses public deck and rational pick/forfeit/tail-refresh actions with three forecast anchors for random cards. Mean return delta across four tiers is the target, not every seed/tier. SE clusters all four tiers of each independent seed.'}
 writeFileSync(resolve(out,'summary.json'),JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report,null,2))
}else{
 const N=Number(arg('n','100')),start=Number(arg('start','0'))
 const [index,count]=arg('shard','0/1').split('/').map(Number)
 const roles=arg('ponies','0,1,2,3,4,5,6,7,8,9').split(',').map(Number)
 const policies=arg('policies','timeout,myopic,expert').split(',') as Policy[]
 installNullPonies();mkdirSync(out,{recursive:true})
 const file=resolve(out,`shard-${index}.jsonl`)
 writeFileSync(file,'')
 writeFileSync(resolve(out,`manifest-${index}.json`),JSON.stringify({rulesetHash:PAID_RULESET_HASH,cardRulesHash:PAID_CARD_RULES_HASH,roles:PONY_RULES.filter(r=>r.id<9),N,start,index,count,policies},null,2)+'\n')
 let job=0,finished=0
 for(let n=start;n<start+N;n++)for(const tier of [1,2,3,4] as const)for(const pony of roles){
  if(job++%count!==index)continue
  const slot=n%5,roster=[10,11,12,13];roster.splice(slot,0,pony)
  const core=makeCore({label:`e1/${tier}/${n}`,tier,pony,roster,slot})
  const row:Record<string,unknown>={n,tier,pony,slot,seed:core.seed,openAnchor:core.openAnchor,deck:core.playerDeck,cpuDecks:core.cpuDecks,profiles:core.profiles.map(p=>[Number(p.base),Number(p.acceleration),Number(p.cap)])}
  for(const policy of policies){const p=play(core,policy,'payout');row[policy]={...summarize(p.result,slot),digest:p.result.digest,choices:p.input.choices,decisions:p.decisions}}
  appendFileSync(file,JSON.stringify(row,(_,v)=>typeof v==='bigint'?v.toString():v)+'\n')
  if(++finished%100===0)console.log(`shard ${index}: ${finished} scenarios`)
 }
 console.log(`done ${index}: ${finished} scenarios`)
}
