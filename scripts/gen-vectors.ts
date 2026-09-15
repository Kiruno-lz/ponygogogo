/**
 * 生成规则内核的确定性终态向量。
 * 固定 (seed, 输入序列) 的终态快照存入 src/race/__vectors__/，
 * CI 在 Node 与浏览器两套运行时各跑一遍，逐字段完全相等，不接受容差。
 */
import { writeFileSync } from 'node:fs'
import { makeSeed } from '../src/race/core/rng.ts'
import {
  POLICY_IDLE,
  POLICY_MASH,
  POLICY_PERFECT,
  runRace,
  type SimPolicy,
} from '../src/race/core/sim.ts'

const POLICIES: Array<[string, SimPolicy]> = [
  ['perfect', POLICY_PERFECT],
  ['idle', POLICY_IDLE],
  ['mash', POLICY_MASH],
  ['refresh', { ...POLICY_PERFECT, refreshes: 2, decide: 'last' }],
  ['forfeit', { ...POLICY_PERFECT, decide: 'forfeit' }],
]

export interface Vector {
  seed: string
  playerHorseId: number
  stakeTier: number
  policy: string
  /** 终态快照：每匹马的 pos,dist,v,stamina,finishTick,overshoot,rank,lane */
  horses: string[]
  finishedOrder: number[]
  endReason: string
  choices: string
  rulesVersion: string
}

export function snapshot(
  seed: string,
  playerHorseId: number,
  stakeTier: number,
  policyName: string,
  policy: SimPolicy,
): Vector {
  const { engine } = runRace({ seed, playerHorseId, stakeTier }, policy)
  const st = engine.state
  return {
    seed,
    playerHorseId,
    stakeTier,
    policy: policyName,
    horses: st.horses.map((h) =>
      [h.horseId, h.laneIndex, h.pos, h.dist, h.v, h.stamina, h.finishTick, h.finishOvershoot, h.rank].join(','),
    ),
    finishedOrder: [...st.finishedOrder],
    endReason: st.endReason ?? 'finished',
    choices: st.choices.map((c) => `${c.checkpoint}:${c.cardId ?? '-'}:${c.reason}:${c.refreshes.join('.')}`).join('|'),
    rulesVersion: st.rulesVersion,
  }
}

export function buildVectors(count: number): Vector[] {
  const out: Vector[] = []
  for (let i = 0; i < count; i++) {
    const seed = makeSeed(600000 + i)
    const [name, policy] = POLICIES[i % POLICIES.length]!
    out.push(snapshot(seed, i % 5, i % 4, name, policy))
  }
  return out
}

if (import.meta.main) {
  const n = Number(process.argv[2] ?? 200)
  const vectors = buildVectors(n)
  const path = new URL('../src/race/__vectors__/terminal.json', import.meta.url).pathname
  writeFileSync(path, JSON.stringify(vectors, null, 0) + '\n')
  console.log(`向量 ${vectors.length} 组 -> ${path}`)
}
