import { describe, expect, test } from 'bun:test'
import { finishJingle, raceEventSound, raceEventSounds } from './raceEventAudio.ts'

describe('比赛事件音效映射', () => {
  test('C-09 成功交换播放拍手交换音效', () => {
    expect(raceEventSound('swap')).toBe('audio.sfx_swap')
  })

  test('装备转移与换位保留各自音效', () => {
    expect(raceEventSound('steal')).toBe('audio.sfx_equip')
    expect(raceEventSound('equipOn')).toBe('audio.sfx_equip')
    expect(raceEventSound('checkpoint')).toBe('audio.sfx_checkpoint')
  })

  test('无专属音效的事件不合成默认音效', () => {
    expect(raceEventSound('statusStack')).toBeUndefined()
  })

  test('同一帧内的装备转移只播放一次装备音效', () => {
    expect(raceEventSounds([
      { type: 'equipOff', horseId: 1, equipId: 'fireWheel', slot: 'hoof_fl', tick: 10 },
      { type: 'equipOff', horseId: 1, equipId: 'fireWheel', slot: 'hoof_fr', tick: 10 },
      { type: 'equipOn', horseId: 0, equipId: 'fireWheel', slot: 'hoof_fl', tick: 10 },
      { type: 'equipOn', horseId: 0, equipId: 'fireWheel', slot: 'hoof_fr', tick: 10 },
      { type: 'steal', from: 1, to: 0, equipId: 'fireWheel', tick: 10 },
    ])).toEqual(['audio.sfx_equip'])
  })
})

test('电脑马及玩家的 finish 事件不播放通用冲线旋律，胜负由玩家最终名次单独决定', () => {
  expect(raceEventSounds([
    { type: 'finish', horseId: 1, rank: 1, tick: 10 },
    { type: 'finish', horseId: 0, rank: 2, tick: 11 },
  ])).toEqual([])
})

test('玩家第一名和第二名播放胜利旋律，其余名次播放失败旋律', () => {
  expect([1, 2, 3, 4, 5].map(finishJingle)).toEqual([
    'audio.jingle_win', 'audio.jingle_win', 'audio.jingle_lose', 'audio.jingle_lose', 'audio.jingle_lose',
  ])
})

test('电脑马获得卡、装备、风或到达发牌点都不播放玩家获得音效', () => {
  expect(raceEventSounds([
    { type: 'cardPicked', horseId: 0, cardId: 'C-07', tick: 10 },
    { type: 'equipOn', horseId: 0, equipId: 'rocket', slot: 'torso', tick: 10 },
    { type: 'checkpoint', horseId: 0, mark: 1, tick: 10 },
    { type: 'steal', from: 3, to: 0, equipId: 'rocket', tick: 10 },
    { type: 'wind', horseId: 0, dir: 1, tick: 10 },
  ], 3)).toEqual([])
})

test('非零玩家槽位保留获得音效，CPU 的装备事件不吞掉玩家同帧音效', () => {
  expect(raceEventSounds([
    { type: 'equipOn', horseId: 0, equipId: 'rocket', slot: 'torso', tick: 10 },
    { type: 'equipOn', horseId: 3, equipId: 'rocket', slot: 'torso', tick: 10 },
    { type: 'cardPicked', horseId: 3, cardId: 'C-07', tick: 10 },
    { type: 'checkpoint', horseId: 3, mark: 1, tick: 10 },
    { type: 'wind', horseId: 3, dir: -1, tick: 10 },
  ], 3)).toEqual(['audio.sfx_equip', 'audio.sfx_card_pick', 'audio.sfx_checkpoint', 'audio.sfx_card_refresh'])
})
