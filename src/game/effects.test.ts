import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import type { EffectInstance } from '../race/core/types.ts'
import {
  activeEquipmentVisuals,
  activeWindDirection,
  EFFECT_TEXTURES,
  equipmentTransferPose,
  isSpinVisualActive,
  spriteAnchorOffset,
  spinVisualPose,
  spinThrustPose,
  verticalPivotOffset,
} from './effects.ts'

const testArtworkSource = existsSync(new URL('../../art-src/art/effects/rocket-sheet.png', import.meta.url)) ? test : test.skip

function effect(overrides: Partial<EffectInstance>): EffectInstance {
  return {
    instanceId: 1,
    sourceCardId: 'C-07',
    primitive: 'Equipment',
    moduleId: 'mod.equipment',
    ownerHorseId: 0,
    appliedAtTick: 0,
    durationTicks: 100,
    tags: ['equipment'],
    payload: {},
    ...overrides,
  }
}

describe('比赛表现层的装备与天气映射', () => {
  test('只返回指定马匹实际装备中的受支持素材', () => {
    const effects = [
      effect({ instanceId: 1, ownerHorseId: 2, payload: { equipId: 'rocket' } }),
      effect({ instanceId: 2, ownerHorseId: 2, payload: { equipId: 'fireWheel' } }),
      effect({ instanceId: 3, ownerHorseId: 1, payload: { equipId: 'blackhole' } }),
      effect({ instanceId: 4, ownerHorseId: 2, payload: { equipId: 'futureUnknown' } }),
      effect({ instanceId: 6, ownerHorseId: 2, primitive: 'Status', payload: { statusId: 'burning', stacks: 3 } }),
      effect({ instanceId: 5, ownerHorseId: 2, primitive: 'Status', payload: { equipId: 'rainbowTrail' } }),
    ]

    expect(activeEquipmentVisuals(effects, 2)).toEqual(['rocket', 'fireWheel'])
    expect(activeEquipmentVisuals(effects, 1)).toEqual(['blackhole'])
    expect(activeEquipmentVisuals(effects, 4)).toEqual([])
  })

  test('只读取全局风环境，并保留规则层给出的方向', () => {
    const effects = [
      effect({ instanceId: 1, ownerHorseId: 0, primitive: 'Environment', payload: { envKind: 'wind', windDir: -1 } }),
      effect({ instanceId: 2, ownerHorseId: -1, primitive: 'Environment', payload: { envKind: 'wind', windDir: 1 } }),
    ]
    expect(activeWindDirection(effects)).toBe(1)
    expect(activeWindDirection([])).toBeNull()
  })

  test('旋转表现只跟随指定马匹的运气 E 状态', () => {
    const effects = [
      effect({ ownerHorseId: 1, primitive: 'Status', payload: { statusId: 'luckE', spin: true } }),
      effect({ instanceId: 2, ownerHorseId: 2, primitive: 'Status', payload: { statusId: 'luckE', spin: true } }),
      effect({ instanceId: 3, ownerHorseId: 1, primitive: 'Status', payload: { statusId: 'burning', stacks: 4 } }),
    ]
    expect(isSpinVisualActive(effects, 1)).toBe(true)
    expect(isSpinVisualActive(effects, 2)).toBe(true)
    expect(isSpinVisualActive(effects, 3)).toBe(false)
    expect(isSpinVisualActive(effects, 4)).toBe(false)
  })

  test('旋转按模拟时间确定，减少动态效果时保持静止直立', () => {
    const start = spinVisualPose(0, false)
    const later = spinVisualPose(130, false)
    expect(later).not.toEqual(start)
    expect(spinVisualPose(325, false).flipY).toBe(true)
    expect(spinVisualPose(0, true)).toEqual(spinVisualPose(10_000, true))
    expect(spinVisualPose(0, true).flipY).toBe(false)
  })

  test('翻转偏移围绕马体中心，图片中心在缩放前后位置不变', () => {
    const centerY = -70
    for (const scaleY of [-1, -0.2, 0.2, 1]) {
      const offset = verticalPivotOffset(centerY, scaleY)
      expect(offset + scaleY * centerY).toBeCloseTo(centerY)
    }
  })

  test('装备挂点由精灵腹部比例与实际显示尺寸确定', () => {
    const anchor = spriteAnchorOffset(144, 144, 0.5, 180 / 192, 0.44, 0.68)
    expect(anchor.x).toBeCloseTo(-8.64)
    expect(anchor.y).toBeCloseTo((0.68 - 180 / 192) * 144)
  })

  test('突进分镜绑定实际马图中心，尺寸随马匹变化且暂停相位可复现', () => {
    const normal = spinThrustPose(192, 144, 180 / 192, 0, false)
    const player = spinThrustPose(217.6, 163.2, 180 / 192, 0, false)
    expect(normal.x).toBe(0)
    expect(normal.y).toBeCloseTo(-63)
    expect(player.y).toBeCloseTo(-71.4)
    expect(player.width / normal.width).toBeCloseTo(217.6 / 192)
    expect(normal.width / normal.height).toBe(1.5)
    expect(spinThrustPose(192, 144, 180 / 192, 325, false).frame).toBe(8)
    expect(spinThrustPose(192, 144, 180 / 192, 650, false)).toEqual(normal)
    expect(spinThrustPose(192, 144, 180 / 192, 10_000, true).frame).toBe(0)
  })

  test('装备转移沿短弧线飞行并在 reduced-motion 下直接到达', () => {
    const from = { x: 10, y: 80 }
    const to = { x: 110, y: 80 }
    expect(equipmentTransferPose(from, to, 0, false)).toMatchObject({ x: 10, y: 80, done: false })
    const middle = equipmentTransferPose(from, to, 0.5, false)
    expect(middle.x).toBe(60)
    expect(middle.y).toBeLessThan(80)
    expect(equipmentTransferPose(from, to, 1, false)).toMatchObject({ x: 110, y: 80, done: true })
    expect(equipmentTransferPose(from, to, 0.25, true)).toMatchObject({ x: 110, y: 80, done: true })
  })

  test('六套素材都声明为 16 帧 4×4 分镜', () => {
    expect(Object.keys(EFFECT_TEXTURES).sort()).toEqual(['blackhole', 'fireWheel', 'rainbowTrail', 'rocket', 'spinThrust', 'wind'])
    for (const spec of Object.values(EFFECT_TEXTURES)) {
      expect(spec.frameCount).toBe(16)
      expect(spec.columns).toBe(4)
      expect(spec.rows).toBe(4)
    }
  })

  testArtworkSource('归一后的 PNG 母版尺寸与透明通道匹配帧声明', () => {
    const folder = new URL('../../art-src/art/effects/', import.meta.url)
    const filenames: Record<keyof typeof EFFECT_TEXTURES, string> = {
      rocket: 'rocket-sheet.png',
      rainbowTrail: 'rainbow-trail-sheet.png',
      blackhole: 'blackhole-sheet.png',
      fireWheel: 'fire-wheel-sheet.png',
      wind: 'wind-sheet.png',
      spinThrust: 'spin-thrust-sheet.png',
    }
    for (const [id, spec] of Object.entries(EFFECT_TEXTURES) as [keyof typeof EFFECT_TEXTURES, typeof EFFECT_TEXTURES[keyof typeof EFFECT_TEXTURES]][]) {
      const bytes = readFileSync(new URL(filenames[id], folder))
      expect(bytes.subarray(0, 8).toString('hex'), id).toBe('89504e470d0a1a0a')
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], id).toEqual([
        spec.frameWidth * spec.columns,
        spec.frameHeight * spec.rows,
      ])
      expect(bytes[25], `${id} 必须是 RGBA PNG`).toBe(6)
    }
  })
})
