/** 统计各档位「怎么打都一样」的局占比，以及最优玩法与放任不管的名次差期望。 */
import { POLICY_IDLE, POLICY_PERFECT, runRace } from '../src/race/core/sim.ts'
import { makeSeed } from '../src/race/core/rng.ts'

const N = Number(process.argv[2] ?? 200)
for (let tier = 0; tier < 4; tier++) {
  let same = 0
  let diff = 0
  let wins = 0
  for (let i = 0; i < N; i++) {
    const cfg = { seed: makeSeed(50000 + i), playerHorseId: 0, stakeTier: tier }
    const a = runRace(cfg, POLICY_IDLE).engine.player().rank
    const b = runRace(cfg, POLICY_PERFECT).engine.player().rank
    if (a === b) same++
    diff += a - b
    if (b === 1) wins++
  }
  console.log(
    `档位 ${tier}: 同名次 ${(100 * same / N).toFixed(1)}%  名次差均值 ${(diff / N).toFixed(2)}  完美夺冠率 ${(100 * wins / N).toFixed(1)}%`,
  )
}
