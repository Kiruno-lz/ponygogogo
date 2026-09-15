import { describe, expect, test } from 'bun:test'
import { assertPoolViable, deriveCpuDeck, deriveDeck } from './deck.ts'
import { CARD_BY_ID, CARD_POOL } from '../cards/pool.ts'
import { ALL_MODULES, assertModulesCoverPool } from '../modules/index.ts'
import {
  POLICY_IDLE,
  POLICY_MASH,
  POLICY_PERFECT,
  replay,
  runRace,
  traceFingerprint,
} from './sim.ts'
import { RaceEngine } from './engine.ts'
import { DECK_RARE_TAIL, DECK_SIZE, HORSE_COUNT, TRACK_LEN, SIM_HZ } from './constants.ts'
import { makeSeed } from './rng.ts'

const seeds = Array.from({ length: 40 }, (_, i) => makeSeed(1000 + i))

describe('卡池与模块静态断言', () => {
  test('总卡池 ≥ 14、强效果子集 ≥ 2', () => {
    expect(() => assertPoolViable()).not.toThrow()
    expect(CARD_POOL.length).toBe(21)
    expect(CARD_POOL.filter((c) => c.quality === 'rare').length).toBe(12)
  })

  test('cardId 唯一，且每张卡都显式声明 cpuUsable', () => {
    const ids = new Set(CARD_POOL.map((c) => c.cardId))
    expect(ids.size).toBe(CARD_POOL.length)
    for (const c of CARD_POOL) expect(typeof c.cpuUsable).toBe('boolean')
  })

  test('缺模块在导入期即失败', () => {
    expect(() => assertModulesCoverPool()).not.toThrow()
  })

  test('模块执行顺序是 id 字典序，不是注册顺序', () => {
    const shuffled = [...ALL_MODULES].reverse()
    const a = new RaceEngine({ seed: seeds[0]!, playerHorseId: 0, stakeTier: 2 }, ALL_MODULES)
    const b = new RaceEngine({ seed: seeds[0]!, playerHorseId: 0, stakeTier: 2 }, shuffled)
    expect(a.state.rulesVersion).toBe(b.state.rulesVersion)
  })
})

describe('发牌派生', () => {
  test('遍历 seed：牌堆十四张两两不等，末两张必为 rare', () => {
    for (let i = 0; i < 3000; i++) {
      const deck = deriveDeck(makeSeed(i))
      expect(deck.length).toBe(DECK_SIZE)
      expect(new Set(deck).size).toBe(DECK_SIZE)
      for (let k = DECK_SIZE - DECK_RARE_TAIL; k < DECK_SIZE; k++) {
        expect(CARD_BY_ID[deck[k]!]!.quality).toBe('rare')
      }
    }
  }, 30000)

  test('同一 seed 的牌堆完全可复现', () => {
    for (const s of seeds) expect(deriveDeck(s)).toEqual(deriveDeck(s))
  })

  test('电脑马私有牌堆只取 cpuUsable 的卡，且一场内不重复', () => {
    for (const s of seeds) {
      for (let id = 0; id < HORSE_COUNT; id++) {
        const d = deriveCpuDeck(s, id)
        expect(d.length).toBe(3)
        expect(new Set(d).size).toBe(3)
        for (const c of d) expect(CARD_BY_ID[c]!.cpuUsable).toBe(true)
      }
    }
  })
})

describe('逻辑完整性门禁', () => {
  test('固定 seed 下五匹马最终都能结束，名次严格 1–5 且不重复', () => {
    for (const s of seeds) {
      for (const policy of [POLICY_IDLE, POLICY_PERFECT, POLICY_MASH]) {
        const { engine } = runRace({ seed: s, playerHorseId: 2, stakeTier: 2 }, policy)
        expect(engine.state.raceOver).toBe(true)
        const ranks = engine.state.horses.map((h) => h.rank).sort()
        expect(ranks).toEqual([1, 2, 3, 4, 5])
        for (const h of engine.state.horses) {
          expect(h.finished).toBe(true)
          expect(h.pos).toBeGreaterThanOrEqual(TRACK_LEN)
        }
      }
    }
  }, 120000)

  test('三次选牌记录数量恒为 3，且没有发生的事件用显式状态表达', () => {
    for (const s of seeds.slice(0, 20)) {
      const { engine } = runRace({ seed: s, playerHorseId: 0, stakeTier: 1 }, POLICY_PERFECT)
      const r = engine.buildResult('t')
      expect(r.choices.length).toBe(3)
      for (const c of r.choices) {
        expect(['picked', 'forfeited', 'timeout', 'not-reached']).toContain(c.reason)
        if (c.reason !== 'picked') expect(c.cardId).toBeNull()
      }
      expect(r.rank).toBeGreaterThanOrEqual(1)
      expect(r.rank).toBeLessThanOrEqual(5)
    }
  })

  test('选马不改变对手：同一 seed 下四组性格参数的多重集合完全相同', () => {
    for (const s of seeds.slice(0, 10)) {
      const sets: string[][] = []
      for (let pid = 0; pid < HORSE_COUNT; pid++) {
        const e = new RaceEngine({ seed: s, playerHorseId: pid, stakeTier: 2 }, ALL_MODULES)
        sets.push(
          e.state.horses
            .filter((h) => h.cpu)
            .map((h) => JSON.stringify(h.cpu))
            .sort(),
        )
      }
      for (let i = 1; i < sets.length; i++) expect(sets[i]).toEqual(sets[0]!)
    }
  })

  test('比赛时长落在可接受区间（不作为平衡判据，只防跑不完）', () => {
    for (const s of seeds.slice(0, 15)) {
      const { engine } = runRace({ seed: s, playerHorseId: 0, stakeTier: 1 }, POLICY_PERFECT)
      const sec = engine.player().finishTick / SIM_HZ
      expect(sec).toBeGreaterThan(20)
      expect(sec).toBeLessThan(200)
    }
  })
})

describe('确定性门禁', () => {
  test('同一 (seed, horseId, 输入序列) 重放 100 次，全场轨迹逐字段完全相等', () => {
    const cfg = { seed: seeds[3]!, playerHorseId: 1, stakeTier: 3 }
    const { engine, inputs } = runRace(cfg, POLICY_MASH)
    const golden = traceFingerprint(engine)
    for (let i = 0; i < 100; i++) {
      expect(traceFingerprint(replay(cfg, inputs))).toBe(golden)
    }
  }, 60000)

  test('打乱模块注册顺序后终态逐字段不变', () => {
    const cfg = { seed: seeds[5]!, playerHorseId: 4, stakeTier: 2 }
    const { inputs } = runRace(cfg, POLICY_PERFECT)
    const a = replay(cfg, inputs)
    const golden = traceFingerprint(a)
    const shuffled = [...ALL_MODULES].sort((x, y) => (x.id > y.id ? -1 : 1))
    const e = new RaceEngine(cfg, shuffled)
    const byTick = new Map<number, (typeof inputs)[number]['input'][]>()
    for (const { tick, input } of inputs) {
      const l = byTick.get(tick) ?? []
      l.push(input)
      byTick.set(tick, l)
    }
    while (!e.state.raceOver && e.state.tick < 60000) e.step(byTick.get(e.state.tick) ?? [])
    expect(traceFingerprint(e)).toBe(golden)
  })

  test('没有任何模块能写 dist：里程只由骨架按自身位移累加', () => {
    for (const m of ALL_MODULES) {
      expect(m.writes).not.toContain('dist')
    }
  })
})

describe('橡皮筋 AI 的架构约束', () => {
  test('电脑马目标速度函数的入参不含名次或目标完成 tick', () => {
    const src = require('node:fs').readFileSync(
      new URL('./engine.ts', import.meta.url).pathname,
      'utf8',
    ) as string
    const fn = src.slice(src.indexOf('private resolveCpuTarget'), src.indexOf('private resolveStamina'))
    expect(fn).not.toMatch(/\brank\b/)
    expect(fn).not.toMatch(/finishTick/)
    expect(fn).not.toMatch(/finishedOrder/)
  })

  test('取 120 个 seed，全程不点与完美节奏名次相同的占比显著低于 100%（橡皮筋没有退化成固定成绩）', () => {
    let same = 0
    const n = 120
    for (let i = 0; i < n; i++) {
      const cfg = { seed: makeSeed(9000 + i), playerHorseId: 0, stakeTier: 2 }
      const a = runRace(cfg, POLICY_IDLE).engine.player().rank
      const b = runRace(cfg, POLICY_PERFECT).engine.player().rank
      if (a === b) same++
    }
    expect(same / n).toBeLessThan(0.35)
  }, 60000)
})
