/**
 * 交互回归：每个 seed 用固定的合法输入序列、放弃序列、超时序列和刷新序列各跑一次。
 * 判据：五匹马都结束，名次为不重复的 1–5，三次检查点记录数量与实际触发一致，
 * 编码解码往返相等。不比较策略优劣或卡牌强弱。
 *
 *   bun run scripts/race-sweep.ts --seeds 2000
 */
import { decodeResult, encodeResult } from '../src/chain/codec.ts'
import { CHECKPOINT_MARKS } from '../src/race/core/constants.ts'
import { makeSeed } from '../src/race/core/rng.ts'
import {
  POLICY_IDLE,
  POLICY_MASH,
  POLICY_PERFECT,
  replay,
  runRace,
  traceFingerprint,
  type SimPolicy,
} from '../src/race/core/sim.ts'

const argIdx = process.argv.indexOf('--seeds')
const N = argIdx >= 0 ? Number(process.argv[argIdx + 1]) : 500

const POLICIES: Array<[string, SimPolicy]> = [
  ['合法输入', POLICY_PERFECT],
  ['乱按', POLICY_MASH],
  ['放弃', { ...POLICY_PERFECT, decide: 'forfeit' }],
  ['超时', { ...POLICY_IDLE, decide: 'timeout' }],
  ['刷新', { ...POLICY_PERFECT, refreshes: 2, decide: 'last' }],
]

let failures = 0
const t0 = Date.now()

for (let i = 0; i < N; i++) {
  const seed = makeSeed(200000 + i)
  const playerHorseId = i % 5
  const stakeTier = i % 4
  for (const [name, policy] of POLICIES) {
    const cfg = { seed, playerHorseId, stakeTier }
    const { engine, inputs } = runRace(cfg, policy)
    const st = engine.state
    const tag = `${name} seed=${seed.slice(0, 10)} horse=${playerHorseId} tier=${stakeTier}`

    if (!st.raceOver) {
      console.error(`✗ ${tag}: 比赛没有结束`)
      failures++
      continue
    }
    const ranks = st.horses.map((h) => h.rank).sort()
    if (ranks.join(',') !== '1,2,3,4,5') {
      console.error(`✗ ${tag}: 名次不是不重复的 1–5 -> ${ranks}`)
      failures++
    }
    if (st.horses.some((h) => !h.finished)) {
      console.error(`✗ ${tag}: 有马没有完赛`)
      failures++
    }

    const result = engine.buildResult('sweep')
    if (result.choices.length !== CHECKPOINT_MARKS.length) {
      console.error(`✗ ${tag}: 选择记录数量 ${result.choices.length} ≠ 3`)
      failures++
    }
    const reached = result.choices.filter((c) => c.reason !== 'not-reached').length
    const marks = engine.player().marksConsumed
    if (reached !== marks) {
      console.error(`✗ ${tag}: 记录到的检查点 ${reached} ≠ 实际触发 ${marks}`)
      failures++
    }

    if (JSON.stringify(decodeResult(encodeResult(result))) !== JSON.stringify(result)) {
      console.error(`✗ ${tag}: 编码解码往返不相等`)
      failures++
    }

    if (traceFingerprint(replay(cfg, inputs)) !== traceFingerprint(engine)) {
      console.error(`✗ ${tag}: 重放轨迹不一致`)
      failures++
    }
  }
  if ((i + 1) % 100 === 0) {
    process.stdout.write(`  ${i + 1}/${N} seeds · ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
if (failures === 0) {
  console.log(`✓ ${N} seeds × ${POLICIES.length} 条输入序列全部通过（${secs}s）`)
  process.exit(0)
}
console.error(`✗ ${failures} 项失败（${secs}s）`)
process.exit(1)
