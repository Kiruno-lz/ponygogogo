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
