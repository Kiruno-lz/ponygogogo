/** Offline strategy evidence. Full coverage is 8P4 × 5 = 8400 rosters for each player role and seed. */
import { closeSync, createReadStream, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { keccak256, toBytes } from 'viem'
import { derivePaidCoreInput } from '../src/race/paid/race.ts'
import { PAID_RULESET_HASH, paidCardRule } from '../src/race/paid/cardRules.ts'
import { EV_DEATH } from '../src/race/paid/events.ts'
import type { PaidCheckpointRecord } from '../src/race/paid/solver.ts'
import { playPonyStrategy, ponyAbilityMetrics, type PonyPolicy } from './pony-strategy-policy.ts'

export function* ponyStrategyRosters(player: number): Generator<{ roster:number[]; lane:number; ordinal:number }> {
  if (!Number.isInteger(player) || player < 0 || player > 8) throw new Error('INVALID_PONY')
  const ids = Array.from({length:9}, (_,n) => n).filter(id => id !== player)
  let ordinal=0
  function* opponents(chosen: number[]): Generator<number[]> {
    if (chosen.length === 4) { yield chosen; return }
    for (const id of ids) if (!chosen.includes(id)) yield* opponents([...chosen,id])
  }
  for (const rivals of opponents([])) for (let lane=0;lane<5;lane++) {
    const roster=[...rivals];roster.splice(lane,0,player)
    yield { roster,lane,ordinal:ordinal++ }
  }
}

function compatible(pony:number,card:number,seen:Set<string>):boolean {
  if (pony === 6) return card === 0
  if (!card) return false
  const rule=paidCardRule(card)
  switch(pony) {
    case 0:return rule.rare
    case 1:return rule.slot === undefined
    case 2:return rule.slot !== undefined
    case 3:return !seen.has(rule.mainFunction)
    case 4:return rule.effect === 'airborneSpeed' || rule.effect === 'wheel'
    case 5:return rule.mainFunction === 'supply' || rule.effect === 'thrift'
    case 7:return rule.mainFunction === 'supply' && ['adrenaline','feast','reserve'].includes(rule.effect)
    case 8:return seen.has(rule.mainFunction)
    default:return false
  }
}

/** Potential compatibility is separate from actual trigger counts and actual stamina gains. */
export function ponyPreferences(pony:number,records:readonly Pick<PaidCheckpointRecord,'mode'|'cardId'|'candidates'>[]) {
  const seen=new Set<string>()
  return records.map(cp=>{
    const preference={preferredOffered:pony===6 ? cp.mode==='manual' : cp.candidates.some(card=>compatible(pony,card,seen)),
      preferredAcquired:compatible(pony,cp.cardId,seen)}
    // Checkpoint order also preserves history when an acquisition and the next opening share a tau.
    if (cp.cardId) seen.add(paidCardRule(cp.cardId).mainFunction)
    return preference
  })
}

/** Refresh explanatory labels after analysis changes without re-running or altering solver outcomes. */
async function relabel(base:string) {
  const summary=JSON.parse(readFileSync(`${base}.summary.json`,'utf8'))
  if (summary.rulesetHash!==PAID_RULESET_HASH) throw new Error('STALE_STUDY_RULESET')
  const fd=openSync(`${base}.jsonl.tmp`,'w'),absent=new Map<string,number>()
  let races=0
  try {
    const lines=createInterface({input:createReadStream(`${base}.jsonl`),crlfDelay:Infinity})
    for await (const line of lines) {
      if (!line) continue
      const row=JSON.parse(line),preferences=ponyPreferences(row.pony,row.records)
      row.records=row.records.map((record:PaidCheckpointRecord,index:number)=>({...record,...preferences[index]}))
      const key=`${row.pony}/${row.policy}`
      if (!preferences.some(record=>record.preferredOffered)) absent.set(key,(absent.get(key)??0)+1)
      writeSync(fd,json(row)+'\n');races++
    }
  } finally {closeSync(fd)}
  if (races!==summary.races) throw new Error('STUDY_ROW_COUNT_MISMATCH')
  for (const group of summary.groups) group.preferenceAbsent=absent.get(`${group.pony}/${group.policy}`)??0
  summary.preferenceDefinition='Potential card compatibility; actual triggers, coverage and resource gains are recorded separately. History follows actual acquired checkpoint order, including equal-tau acquisition/opening. Food includes conditional immediate C-24 recovery.'
  renameSync(`${base}.jsonl.tmp`,`${base}.jsonl`)
  writeFileSync(`${base}.summary.json`,json(summary)+'\n')
  console.log(`Relabelled ${races} rows without changing inputs, finish times, ranks or digests`)
}

function integerFlag(name:string,fallback:number):number {
  const index=process.argv.indexOf(name),value=index<0?fallback:Number(process.argv[index+1])
  if (!Number.isInteger(value) || value<0) throw new Error(`INVALID_${name}`)
  return value
}
const json=(value:unknown)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v)

/** Read the authoritative Solidity payout schedule; never infer payout from finish time. */
export function strategyPayoutBps():number[] {
  const source=readFileSync(new URL('../contracts/PonyGame.sol',import.meta.url),'utf8')
  const expression=/function payoutMultipliers\(\)[\s\S]*?return \[([^\]]+)\]/.exec(source)?.[1]
  if (!expression) throw new Error('PAYOUT_SCHEDULE_MISSING')
  const values=expression.replace(/uint16\(([\d_]+)\)/g,'$1').split(',').map(value=>Number(value.trim().replaceAll('_','')))
  if (values.length!==5 || values.some(value=>!Number.isSafeInteger(value)||value<0)) throw new Error('INVALID_PAYOUT_SCHEDULE')
  return values
}

if (import.meta.main) {
  const relabelIndex=process.argv.indexOf('--relabel')
  if (relabelIndex>=0) {await relabel(resolve(process.argv[relabelIndex+1]!));process.exit(0)}
  const phaseIndex=process.argv.indexOf('--phase'),phase=process.argv[phaseIndex+1]
  if (phaseIndex<0 || (phase!=='calibration' && phase!=='holdout')) throw new Error('REQUIRE_PHASE_calibration_OR_holdout')
  const seedStart=integerFlag('--seed-start',0),seeds=integerFlag('--seeds',8)
  const from=integerFlag('--from-roster',0),count=integerFlag('--rosters',8400)
  if (seeds===0 || count===0 || from+count>8400) throw new Error('INVALID_STUDY_RANGE')
  const roleIndex=process.argv.indexOf('--pony'),roles=roleIndex<0?Array.from({length:9},(_,n)=>n):[Number(process.argv[roleIndex+1])]
  if (roles.some(id=>!Number.isInteger(id)||id<0||id>8)) throw new Error('INVALID_PONY')
  const outIndex=process.argv.indexOf('--out'),base=resolve(outIndex<0?`.cache/pony-build/strategy-${phase}`:process.argv[outIndex+1]!)
  mkdirSync(resolve(base,'..'),{recursive:true})
  const policyIndex=process.argv.indexOf('--policy')
  const policies:PonyPolicy[]=policyIndex<0?['first','finish','timeout']:[process.argv[policyIndex+1] as PonyPolicy]
  if (policies.some(policy=>!['first','finish','timeout'].includes(policy))) throw new Error('INVALID_POLICY')
  const payouts=strategyPayoutBps()
  const summaries=new Map<string,{ pony:number; policy:PonyPolicy; lane:number; roster:number[]; races:number; wins:number; payoutBps:number; noCard:number; preferenceAbsent:number; deaths:number; nearFinish:number }>()
  const fd=openSync(`${base}.jsonl`,'w')
  let races=0
  const started=performance.now()
  try {
    for (let seed=seedStart;seed<seedStart+seeds;seed++) {
      const stakeTier=(seed%4+1) as 1|2|3|4
      const initial=Array.from({length:5},(_,lane)=>derivePaidCoreInput({
        seed:keccak256(toBytes(`pony-strategy/${phase}/seed/${seed}`)),
        openAnchor:keccak256(toBytes(`pony-strategy/${phase}/opening/${seed}`)),
        playerHorseId:lane,stakeTier,choices:[null,null,null],roster:[0,1,2,3,4],
      }))
      for (const pony of roles) for (const entry of ponyStrategyRosters(pony)) {
        if (entry.ordinal<from || entry.ordinal>=from+count) continue
        for (const policy of policies) {
          const played=playPonyStrategy({...initial[entry.lane]!,roster:entry.roster},policy)
          const {result}=played
          const preferences=ponyPreferences(pony,result.checkpoints)
          const records=result.checkpoints.map((cp,index)=>{
            const decision=played.decisions.find(d=>d.checkpoint===index+1)
            return { ...cp,decision:decision?.action??null,...preferences[index],nearFinish:cp.reached && result.finishTime[entry.lane]!-cp.openTau<=2000n }
          })
          const key=`${pony}/${policy}/${entry.roster.join(',')}/${entry.lane}`
          const summary=summaries.get(key)??{pony,policy,lane:entry.lane,roster:entry.roster,races:0,wins:0,payoutBps:0,noCard:0,preferenceAbsent:0,deaths:0,nearFinish:0}
          summary.races++;summary.wins+=Number(result.settlementRank===1);summary.payoutBps+=payouts[result.settlementRank-1]!
          summary.noCard+=Number(result.acquired.length===0)
          summary.preferenceAbsent+=Number(!records.some(record=>record.preferredOffered))
          summary.deaths+=Number(result.events.some(e=>e.horse===entry.lane && e.code===EV_DEATH))
          summary.nearFinish+=Number(records.some(record=>record.nearFinish))
          summaries.set(key,summary)
          writeSync(fd,json({phase,seed,stakeTier,pony,policy,...entry,input:played.input,records,
            finishTime:result.finishTime,finishWall:result.finishWall,rawRank:result.rawRank,settlementRank:result.settlementRank,
            acquired:result.trace!.cards,abilityMetrics:entry.roster.map((id,h)=>ponyAbilityMetrics(result,h,id)),
            deaths:result.events.filter(event=>event.code===EV_DEATH),stepCount:result.stepCount,digest:result.digest})+'\n')
          races++
          if (races%5000===0) console.log(`${phase}: ${races} races; seed ${seed}; pony ${pony}; roster ${entry.ordinal}; ${((performance.now()-started)/1000).toFixed(1)}s`)
        }
      }
      console.log(`${phase}: ${races} races; seed ${seed}; ${((performance.now()-started)/1000).toFixed(1)}s`)
    }
  } finally {closeSync(fd)}
  const groups=roles.flatMap(pony=>policies.map(policy=>{
    const rows=[...summaries.values()].filter(row=>row.pony===pony&&row.policy===policy)
    const best=[...rows].sort((a,b)=>b.payoutBps/b.races-a.payoutBps/a.races || b.wins/b.races-a.wins/a.races)[0]!
    return {pony,policy,races:rows.reduce((n,row)=>n+row.races,0),wins:rows.reduce((n,row)=>n+row.wins,0),
      noCard:rows.reduce((n,row)=>n+row.noCard,0),preferenceAbsent:rows.reduce((n,row)=>n+row.preferenceAbsent,0),
      deaths:rows.reduce((n,row)=>n+row.deaths,0),nearFinish:rows.reduce((n,row)=>n+row.nearFinish,0),
      bestObservedRoster:{roster:best.roster,lane:best.lane,winRate:best.wins/best.races,expectedGrossReturnBps:best.payoutBps/best.races}}
  }))
  writeFileSync(`${base}.summary.json`,json({rulesetHash:PAID_RULESET_HASH,phase,seedStart,seeds,from,count,roles,policies,races,
    completeRosterEnumeration:from===0&&count===8400,elapsedSeconds:(performance.now()-started)/1000,payouts,
    policy:'First offered / one checkpoint lookahead with two independent forecast anchors and later manual timeouts / actual timeout. Signed actions use openSec + 1. Every refresh sequence is legal and uses the real derived tail.',
    limitation:'BestObservedRoster is the maximum among tested rosters for these fixed policies and seeds, not an upper bound across all strategies or unseen entropy. Partial runs cannot establish roster balance. One-seed rates are outcomes, not probability estimates.',groups})+'\n')
  console.log(`Saved ${base}.jsonl and .summary.json`)
}
