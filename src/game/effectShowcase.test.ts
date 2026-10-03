import { describe, expect, test } from 'bun:test'
import { CARD_POOL } from '../race/cards/pool.ts'
import { activeEquipmentVisuals, isSpinVisualActive } from './effects.ts'
import { EFFECT_SHOWCASE_SCENARIOS, EffectShowcaseDriver } from './effectShowcase.ts'

describe('开发特效展示驱动器', () => {
  test('展示入口枚举与旧版 21 张卡池（C-01..C-21）完全一致', () => {
    expect(EFFECT_SHOWCASE_SCENARIOS).toEqual(CARD_POOL.map((card) => card.cardId))
  })

  test('所有卡牌都产生真实效果快照或一次性效果回放', () => {
    for (const card of CARD_POOL) {
      const driver = new EffectShowcaseDriver(card.cardId)
      driver.update(0)
      expect(driver.state.effects.some((effect) => effect.sourceCardId === card.cardId), card.cardId).toBe(true)
    }
  })

  test('C-02 使用真实效果快照并在预设结束点移除旋转状态', () => {
    const driver = new EffectShowcaseDriver('C-02')
    driver.update(0)
    expect(isSpinVisualActive(driver.state.effects, 0)).toBe(true)
    driver.update(7_000)
    expect(isSpinVisualActive(driver.state.effects, 0)).toBe(false)
  })

  test('C-13 只发出一次来源到目标的装备转移事件，最终归属来自快照', () => {
    const driver = new EffectShowcaseDriver('C-13')
    driver.update(0)
    expect(activeEquipmentVisuals(driver.state.effects, 1)).toEqual(['rocket'])
    expect(driver.update(1_000)).toEqual([
      { type: 'steal', from: 1, to: 0, equipId: 'rocket', tick: 50 },
    ])
    expect(activeEquipmentVisuals(driver.state.effects, 0)).toEqual(['rocket'])
    expect(activeEquipmentVisuals(driver.state.effects, 1)).toEqual([])
    expect(driver.update(1_100)).toEqual([])
  })

  test('C-09 只在预设成功交换时发出一次事件', () => {
    const driver = new EffectShowcaseDriver('C-09')
    driver.update(0)
    const events = driver.update(1_000)
    expect(events).toEqual([{ type: 'swap', a: 0, b: 1, tick: 50 }])
    expect(driver.state.horses[0]?.laneIndex).toBe(1)
    expect(driver.update(2_000)).toEqual([])
  })

  test('C-10 展示装备但不把重力井场映射成马身装备', () => {
    const driver = new EffectShowcaseDriver('C-10')
    driver.update(0)
    expect(activeEquipmentVisuals(driver.state.effects, 0)).toEqual(['blackhole'])
    expect(driver.state.effects.some((effect) => effect.primitive === 'Field')).toBe(true)
  })

  test('C-11 展示风火轮与起飞状态，但火焰层数不映射为身体装备', () => {
    const driver = new EffectShowcaseDriver('C-11')
    driver.update(0)
    expect(activeEquipmentVisuals(driver.state.effects, 0)).toEqual(['fireWheel'])
    expect(isSpinVisualActive(driver.state.effects, 0)).toBe(false)
    expect(driver.state.effects.some((effect) => effect.primitive === 'Status' && effect.payload.statusId === 'burning')).toBe(true)
  })

  test('暂停时展示时间冻结，恢复后继续同一情景', () => {
    const driver = new EffectShowcaseDriver('C-02')
    driver.update(0)
    driver.pause()
    driver.update(8_000)
    expect(isSpinVisualActive(driver.state.effects, 0)).toBe(true)
    driver.resume()
    driver.update(8_100)
    expect(isSpinVisualActive(driver.state.effects, 0)).toBe(true)
  })

  test('暂停状态逐步推进时仍按同一时间线产生一次转移事件', () => {
    const driver = new EffectShowcaseDriver('C-13')
    driver.update(0)
    driver.pause()
    for (let i = 0; i < 10; i++) driver.step(100)
    expect(driver.update(1_000)).toEqual([
      { type: 'steal', from: 1, to: 0, equipId: 'rocket', tick: 50 },
    ])
    expect(driver.update(1_100)).toEqual([])
  })
})
