/** Research policy: one-checkpoint finish-time lookahead; later manual panels time out in forecasts. */
import { keccak256, toBytes } from 'viem'
import { classifyPaidDraw } from '../src/race/core/paidDrawRules.ts'
import { paidCardRule } from '../src/race/paid/cardRules.ts'
import { EV_PONY } from '../src/race/paid/events.ts'
import { staminaAfter } from '../src/race/paid/motion.ts'
import { solvePaidCore, type PaidCoreInput, type PaidPanelState, type PaidSolveResult } from '../src/race/paid/solver.ts'
import { sampleStatus } from '../src/race/paid/trace.ts'

export type PonyAction = { cardId: number; refreshSlots: number[] }
export type PonyPolicy = 'first' | 'finish' | 'timeout'
const checkpoints = [1,2,3] as const

export function legalPonyActions(input: PaidCoreInput, panel: PaidPanelState): PonyAction[] {
  if (panel.mode !== 'manual') return []
  const actions: PonyAction[] = []
  const visit = (slots: number[]) => {
    const offer = [...panel.candidates]
    slots.forEach((slot,index) => { offer[slot] = input.playerDeck[panel.drawState.tailCursor - index - 1]! })
    for (const cardId of [...offer,0]) {
      if (classifyPaidDraw(input.playerDeck,panel.drawState,slots,cardId) === 0) actions.push({ cardId,refreshSlots:[...slots] })
    }
    if (slots.length >= Math.min(3,panel.drawState.refreshCredits)) return
    for (let slot = 0; slot < 3; slot++) if (!slots.includes(slot)) {
      const next = [...slots,slot]
      if (classifyPaidDraw(input.playerDeck,panel.drawState,next,0) === 0) visit(next)
    }
  }
  visit([])
  return actions
}

function signed(input: PaidCoreInput, panel: PaidPanelState, action: PonyAction, domain: string): PaidCoreInput {
  const choices = [...input.choices] as [typeof input.choices[0],typeof input.choices[1],typeof input.choices[2]]
  choices[panel.checkpoint - 1] = { ...action,txSec:panel.openSec + 1n,
    anchor:keccak256(toBytes(`pony-strategy/${domain}/${input.seed}/${input.openAnchor}/${panel.checkpoint}`)) }
  return { ...input,choices }
}

/** The future execution anchor is not accepted by the evaluator; both forecast draws use a separate domain. */
export function decidePonyAction(input: PaidCoreInput, checkpoint: 1 | 2 | 3): PonyAction {
  const panel = solvePaidCore(input,{stopAtPanel:checkpoint,trace:false}).panel
  if (!panel || panel.mode !== 'manual') throw new Error('PANEL_NOT_MANUAL')
  let best: { action:PonyAction; finish:bigint } | null = null
  for (const action of legalPonyActions(input,panel)) {
    let finish = 0n
    for (let sample = 0; sample < 2; sample++) {
      const forecast = solvePaidCore(signed(input,panel,action,`forecast/${sample}`),{trace:false})
      finish += forecast.finishTime[input.playerHorseId]!
    }
    if (!best || finish < best.finish || (finish === best.finish && action.refreshSlots.length < best.action.refreshSlots.length)) best = { action,finish }
  }
  if (!best) throw new Error('NO_LEGAL_ACTION')
  return best.action
}

export function playPonyStrategy(input: PaidCoreInput, policy: PonyPolicy) {
  const decisions: { checkpoint:number; offered:number[]; action:PonyAction; openTau:bigint }[] = []
  let current = input
  for (const checkpoint of checkpoints) {
    const panel = solvePaidCore(current,{stopAtPanel:checkpoint,trace:false}).panel
    if (!panel || panel.mode !== 'manual' || policy === 'timeout') continue
    const action = policy === 'first' ? {cardId:panel.candidates[0]!,refreshSlots:[]} : decidePonyAction(current,checkpoint)
    decisions.push({ checkpoint,offered:[...panel.candidates],action,openTau:panel.openTau })
    current = signed(current,panel,action,'execution')
  }
  return { input:current,decisions,result:solvePaidCore(current) }
}

/** Exact trace reconciliation, including overflow clamping, exhaustion, death and discrete card recovery. */
export function staminaLedger(result: PaidSolveResult, horse: number) {
  const frames = result.trace?.keyframes[horse]
  if (!frames?.length) throw new Error('NO_TRACE')
  let continuousGain=0n,continuousLoss=0n,eventGain=0n,eventLoss=0n
  let prior = frames[0]!.stamina.s
  for (const frame of frames) {
    const jump = frame.stamina.s - prior
    if (jump >= 0n) eventGain += jump; else eventLoss -= jump
    prior = staminaAfter(frame.stamina,frame.finished ? 0n : frame.tau1-frame.tau0)
    const change = prior-frame.stamina.s
    if (change >= 0n) continuousGain += change; else continuousLoss -= change
  }
  return { initial:frames[0]!.stamina.s,final:prior,continuousGain,continuousLoss,eventGain,eventLoss }
}

function unionDuration(intervals: [bigint,bigint][]): bigint {
  intervals.sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  let total=0n,end=0n
  for (const [start,stop] of intervals) { if (stop > end) { total += stop - (start > end ? start : end); end=stop } }
  return total
}

export function ponyAbilityMetrics(result: PaidSolveResult, horse: number, pony: number) {
  const trace = result.trace
  if (!trace) throw new Error('NO_TRACE')
  const finish = result.finishTime[horse]! < trace.tauEnd ? result.finishTime[horse]! : trace.tauEnd
  const intervals: [bigint,bigint][]=[]
  if (pony === 5) intervals.push([0n,finish])
  if (pony === 1 || pony === 4) for (const frame of trace.keyframes[horse]!) {
    if (frame.finished) continue
    const status = sampleStatus(trace,horse,frame.tau0)
    if (pony === 1 ? Object.values(status.equipment).every(card => card === 0) : status.airborne) intervals.push([frame.tau0,frame.tau1])
  }
  for (const instance of trace.instances.filter(i => i.horse === horse)) {
    const end = instance.endTau === null || instance.endTau > finish ? finish : instance.endTau
    if (instance.ponyId === pony) intervals.push([instance.startTau,end])
    if (pony === 2 && instance.kind === 'equip' && trace.cards.some(c => c.horse === horse && c.cardId === instance.cardId && c.tau === instance.startTau)) {
      const baseDuration = paidCardRule(instance.cardId).durationMs
      const renewal = trace.renewals.filter(r => r.instanceId === instance.id).at(0)?.tau
      const stop = renewal !== undefined && renewal < end ? renewal : end
      const start = instance.startTau + BigInt(baseDuration ?? 0)
      if (stop > start) intervals.push([start,stop])
    }
  }
  return { loggedTriggers:result.events.filter(e => e.horse === horse && e.code === EV_PONY).length,
    coverageTauMs:unionDuration(intervals),stamina:staminaLedger(result,horse) }
}
