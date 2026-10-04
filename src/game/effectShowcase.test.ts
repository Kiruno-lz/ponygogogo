import { describe, expect, test } from 'bun:test'
import { PAID_CARD_POOL } from '../race/cards/paidCards.ts'
import { solvePaidCore } from '../race/paid/solver.ts'
import { EV_CARD, EV_STEAL, EV_SWAP, EV_WIND } from '../race/paid/events.ts'
import { buildPaidSnapshot } from '../race/paidSnapshot.ts'
import { tauAtWall } from '../race/paid/trace.ts'
import { PONY_CATALOG } from './ponyCatalog.ts'
import { EFFECT_SHOWCASE_SCENARIOS, EffectShowcaseDriver } from './effectShowcase.ts'

describe('特效验收复用正式求时器与快照', () => {
  test('菜单覆盖当前全部 40 张卡，而非旧卡池', () => {
    expect(EFFECT_SHOWCASE_SCENARIOS).toEqual(PAID_CARD_POOL.map(c => c.cardId))
  })

  test('每张卡经合法检查点选择进入正式轨迹，规则摘要与正式求解一致', () => {
    for (const card of PAID_CARD_POOL) {
      const driver = new EffectShowcaseDriver(card.cardId)
      const result = driver.canonicalResult()
      const id = Number(card.cardId.slice(2))
      expect(result.trace!.cards.some(c => c.horse === driver.state.playerHorseId && c.cardId === id), card.cardId).toBe(true)
      expect(result.checkpoints.some(c => c.cardId === id && c.invalidReason === 0), card.cardId).toBe(true)
      expect(solvePaidCore(driver.replayInput, { trace: false }).digest, card.cardId).toBe(result.digest)
      driver.showEffect()
      expect(driver.state.pending, card.cardId).toBeNull()
      const trace = result.trace!, tau = tauAtWall(trace, BigInt(Math.floor(driver.elapsedWallMs)))
      const expected = buildPaidSnapshot({ trace, tau, playerHorseId: driver.state.playerHorseId, stakeTier: 0,
        roster: driver.replayInput.roster, seed: driver.replayInput.seed, panel: null, draw: null,
        playerDeck: driver.replayInput.playerDeck, finishTime: result.finishTime, raceOver: tau >= trace.tauEnd,
        versionAnswer: result.versionAnswer })
      expect(driver.state.horses, card.cardId).toEqual(expected.horses)
      expect(driver.state.effects, card.cardId).toEqual(expected.effects)
    }
  })

  test('九角色 × 四十卡都支持非零玩家槽位，角色身份与比赛槽位独立', () => {
    for (const pony of PONY_CATALOG) {
      const others = PONY_CATALOG.filter(p => p.ponyId !== pony.ponyId).slice(0, 4).map(p => p.ponyId)
      const roster = [...others.slice(0, 3), pony.ponyId, others[3]!]
      for (const card of PAID_CARD_POOL) {
        const driver = new EffectShowcaseDriver(card.cardId, { playerHorseId: 3, roster })
        expect(driver.state.roster).toEqual(roster)
        expect(driver.state.playerHorseId).toBe(3)
        expect(driver.canonicalResult().trace!.cards.some(c => c.horse === 3 && c.cardId === Number(card.cardId.slice(2)))).toBe(true)
        driver.showEffect()
        if (card.cardId === 'C-07') expect(driver.state.effects.some(e => e.sourceCardId === 'C-07' && e.ownerHorseId === 3)).toBe(true)
      }
    }
  })

  test('交换和偷取来自求时器事件，偷取前有合法 CPU 装备', () => {
    const steal = new EffectShowcaseDriver('C-13')
    expect(steal.canonicalResult().events.some(e => e.code === EV_STEAL && e.horse === 0)).toBe(true)
    steal.showEffect()
    const events = steal.update(0)
    expect(events.some(e => e.type === 'steal' && e.to === 0)).toBe(true)
    expect(steal.update(0)).toEqual([])
    const swap = new EffectShowcaseDriver('C-09')
    expect(swap.canonicalResult().events.some(e => e.code === EV_SWAP && e.horse === 0)).toBe(true)
  })

  test('风向控制改变确定性锚，不伪造快照', () => {
    for (const direction of [1, -1] as const) {
      const driver = new EffectShowcaseDriver('C-12', { windDirection: direction })
      const wind = driver.canonicalResult().events.find(e => e.code === EV_WIND && e.horse === 0)!
      expect(wind.arg > 0n ? 1 : -1).toBe(direction)
      expect(solvePaidCore(driver.replayInput, { trace: false }).digest).toBe(driver.canonicalResult().digest)
    }
  })

  test('暂停、逐帧、恢复、重播使用同一时间轴，事件只播放一次', () => {
    const driver = new EffectShowcaseDriver('C-02')
    driver.update(0)
    driver.pause()
    const before = driver.state.tick
    driver.update(8_000)
    expect(driver.state.tick).toBe(before)
    const beforeWall = driver.elapsedWallMs
    driver.step()
    expect(driver.elapsedWallMs).toBe(beforeWall + 100)
    expect(driver.state.tick).toBe(Number(tauAtWall(driver.canonicalResult().trace!, BigInt(driver.elapsedWallMs)) / 20n))
    const stepped = driver.elapsedWallMs
    driver.resume()
    driver.update(8_100)
    expect(driver.elapsedWallMs).toBe(stepped + 100)
    driver.restart()
    expect(driver.state.tick).toBe(before)
    expect(driver.canonicalResult().events.some(e => e.code === EV_CARD && Number(e.arg) === 2)).toBe(true)
  })
})
