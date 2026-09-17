/** 赛道美术对象：只订阅速度、停步、飞行和外观状态，PNG 帧不参与规则。 */
import Phaser from 'phaser'
import type { HorseProfile } from './horses.ts'
import { decodeImage } from './images.ts'

export const PONY_SCALE = 0.75
const FRAME_W = 256
const FRAME_H = 192
const FRAME_COUNT = 8

export function ponyTextureKeys(horseId: number): { running: string; idle: string } {
  return { running: `pony_running_${horseId}`, idle: `pony_idle_${horseId}` }
}
export type PonyImages = Record<string, HTMLImageElement>

export async function preparePonyImages(profiles: HorseProfile[]): Promise<PonyImages> {
  const out: PonyImages = {}
  await Promise.all(profiles.flatMap(p => {
    const keys = ponyTextureKeys(p.horseId)
    return (['running', 'idle'] as const).map(action =>
      decodeImage(`/assets/art/ponies/${p.horseId}-${action}.png`).then(img => { out[keys[action]] = img }))
  }))
  return out
}

export function registerPonyTextures(scene: Phaser.Scene, images: PonyImages): void {
  for (const [key, img] of Object.entries(images)) {
    if (!scene.textures.exists(key)) scene.textures.addSpriteSheet(key, img, { frameWidth: FRAME_W, frameHeight: FRAME_H })
  }
}

export interface PonyOptions { profile: HorseProfile; isPlayer: boolean }

export class PonySprite extends Phaser.GameObjects.Container {
  private readonly torso: Phaser.GameObjects.Image
  private readonly ring: Phaser.GameObjects.Image
  private readonly shadow: Phaser.GameObjects.Ellipse
  private readonly root: Phaser.GameObjects.Container
  private phase = 0
  private coat: number | null | undefined = undefined
  private action: 'running' | 'idle' = 'idle'

  constructor(scene: Phaser.Scene, readonly opts: PonyOptions) {
    super(scene, 0, 0)
    this.shadow = scene.add.ellipse(0, 0, 136, 16, 0x261608, .23)
    this.add(this.shadow)
    this.ring = scene.add.image(0, -2, 'fx.gold-ring').setDisplaySize(194, 48).setVisible(opts.isPlayer)
    this.add(this.ring)
    this.root = scene.add.container(0, 0)
    this.add(this.root)
    this.torso = scene.add.image(0, 0, ponyTextureKeys(opts.profile.horseId).idle, 0)
      .setOrigin(.5, 180 / FRAME_H).setScale(opts.profile.horseId === 0 ? .85 : PONY_SCALE)
    this.root.add(this.torso)
    scene.add.existing(this)
  }

  setCoat(color: number | null): void {
    if (this.coat === color) return
    this.coat = color
    if (color === null) this.torso.clearTint()
    else this.torso.setTint(color)
  }

  tickAnim(dtMs: number, speedRatio: number, airborne: boolean, stopped: boolean): void {
    const action = stopped ? 'idle' : 'running'
    this.phase += dtMs * (stopped ? .005 : .005 + speedRatio * .017)
    if (action !== this.action) {
      this.action = action
      this.torso.setTexture(ponyTextureKeys(this.opts.profile.horseId)[action])
    }
    this.torso.setFrame(Math.floor(this.phase / (Math.PI * 2) * FRAME_COUNT) % FRAME_COUNT)
    const targetLift = airborne ? -46 : 0
    this.root.y += (targetLift - this.root.y) * Math.min(1, dtMs / 90)
    this.shadow.setScale(airborne ? .62 : 1)
    this.shadow.setAlpha(airborne ? .14 : .23)
  }

  setGhost(on: boolean): void { this.root.setAlpha(on ? .42 : 1) }
}
