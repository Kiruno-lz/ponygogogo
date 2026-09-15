/**
 * 赛道上的小马渲染对象。美术来自 ponyArt.ts 的同一份 SVG，菜单与赛道不会跑偏。
 *
 * 占位阶段不把装备画在马身上（见 docs/plan/demo.md §5.1）：
 * 马的身份用颜色 + 号码布表达，装备与状态以图标形式出现在 HUD 与卡面上。
 */
import Phaser from 'phaser'
import type { HorseProfile } from './horses.ts'
import {
  RASTER,
  ponyBodySvg,
  ponyLegSvg,
  ponyTailSvg,
  svgToDataUrl,
} from './ponyArt.ts'

export const PONY_SCALE = 0.72

export function ponyTextureKeys(horseId: number): { body: string; tail: string; leg: string } {
  return {
    body: `pony_body_${horseId}`,
    tail: `pony_tail_${horseId}`,
    leg: `pony_leg_${horseId}`,
  }
}

export type PonyImages = Record<string, HTMLImageElement>

function decode(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('pony svg decode failed'))
    img.src = svgToDataUrl(source)
  })
}

/**
 * 自己把小马 SVG 栅格化成 Image，再交给 Phaser 的 TextureManager。
 * 不走 Phaser 的 load.svg：它把多张 SVG 渲染进同一块复用画布，贴图之间会互相串味。
 */
export async function preparePonyImages(profiles: HorseProfile[]): Promise<PonyImages> {
  const out: PonyImages = {}
  await Promise.all(
    profiles.flatMap((p) => {
      const k = ponyTextureKeys(p.horseId)
      return [
        decode(ponyBodySvg(p, RASTER)).then((img) => {
          out[k.body] = img
        }),
        decode(ponyTailSvg(p, RASTER)).then((img) => {
          out[k.tail] = img
        }),
        decode(ponyLegSvg(p, RASTER)).then((img) => {
          out[k.leg] = img
        }),
      ]
    }),
  )
  return out
}

/** 在场景 create 阶段登记贴图，同步完成，不经过加载器 */
export function registerPonyTextures(scene: Phaser.Scene, images: PonyImages): void {
  for (const [key, img] of Object.entries(images)) {
    if (!scene.textures.exists(key)) scene.textures.addImage(key, img)
  }
}

export interface PonyOptions {
  profile: HorseProfile
  isPlayer: boolean
}

export class PonySprite extends Phaser.GameObjects.Container {
  private readonly legs: Phaser.GameObjects.Image[] = []
  private readonly torso: Phaser.GameObjects.Image
  private readonly tail: Phaser.GameObjects.Image
  private readonly ring: Phaser.GameObjects.Ellipse
  private readonly shadow: Phaser.GameObjects.Ellipse
  private readonly tag: Phaser.GameObjects.Text
  private readonly badge: Phaser.GameObjects.Arc
  private readonly root: Phaser.GameObjects.Container
  private phase = 0
  private coat: number | null | undefined = undefined

  constructor(scene: Phaser.Scene, readonly opts: PonyOptions) {
    super(scene, 0, 0)
    const p = opts.profile
    const k = ponyTextureKeys(p.horseId)
    const S = PONY_SCALE / RASTER // SVG 以 RASTER 倍分辨率栅格化

    this.shadow = scene.add.ellipse(0, 0, 132, 20, 0x000000, 0.26)
    this.add(this.shadow)
    this.ring = scene.add.ellipse(0, 0, 164, 34, 0xf4a22a, 0)
    this.ring.setStrokeStyle(6, 0xf9c74f, 0)
    this.add(this.ring)

    this.root = scene.add.container(0, 0)
    this.add(this.root)

    // 后腿（压在身体下）
    for (let i = 0; i < 2; i++) {
      const leg = scene.add
        .image(-34 + i * 16 * PONY_SCALE, -60, k.leg)
        .setOrigin(0.5, 0.06)
        .setScale(S)
      leg.setTint(p.bodyShade)
      this.root.add(leg)
      this.legs.push(leg)
    }
    this.tail = scene.add.image(-52, -76, k.tail).setOrigin(0.88, 0.12).setScale(S)
    this.root.add(this.tail)

    this.torso = scene.add.image(0, -70, k.body).setOrigin(0.44, 0.5).setScale(S)
    this.root.add(this.torso)

    for (let i = 0; i < 2; i++) {
      const leg = scene.add
        .image(22 + i * 16 * PONY_SCALE, -60, k.leg)
        .setOrigin(0.5, 0.06)
        .setScale(S)
      this.root.add(leg)
      this.legs.push(leg)
    }

    this.badge = scene.add.circle(-40, -74, 14, 0xf1cdb0, 0.95)
    this.badge.setStrokeStyle(3, 0x57250c, 0.85)
    this.tag = scene.add
      .text(-40, -74, String(p.horseId + 1), {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: '18px',
        color: '#57250c',
      })
      .setOrigin(0.5)
    this.root.add(this.badge)
    this.root.add(this.tag)

    if (opts.isPlayer) {
      this.ring.setFillStyle(0xffd75e, 0.13)
      this.ring.setStrokeStyle(6, 0xfff0b8, 1)
    }
    scene.add.existing(this)
  }

  setCoat(color: number | null): void {
    if (this.coat === color) return
    this.coat = color
    if (color === null) this.tail.clearTint()
    else this.tail.setTint(color)
  }

  /** speedRatio 0..1 决定步频；airborne 抬升整个 rig 根节点，全部挂载物自动跟随 */
  tickAnim(dtMs: number, speedRatio: number, airborne: boolean, stopped: boolean): void {
    const rate = 0.005 + speedRatio * 0.017
    this.phase += dtMs * rate
    const amp = stopped ? 0.04 : 0.3 + speedRatio * 0.5
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i]!
      const ph = this.phase + (i % 2 === 0 ? 0 : Math.PI) + (i < 2 ? 0.7 : 0)
      leg.rotation = Math.sin(ph) * amp
    }
    const bob = Math.sin(this.phase * 2) * (1.5 + speedRatio * 3)
    this.torso.y = -70 + bob
    this.tail.y = -76 + bob * 0.6
    this.tail.rotation = Math.sin(this.phase * 0.9) * 0.2 - 0.08
    this.badge.y = -74 + bob
    this.tag.y = -74 + bob
    const targetLift = airborne ? -46 : 0
    this.root.y += (targetLift - this.root.y) * Math.min(1, dtMs / 90)
    this.shadow.setScale(airborne ? 0.62 : 1)
    this.shadow.setAlpha(airborne ? 0.14 : 0.26)
  }

  setGhost(on: boolean): void {
    this.root.setAlpha(on ? 0.42 : 1)
  }
}
