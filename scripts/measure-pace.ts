/** 实测玩家在各输入策略下的可持续配速。用于锚定电脑马 base 分布的结构参数。 */
import { RaceEngine } from '../src/race/core/engine.ts'
import { ALL_MODULES } from '../src/race/modules/index.ts'
import { TRACK_LEN, SIM_HZ } from '../src/race/core/constants.ts'
import { FP } from '../src/race/core/fixed.ts'
import { makeSeed } from '../src/race/core/rng.ts'
import type { RaceInput } from '../src/race/core/types.ts'

function pace(clickEvery: number, takeCards: boolean) {
  let total = 0
  const N = 12
  for (let i = 0; i < N; i++) {
    const e = new RaceEngine({ seed: makeSeed(100 + i), playerHorseId: 0, stakeTier: 0 }, ALL_MODULES)
    const p = e.player()
    let t = 0
    while (!p.finished && t < 60000) {
      const f: RaceInput[] = []
      if (e.state.pending) {
        f.push(takeCards ? { kind: 'pick', cardId: e.state.pending.candidates[0]! } : { kind: 'timeout' })
      } else if (clickEvery > 0 && t % clickEvery === 0) f.push({ kind: 'gogoDown' })
      e.step(f)
      t++
    }
    total += p.finishTick
  }
  const ticks = total / N
  return { sec: +(ticks / SIM_HZ).toFixed(1), avgV: +(TRACK_LEN / ticks / FP).toFixed(2) }
}

console.log('放任不管          ', pace(0, false))
console.log('完美节奏(不拿卡)   ', pace(25, false))
console.log('完美节奏(拿卡)     ', pace(25, true))
console.log('乱按(6t)          ', pace(6, false))
console.log('偏慢(40t)         ', pace(40, false))
