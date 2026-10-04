/** 赛道美术对象：只订阅速度、停步、飞行和外观状态，分镜帧不参与规则。 */
import Phaser from 'phaser'
import type { HorseProfile } from './horses.ts'
import { ponyById } from './ponyCatalog.ts'
import { decodeImage } from './images.ts'
import {
  EFFECT_TEXTURES,
  HEAD_COSMETIC_TEXTURES,
  equipmentVisual,
  spriteAnchorOffset,
  spinVisualPose,
  spinThrustPose,
  verticalPivotOffset,
  type EquipmentVisual,
  type HeadCosmetic,
  type EffectPoint,
} from './effects.ts'

export const PONY_SCALE = 0.75
const FRAME_W = 256
const FRAME_H = 192
const FRAME_COUNT = 8

export function ponyTextureKeys(horseId: number): { running: string; idle: string } {
  return { running: `pony_running_${horseId}`, idle: `pony_idle_${horseId}` }
}
export type PonyImages = Record<string, HTMLImageElement>

export async function preparePonyImages(profiles: HorseProfile[], urls: Record<string,string> = {}): Promise<PonyImages> {
  const out: PonyImages = {}
  await Promise.all(profiles.flatMap(p => {
    const keys = ponyTextureKeys(p.horseId)
    return (['running', 'idle'] as const).map(action =>
      decodeImage(urls[`art.ponies.${p.horseId}-${action}`] ?? `/assets/art/ponies/${p.horseId}-${action}.webp`).then(img => { out[keys[action]] = img }))
  }))
  return out
}

export function registerPonyTextures(scene: Phaser.Scene, images: PonyImages): void {
  for (const [key, img] of Object.entries(images)) {
    if (!scene.textures.exists(key)) scene.textures.addSpriteSheet(key, img, { frameWidth: FRAME_W, frameHeight: FRAME_H })
  }
}

export interface PonyOptions { profile: HorseProfile }

export class PonySprite extends Phaser.GameObjects.Container {
  private readonly torso: Phaser.GameObjects.Image
  private readonly shadow: Phaser.GameObjects.Ellipse
  private readonly root: Phaser.GameObjects.Container
  private readonly rocket: Phaser.GameObjects.Image
  private readonly rainbowTrail: Phaser.GameObjects.Image
  private readonly blackhole: Phaser.GameObjects.Image
  private readonly fireWheels: Phaser.GameObjects.Image[]
  private readonly spinThrust: Phaser.GameObjects.Image
  private readonly headAccessory: Phaser.GameObjects.Image
  private phase = 0
  private liftY = 0
  private spinScaleY = 1
  private headCosmetic: HeadCosmetic | null = null
  private action: 'running' | 'idle' = 'idle'

  constructor(scene: Phaser.Scene, readonly opts: PonyOptions) {
    super(scene, 0, 0)
    const renderSpec = ponyById(opts.profile.horseId).renderSpec
    this.shadow = scene.add.ellipse(0, 0, renderSpec.shadowWidth, 16, 0x261608, .23)
    this.add(this.shadow)
    this.root = scene.add.container(0, 0)
    this.add(this.root)

    this.rainbowTrail = scene.add.image(0, 0, EFFECT_TEXTURES.rainbowTrail.textureKey, 0)
      .setOrigin(.99, .54).setDisplaySize(118, 79).setVisible(false)
    this.root.add(this.rainbowTrail)

    const wheelPositions = renderSpec.feet
    const rearWheelCount = Math.floor(wheelPositions.length / 2)
    this.fireWheels = wheelPositions.map(([x, y], i) => scene.add
      .image(x, y, EFFECT_TEXTURES.fireWheel.textureKey, i * 4)
      .setDisplaySize(i < rearWheelCount ? 34 : 40, i < rearWheelCount ? 34 : 40)
      .setAlpha(i < rearWheelCount ? .76 : .96)
      .setVisible(false))
    this.root.add(this.fireWheels.slice(0, rearWheelCount))

    this.torso = scene.add.image(0, 0, ponyTextureKeys(opts.profile.horseId).idle, 0)
      .setOrigin(.5, renderSpec.groundOrigin).setScale(renderSpec.scale)
    this.root.add(this.torso)

    const head = spriteAnchorOffset(this.torso.displayWidth, this.torso.displayHeight,
      this.torso.originX, this.torso.originY, ...renderSpec.head)
    this.headAccessory = scene.add.image(this.torso.x + head.x, this.torso.y + head.y,
      HEAD_COSMETIC_TEXTURES.blonde.textureKey).setVisible(false)
    this.root.add(this.headAccessory)

    this.root.add(this.fireWheels.slice(rearWheelCount))
    // 彩虹素材的右侧发射端贴合尾根；沿用马体根节点的升降与翻面。
    const tail = spriteAnchorOffset(
      this.torso.displayWidth, this.torso.displayHeight,
      this.torso.originX, this.torso.originY, ...renderSpec.tail,
    )
    this.rainbowTrail.setPosition(this.torso.x + tail.x, this.torso.y + tail.y)
    const belly = spriteAnchorOffset(
      this.torso.displayWidth,
      this.torso.displayHeight,
      this.torso.originX,
      this.torso.originY,
      ...renderSpec.belly,
    )
    this.rocket = scene.add.image(this.torso.x + belly.x, this.torso.y + belly.y, EFFECT_TEXTURES.rocket.textureKey, 0)
      .setDisplaySize(82, 55).setVisible(false)
    this.blackhole = scene.add.image(this.torso.x + belly.x, this.torso.y + belly.y, EFFECT_TEXTURES.blackhole.textureKey, 0)
      .setDisplaySize(72, 48).setVisible(false)
    this.root.add([this.rocket, this.blackhole])
    // 与马匹同一容器，跟随世界位置；置于翻面根节点外以保持突进方向。
    this.spinThrust = scene.add.image(0, 0, EFFECT_TEXTURES.spinThrust.textureKey, 0)
      .setAlpha(.55).setVisible(false)
    // 前景弧带通过 alpha 与马体融合，保留完整旋转而不硬切马体轮廓。
    this.add(this.spinThrust)
    scene.add.existing(this)
  }

  setHeadCosmetic(cosmetic: HeadCosmetic | null): void {
    if (this.headCosmetic === cosmetic) return
    this.headCosmetic = cosmetic
    this.headAccessory.setVisible(cosmetic !== null)
    if (cosmetic === null) return
    const spec = HEAD_COSMETIC_TEXTURES[cosmetic]
    const width = this.torso.displayWidth * .28
    this.headAccessory.setTexture(spec.textureKey).setOrigin(spec.originX, spec.originY)
      .setDisplaySize(width, width * this.headAccessory.height / this.headAccessory.width)
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
    this.liftY += (targetLift - this.liftY) * Math.min(1, dtMs / 90)
    this.updateRootTransform()
    this.shadow.setScale(airborne ? .62 : 1)
    this.shadow.setAlpha(airborne ? .14 : .23)
  }

  setGhost(on: boolean): void { this.root.setAlpha(on ? .42 : 1) }

  setEquipment(active: readonly EquipmentVisual[], frame: number): void {
    const equipped = new Set(active)
    this.rocket.setVisible(equipped.has('rocket')).setFrame(frame)
    this.rainbowTrail.setVisible(equipped.has('rainbowTrail')).setFrame(frame)
    this.blackhole.setVisible(equipped.has('blackhole')).setFrame(frame)
    const wheelsVisible = equipped.has('fireWheel')
    for (let i = 0; i < this.fireWheels.length; i++) {
      this.fireWheels[i]!.setVisible(wheelsVisible).setFrame((frame + i * 4) % 16)
    }
  }

  setSpinVisual(active: boolean, elapsedMs: number, reducedMotion: boolean): void {
    const pose = spinVisualPose(elapsedMs, reducedMotion)
    this.spinScaleY = active ? pose.scaleY * (pose.flipY ? -1 : 1) : 1
    this.updateRootTransform()
    const thrust = spinThrustPose(this.torso.displayWidth, this.torso.displayHeight,
      this.torso.originY, elapsedMs, reducedMotion)
    this.spinThrust.setVisible(active).setFrame(thrust.frame)
      .setPosition(this.torso.x + thrust.x, this.torso.y + thrust.y + this.liftY)
      .setDisplaySize(thrust.width, thrust.height)
  }

  private updateRootTransform(): void {
    const bodyCenterY = this.torso.y + (0.5 - this.torso.originY) * this.torso.displayHeight
    this.root.setScale(1, this.spinScaleY)
    this.root.y = this.liftY + verticalPivotOffset(bodyCenterY, this.spinScaleY)
  }

  equipmentWorldPoints(equipId: string): EffectPoint[] {
    const visual = equipmentVisual(equipId)
    if (!visual) return []
    const sprites = visual === 'fireWheel'
      ? this.fireWheels
      : [visual === 'rocket' ? this.rocket : visual === 'rainbowTrail' ? this.rainbowTrail : this.blackhole]
    return sprites.map((sprite) => {
      const point = sprite.getWorldTransformMatrix().transformPoint(0, 0)
      return { x: point.x, y: point.y }
    })
  }
}
