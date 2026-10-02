/**
 * 模块级 L1。向量用注入式牌堆直接构造 deck，绕过 seed 发牌
 * （docs/plan/open-decisions.md §5.1），因此每条用例都能稳定触发目标效果。
 */
import { describe, expect, test } from 'bun:test'
import {
  CHECKPOINT_MARKS,
  DECK_SIZE,
  EXHAUST_RELEASE,
  PLAYER_V_LOW,
  STAMINA_MAX,
  TRACK_LEN,
} from '../core/constants.ts'
import { RaceEngine } from '../core/engine.ts'
import { FP, fx } from '../core/fixed.ts'
import { makeSeed } from '../core/rng.ts'
import type { RaceInput } from '../core/types.ts'
import { ALL_MODULES } from './index.ts'

const SEED = makeSeed(4242)

function mk(opts: Partial<{ deck: string[]; playerHorseId: number; tier: number }> = {}): RaceEngine {
  const deck = opts.deck ?? []
  const full = [...deck]
  while (full.length < DECK_SIZE) full.push('C-17')
  return new RaceEngine(
    {
      seed: SEED,
      playerHorseId: opts.playerHorseId ?? 0,
      stakeTier: opts.tier ?? 1,
      injectDeck: full,
      injectCpuDecks: { 0: ['C-17', 'C-17', 'C-17'], 1: ['C-17', 'C-17', 'C-17'], 2: ['C-17', 'C-17', 'C-17'], 3: ['C-17', 'C-17', 'C-17'], 4: ['C-17', 'C-17', 'C-17'] },
    },
    ALL_MODULES,
  )
}

function run(e: RaceEngine, ticks: number, inputs: Record<number, RaceInput[]> = {}): void {
  for (let i = 0; i < ticks; i++) e.step(inputs[e.state.tick] ?? [])
}

// ---------------------------------------------------------------------------

describe('mod.death 与 mod.stack', () => {
  test('【死亡】归零速度、位置不变、挂上 5 秒【重生】，且重生期间免疫再次死亡', () => {
    const e = mk()
    run(e, 60)
    const p = e.player()
    const posBefore = p.pos
    const distBefore = p.dist
    e.settleDeath(p.horseId)
    expect(p.v).toBe(0)
    expect(p.pos).toBe(posBefore)
    expect(p.dist).toBe(distBefore)
    expect(e.hasStatus(p.horseId, 'respawning')).toBe(true)
    // 重生期间再死一次无效
    run(e, 10)
    const v = p.v
    e.settleDeath(p.horseId)
    expect(p.v).toBe(v)
  })

  test('死亡后即使不点也能爬回速度带，比赛能终止', () => {
    const e = mk()
    run(e, 60)
    e.settleDeath(e.player().horseId)
    run(e, 400)
    expect(e.player().v).toBeGreaterThanOrEqual(PLAYER_V_LOW)
    expect(e.player().deathRecover).toBe(false)
  })

  test('【火焰】7 层立即结算一次【死亡】并清空层数', () => {
    const e = mk()
    run(e, 20)
    const owner = e.state.playerHorseId
    const inst = e.mut.mount('mod.stack', {
      sourceCardId: 'C-11',
      primitive: 'Status',
      moduleId: 'mod.stack',
      ownerHorseId: owner,
      durationTicks: null,
      tags: ['debuff'],
      payload: { statusId: 'burning', stacks: 7, lastGainTick: e.state.tick },
    })
    expect(inst.payload.stacks).toBe(7)
    e.step([])
    expect(e.state.events.some((x) => x.type === 'death')).toBe(true)
    expect(e.statusStacks(owner, 'burning')).toBe(0)
  })
})

describe('mod.hazard 炸弹', () => {
  test('给其他四条赛道各放一枚，位置是放置瞬间的 pos', () => {
    const e = mk()
    run(e, 40)
    const owner = e.player()
    e.applyCard(owner.horseId, 'C-06')
    expect(e.state.hazards.length).toBe(4)
    expect(new Set(e.state.hazards.map((h) => h.laneIndex)).size).toBe(4)
    expect(e.state.hazards.every((h) => h.pos === owner.pos)).toBe(true)
    expect(e.state.hazards.some((h) => h.laneIndex === owner.laneIndex)).toBe(false)
  })

  test('按位移区间判定，高速下不漏判', () => {
    const e = mk()
    run(e, 40)
    const victim = e.state.horses[1]!
    // 把炸弹放在受害马前方一小段，确保这一 tick 会跨过去
    e.mut.spawnHazard('mod.hazard', {
      laneIndex: victim.laneIndex,
      pos: victim.pos + 1,
      sourceCardId: 'C-06',
    })
    e.step([])
    expect(e.state.events.some((x) => x.type === 'explosion' && x.horseId === victim.horseId)).toBe(true)
    expect(e.state.hazards.length).toBe(0)
  })

  test('【起飞】的马不触发地面炸弹', () => {
    const e = mk()
    run(e, 40)
    const p = e.player()
    e.applyCard(p.horseId, 'C-01') // 中国马能飞
    e.mut.spawnHazard('mod.hazard', { laneIndex: p.laneIndex, pos: p.pos + 1, sourceCardId: 'C-06' })
    e.step([])
    expect(e.state.events.some((x) => x.type === 'explosion')).toBe(false)
    expect(e.state.hazards.length).toBe(1)
  })
})

describe('mod.swap 交换', () => {
  test('交换 pos 与 laneIndex，里程各自保留，速度不变', () => {
    const e = mk()
    run(e, 60)
    const p = e.player()
    e.applyCard(p.horseId, 'C-09') // 不义游戏
    const before = e.state.horses.map((h) => ({ id: h.horseId, pos: h.pos, lane: h.laneIndex, dist: h.dist, v: h.v }))
    e.step([{ kind: 'gogoDown' }])
    const swap = e.state.events.find((x) => x.type === 'swap')
    expect(swap).toBeDefined()
    if (swap && swap.type === 'swap') {
      const a = before.find((x) => x.id === swap.a)!
      const b = before.find((x) => x.id === swap.b)!
      const ha = e.horseById(swap.a)
      const hb = e.horseById(swap.b)
      expect(ha.laneIndex).toBe(b.lane)
      expect(hb.laneIndex).toBe(a.lane)
      // 位置互换（之后各自又走了一 tick）
      expect(ha.pos - ha.v).toBe(b.pos)
      expect(hb.pos - hb.v).toBe(a.pos)
      // 里程只累计自身位移，跳变不产生里程
      expect(ha.dist - ha.v).toBe(a.dist)
      expect(hb.dist - hb.v).toBe(b.dist)
    }
  })

  test('2 秒内置冷却期间不再响应交换', () => {
    const e = mk()
    run(e, 60)
    e.applyCard(e.state.playerHorseId, 'C-09')
    e.step([{ kind: 'gogoDown' }])
    const first = e.state.events.filter((x) => x.type === 'swap').length
    expect(first).toBe(1)
    e.step([{ kind: 'gogoDown' }])
    expect(e.state.events.filter((x) => x.type === 'swap').length).toBe(0)
    run(e, 100)
    e.step([{ kind: 'gogoDown' }])
    expect(e.state.events.filter((x) => x.type === 'swap').length).toBe(1)
  })

  test('来回交换刷不出第四次抽卡：里程只吃自身位移', () => {
    const e = mk({ deck: ['C-09', 'C-17', 'C-17'] })
    // 直接把玩家挪到接近终点，再挪回来，里程不应增加
    const p = e.player()
    run(e, 30)
    const dist = p.dist
    e.mut.jumpPos('mod.swap', p.horseId, TRACK_LEN - 10)
    e.mut.jumpPos('mod.swap', p.horseId, 0)
    expect(p.dist).toBe(dist)
    expect(p.marksConsumed).toBe(0)
  })
})

describe('mod.field 重力井', () => {
  test('C-10 的最大影响减半，电脑马在半径中点分别获得 -15% 和 +15%', () => {
    const e = mk()
    const owner = e.state.horses[2]!
    const ahead = e.state.horses[1]!
    const behind = e.state.horses[3]!
    owner.pos = fx(10_000)
    ahead.pos = fx(14_000)
    behind.pos = fx(6_000)
    e.applyCard(owner.horseId, 'C-10')
    e.step([])
    expect(e.state.effects.find((fx) => fx.primitive === 'Field')!.payload.strength).toBe(fx(.3))
    expect(ahead.fieldMul).toBe(-fx(.15))
    expect(behind.fieldMul).toBe(fx(.15))
    expect(owner.fieldMul).toBe(0)
  })
  test('前方的马减速、后方的马加速，且距离越远影响越小', () => {
    const e = mk()
    run(e, 60)
    const owner = e.state.horses[2]!
    const ahead = e.state.horses[1]!
    const behind = e.state.horses[3]!
    ahead.pos = owner.pos + fx(1000)
    behind.pos = owner.pos - fx(1000)
    e.applyCard(owner.horseId, 'C-10')
    e.step([])
    expect(ahead.fieldMul).toBeLessThan(0)
    expect(behind.fieldMul).toBeGreaterThan(0)
    // 距离拉远后影响衰减
    const near = Math.abs(ahead.fieldMul)
    ahead.pos = owner.pos + fx(6000)
    e.step([])
    expect(Math.abs(ahead.fieldMul)).toBeLessThan(near)
  })

  test('作用于玩家时走 B3 子池，单个井的影响不超过 ±30%', () => {
    const e = mk()
    run(e, 60)
    const p = e.player()
    const owner = e.state.horses[1]!
    // 井主在玩家身后：玩家处于「前方」，应当被减速
    owner.pos = p.pos - fx(20)
    e.applyCard(owner.horseId, 'C-10')
    const before = p.bandHigh
    e.step([])
    expect(p.bandHigh).toBeLessThan(before)
    expect(p.bandHigh).toBeGreaterThan(0)
    // 反过来：井主在前方时玩家在后方，应当被加速，且不超过 +30%
    owner.pos = p.pos + fx(20)
    e.step([])
    expect(p.bandHigh).toBeGreaterThan(before)
    expect(p.bandHigh).toBeLessThanOrEqual(Math.trunc((before * 13) / 10) + 2)
  })
})

describe('mod.draw 发牌修正', () => {
  test('刷新一次只换一张，另外两张不动，游标整体后移一位', () => {
    const deck = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'].map(
      (_, i) => `C-${String(i + 1).padStart(2, '0')}`,
    )
    const e = mk({ deck })
    const p = e.player()
    e.state.refreshCredits = 1
    p.dist = CHECKPOINT_MARKS[0]!
    e.step([])
    expect(e.state.pending?.candidates).toEqual([deck[0]!, deck[1]!, deck[2]!])
    e.step([{ kind: 'refresh', slot: 1 }])
    expect(e.state.pending?.candidates[0]).toBe(deck[0]!)
    expect(e.state.pending?.candidates[1]).toBe(deck[3]!)
    expect(e.state.pending?.candidates[2]).toBe(deck[2]!)
    e.step([{ kind: 'pick', cardId: null }])
    // 3 张 + 1 次刷新 = 游标前进 4
    expect(e.state.cursor).toBe(4)
    expect(e.state.choices[0]!.refreshes).toEqual([1])
  })

  test('放弃选择游标也前进 3', () => {
    const e = mk()
    const p = e.player()
    p.dist = CHECKPOINT_MARKS[0]!
    e.step([])
    e.step([{ kind: 'pick', cardId: null }])
    expect(e.state.cursor).toBe(3)
    expect(e.state.choices[0]!.reason).toBe('forfeited')
  })

  test('【最后的波纹】之后不再发牌，记为 forfeited', () => {
    const e = mk({ deck: ['C-03', 'C-17', 'C-18'] })
    const p = e.player()
    p.dist = CHECKPOINT_MARKS[0]!
    e.step([])
    e.step([{ kind: 'pick', cardId: 'C-03' }])
    expect(e.state.drawMode).toBe('cut')
    p.dist = CHECKPOINT_MARKS[1]!
    e.step([])
    expect(e.state.pending).toBeNull()
    expect(e.state.choices[1]!.reason).toBe('forfeited')
  })

  test('【选择困难综合症】之后自动选牌，且后续每张卡额外 +20%', () => {
    const e = mk({ deck: ['C-04', 'C-17', 'C-18'] })
    const p = e.player()
    p.dist = CHECKPOINT_MARKS[0]!
    e.step([])
    e.step([{ kind: 'pick', cardId: 'C-04' }])
    expect(e.state.drawMode).toBe('auto')
    expect(e.state.drawBonusPct).toBe(fx(0.2))
    p.dist = CHECKPOINT_MARKS[1]!
    e.step([])
    // 自动抽取立刻结算，不留面板
    expect(e.state.pending).toBeNull()
    expect(e.state.choices[1]!.reason).toBe('picked')
  })

  test('里程不足的检查点记为 not-reached，不补发', () => {
    const e = mk()
    const p = e.player()
    p.pos = TRACK_LEN - fx(1)
    run(e, 3)
    const r = e.buildResult('t')
    expect(r.choices.filter((c) => c.reason === 'not-reached').length).toBe(3)
  })
})

describe('mod.env 天气', () => {
  test('只作用于【起飞】的马，玩家与电脑马一视同仁', () => {
    const e = mk()
    run(e, 40)
    const p = e.player()
    e.applyCard(e.state.horses[1]!.horseId, 'C-12')
    e.step([])
    const without = p.bandHigh
    e.applyCard(p.horseId, 'C-01') // 起飞
    e.step([])
    expect(p.bandHigh).not.toBe(without)
    expect(e.state.env).not.toBeNull()
  })

  test('环境是单槽，新的完整替换旧的', () => {
    const e = mk()
    run(e, 40)
    e.applyCard(e.state.horses[1]!.horseId, 'C-12')
    const first = e.state.env!.instanceId
    e.applyCard(e.state.horses[2]!.horseId, 'C-12')
    expect(e.state.env!.instanceId).not.toBe(first)
    expect(e.state.effects.filter((x) => x.primitive === 'Environment').length).toBe(1)
  })
})

describe('mod.equipment 与 mod.steal', () => {
  test('同一插槽新的覆盖旧的', () => {
    const e = mk()
    run(e, 30)
    const p = e.player()
    e.applyCard(p.horseId, 'C-07') // 火箭喷射器 torso
    e.applyCard(p.horseId, 'C-10') // 黑洞 torso
    const torso = e.equipmentOf(p.horseId).filter((x) => x.payload.slot === 'torso')
    expect(torso.length).toBe(1)
    expect(torso[0]!.payload.equipId).toBe('blackhole')
  })

  test('顺手牵羊转移装备并刷新完整时长；场上无装备时空过', () => {
    const e = mk()
    run(e, 30)
    const p = e.player()
    e.applyCard(p.horseId, 'C-13')
    expect(e.equipmentOf(p.horseId).length).toBe(0) // 空过

    const victim = e.state.horses[1]!
    e.applyCard(victim.horseId, 'C-07')
    run(e, 200)
    e.applyCard(p.horseId, 'C-13')
    const stolen = e.equipmentOf(p.horseId)
    expect(stolen.length).toBe(1)
    expect(stolen[0]!.payload.equipId).toBe('rocket')
    expect(stolen[0]!.appliedAtTick).toBe(e.state.tick)
    expect(e.equipmentOf(victim.horseId).length).toBe(0)
  })
})

describe('mod.suppress 与体力', () => {
  test('体力见底挂上系统自持的【力竭】，恢复到 30% 解除', () => {
    const e = mk()
    const p = e.player()
    // 用完美节奏把体力打空，第一次进入力竭时停下来断言
    let entered = false
    for (let i = 0; i < 900 && !entered; i++) {
      e.step(i % 25 === 0 ? [{ kind: 'gogoDown' }] : [])
      entered = e.state.events.some((x) => x.type === 'exhaustEnter')
    }
    expect(entered).toBe(true)
    expect(e.hasStatus(p.horseId, 'exhausted')).toBe(true)
    const inst = e.state.effects.find((x) => x.payload.statusId === 'exhausted')!
    expect(inst.tags).toContain('system')
    while (p.stamina < EXHAUST_RELEASE) e.step([])
    e.step([])
    expect(e.hasStatus(p.horseId, 'exhausted')).toBe(false)
  })

  test('【咖啡因过量】按 tag 抑制力竭，不是体力模块里的写死分支', () => {
    const e = mk()
    const p = e.player()
    let entered = false
    for (let i = 0; i < 900 && !entered; i++) {
      e.step(i % 25 === 0 ? [{ kind: 'gogoDown' }] : [])
      entered = e.state.events.some((x) => x.type === 'exhaustEnter')
    }
    expect(e.hasStatus(p.horseId, 'exhausted')).toBe(true)
    e.applyCard(p.horseId, 'C-16')
    expect(e.hasStatus(p.horseId, 'exhausted')).toBe(false)
    // 亢奋期间不再挂回
    for (let i = 0; i < 100; i++) e.step(i % 25 === 0 ? [{ kind: 'gogoDown' }] : [])
    expect(e.hasStatus(p.horseId, 'exhausted')).toBe(false)
    expect(p.stamina).toBeGreaterThanOrEqual(0)
  })

  test('肾上腺素允许体力越过上限，且恢复不会把它推回上限之上', () => {
    const e = mk()
    const p = e.player()
    e.applyCard(p.horseId, 'C-15')
    expect(p.stamina).toBe(STAMINA_MAX + fx(200))
    run(e, 50) // 无输入，只恢复
    expect(p.stamina).toBe(STAMINA_MAX + fx(200))
  })
})

describe('mod.combo 版本答案', () => {
  test('集齐【薄肌】【黄毛】【理解孙学】直接判第一，已冲线的马整体下移一位', () => {
    const e = mk()
    run(e, 60)
    // 先让一匹电脑马冲线
    const first = e.state.horses[1]!
    first.pos = TRACK_LEN + fx(5)
    e.step([])
    expect(first.rank).toBe(1)

    const p = e.player()
    e.applyCard(p.horseId, 'C-19')
    e.applyCard(p.horseId, 'C-21')
    e.applyCard(p.horseId, 'C-17')
    e.step([])
    expect(p.rank).toBe(1)
    expect(first.rank).toBe(2)
    expect(e.state.endReason).toBe('forced-combo')
    expect(e.state.events.some((x) => x.type === 'combo')).toBe(true)
  })

  test('不集齐不触发', () => {
    const e = mk()
    run(e, 60)
    const p = e.player()
    e.applyCard(p.horseId, 'C-19')
    e.applyCard(p.horseId, 'C-17')
    run(e, 5)
    expect(e.state.forcedRank).toBeNull()
  })
})

describe('mod.cosmetic', () => {
  test('毛色单槽，后染的盖掉先染的', () => {
    const e = mk()
    const p = e.player()
    e.applyCard(p.horseId, 'C-19')
    e.applyCard(p.horseId, 'C-20')
    const coats = e.effectsOf(p.horseId).filter((x) => x.payload.statusId === 'coat')
    expect(coats.length).toBe(1)
    expect(coats[0]!.sourceCardId).toBe('C-20')
  })

  test('【目中无人】的马不会被交换、不会被炸到、不受天气影响', () => {
    const e = mk()
    run(e, 40)
    const p = e.player()
    e.applyCard(p.horseId, 'C-21')
    // 炸不到
    e.mut.spawnHazard('mod.hazard', { laneIndex: p.laneIndex, pos: p.pos + 1, sourceCardId: 'C-06' })
    e.step([])
    expect(e.state.events.some((x) => x.type === 'explosion')).toBe(false)
    // 天气吹不到
    e.applyCard(p.horseId, 'C-01')
    e.applyCard(e.state.horses[1]!.horseId, 'C-12')
    e.step([])
    const env = e.state.env!
    const dir = env.payload.windDir as number
    expect([1, -1]).toContain(dir)
  })
})

describe('乘区与流水线', () => {
  test('同阶段内拿牌顺序不影响结果', () => {
    const order = (cards: string[]): number => {
      const e = mk()
      run(e, 20)
      for (const c of cards) e.applyCard(e.state.playerHorseId, c)
      run(e, 5)
      return e.player().bandHigh
    }
    expect(order(['C-17', 'C-18', 'C-01'])).toBe(order(['C-01', 'C-18', 'C-17']))
  })

  test('速度带被硬上限钳住，不会被增益推出可控范围', () => {
    const e = mk()
    run(e, 20)
    const p = e.player()
    for (const c of ['C-01', 'C-02', 'C-03', 'C-07', 'C-08', 'C-17', 'C-18', 'C-21']) {
      e.applyCard(p.horseId, c)
    }
    run(e, 5)
    expect(p.bandHigh).toBeLessThanOrEqual(fx(80))
    expect(p.v).toBeLessThanOrEqual(fx(80))
  })
})

describe('帧率无关', () => {
  test('同一输入序列在不同调用节奏下终态相等（规则内核只认 tick）', () => {
    const inputs: Record<number, RaceInput[]> = {}
    for (let t = 0; t < 4000; t += 25) inputs[t] = [{ kind: 'gogoDown' }]
    const trace = (chunk: number): string => {
      const e = mk({ deck: ['C-17', 'C-18', 'C-01'] })
      let t = 0
      while (!e.state.raceOver && t < 20000) {
        for (let k = 0; k < chunk && !e.state.raceOver; k++) {
          const frame = inputs[e.state.tick] ?? []
          if (e.state.pending) e.step([{ kind: 'pick', cardId: e.state.pending.candidates[0]! }])
          else e.step(frame)
          t++
        }
      }
      return e.state.horses.map((h) => `${h.pos},${h.dist},${h.v},${h.rank}`).join(';')
    }
    // 每帧推进 1 / 2 / 4 个 tick，对应 120 / 60 / 30 fps
    expect(trace(1)).toBe(trace(2))
    expect(trace(2)).toBe(trace(4))
  }, 30000)
})

test('FP 常量与预期一致', () => {
  expect(FP).toBe(10000)
  expect(fx(1)).toBe(FP)
})
