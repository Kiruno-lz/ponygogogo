/**
 * 赛道场景。渲染层订阅规则状态，规则层不知道渲染层存在。
 * 构图对齐 art-src/renders/race_gaming.png：分层视差背景 + 五条泥土赛道 + 只沿横轴跟随的镜头。
 */
import Phaser from 'phaser'
import { TRACK_LEN } from '../race/core/constants.ts'
import { FP } from '../race/core/fixed.ts'
import type { RaceScreenDriver } from '../race/raceView.ts'
import type { RaceEvent } from '../race/core/types.ts'
import { normalizeRoster, ponyById } from './ponyCatalog.ts'
import {
  BG_SCALE,
  DESIGN_H,
  DESIGN_W,
  PALETTE,
  PARALLAX,
  PLAYER_ANCHOR_X,
  PLAYER_GOGO_MAX_X,
  PLAYER_START_X,
  START_LINE_X,
  PX_PER_UNIT,
  TRACK_BOTTOM,
  TRACK_TOP,
  laneGroundY,
} from './layout.ts'
import { PonySprite, registerPonyTextures, type PonyImages } from './pony.ts'
import { GogoCameraMotion } from './gogoCamera.ts'
import type { SceneImages } from './sceneArt.ts'
import {
  activeEquipmentVisuals,
  activeHeadCosmetic,
  activeWindDirection,
  EFFECT_TEXTURES,
  equipmentTransferPose,
  equipmentVisual,
  isSpinVisualActive,
  windVisualPose,
} from './effects.ts'

const TRACK_UNITS = TRACK_LEN / FP

export interface RaceSceneData {
  driver: RaceScreenDriver
  urls: Record<string, string>
  reducedMotion: boolean
  ponyImages: PonyImages
  sceneImages: SceneImages
  onReady?: (scene: RaceScene) => void
}

export class RaceScene extends Phaser.Scene {
  private driver!: RaceScreenDriver
  private reducedMotion = false
  private ponyImages: PonyImages = {}
  private sceneImages: SceneImages = {}
  private onReady?: (scene: RaceScene) => void
  private ponies: PonySprite[] = []
  private renderPos: number[] = []
  private far!: Phaser.GameObjects.TileSprite
  private front!: Phaser.GameObjects.TileSprite
  private lanes: Phaser.GameObjects.TileSprite[] = []
  private finishLine!: Phaser.GameObjects.Graphics
  private gate!: Phaser.GameObjects.Graphics
  private playerRing!: Phaser.GameObjects.Image
  private hazardIcons = new Map<number, Phaser.GameObjects.Container>()
  private transferringEquipments = new Map<string, number>()
  private transferSprites = new Set<Phaser.GameObjects.Image>()
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter
  private windSprites: Phaser.GameObjects.Image[] = []
  private camPos = 0
  private readonly gogoCamera = new GogoCameraMotion()
  private shakeUntil = 0

  constructor() {
    super('race')
  }

  init(data: RaceSceneData): void {
    this.driver = data.driver
    this.reducedMotion = data.reducedMotion
    this.ponyImages = data.ponyImages
    this.sceneImages = data.sceneImages
    this.onReady = data.onReady
  }

  create(): void {
    registerPonyTextures(this, this.ponyImages)
    for (const [key, image] of Object.entries(this.sceneImages)) {
      if (!this.textures.exists(key)) this.textures.addImage(key, image)
    }
    for (const spec of Object.values(EFFECT_TEXTURES)) {
      if (this.textures.exists(spec.textureKey)) this.textures.remove(spec.textureKey)
      this.textures.addSpriteSheet(spec.textureKey, this.sceneImages[spec.textureKey]!, {
        frameWidth: spec.frameWidth,
        frameHeight: spec.frameHeight,
      })
    }
    this.cameras.main.setBackgroundColor(PALETTE.sky)

    // 远景：天空 / 城堡 / 远山 / 松林 / 看台
    this.far = this.add
      .tileSprite(0, 0, DESIGN_W, 356, 'art.far')
      .setOrigin(0, 0)
      .setTileScale(BG_SCALE, BG_SCALE)

    // 赛道下缘到前景之间的草地，颜色压暗以贴近渲染图
    this.add
      .rectangle(0, TRACK_BOTTOM - 4, DESIGN_W, DESIGN_H - TRACK_BOTTOM + 4, 0x4b7c42)
      .setOrigin(0, 0)

    // 整条原画赛道共同滚动，完整保留五条不等距白线与泥土纹理。
    this.lanes.push(this.add
      .tileSprite(0, TRACK_TOP, DESIGN_W, TRACK_BOTTOM - TRACK_TOP, 'art.track')
      .setOrigin(0, 0))

    // 竖向起跑线独立于原画背景，跟随赛道距离滚动
    this.gate = this.add.graphics()
    this.gate.postFX.addBlur(0, 2, 2, 1, 0xffffff, 2)

    this.finishLine = this.add.graphics()

    // 尘土
    const dustTex = 'fx.dust'
    this.dust = this.add.particles(0, 0, dustTex, {
      speedX: { min: -140, max: -50 },
      speedY: { min: -34, max: 10 },
      scale: { start: 0.42, end: 0 },
      alpha: { start: 0.45, end: 0 },
      lifespan: 620,
      quantity: 0,
      frequency: -1,
    })
    this.dust.setDepth(5)

    this.playerRing = this.add.image(0, 0, 'fx.gold-ring')
      .setDisplaySize(194, 48)
      .setDepth(4)

    for (let i = 0; i < 3; i++) {
      const gust = this.add.image(0, 0, EFFECT_TEXTURES.wind.textureKey, 0)
        .setDisplaySize(330 - i * 35, 220 - i * 24)
        .setAlpha(0.50 - i * 0.06)
        .setDepth(8)
        .setVisible(false)
      this.windSprites.push(gust)
    }

    for (const ponyId of normalizeRoster(this.driver.state.roster)) {
      const p = ponyById(ponyId)
      const pony = new PonySprite(this, {
        profile: p,
      })
      this.ponies.push(pony)
      this.renderPos.push(0)
    }

    // 前景栅栏与观众
    this.front = this.add
      .tileSprite(0, 769, DESIGN_W, 202, 'art.front')
      .setOrigin(0, 0)
      .setTileScale(BG_SCALE, BG_SCALE)
      .setDepth(40)
    this.onReady?.(this)
  }

  handleEvents(events: RaceEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'gogo':
          if (!this.reducedMotion && this.driver.phase === 'racing'
            && !this.driver.state.pending && !this.driver.state.playerFinished) this.gogoCamera.press()
          break
        case 'explosion':
          this.spawnExplosion(ev.laneIndex, ev.pos / FP)
          this.shakeUntil = this.time.now + 260
          break
        case 'death':
          this.flashPony(ev.horseId, 0xff5555)
          break
        case 'swap':
          this.renderPos[ev.a] = this.driver.state.horses[ev.a]!.pos / FP
          this.renderPos[ev.b] = this.driver.state.horses[ev.b]!.pos / FP
          break
        case 'steal':
          this.playEquipmentTransfer(ev.from, ev.to, ev.equipId)
          break
        case 'checkpoint':
          if (ev.horseId === this.driver.state.playerHorseId) this.flashPony(ev.horseId, 0xffe08a)
          break
        case 'cardEffect':
          this.showCardFeedback(ev)
          break
        case 'finish':
          this.flashPony(ev.horseId, 0xfff3c4)
          break
        default:
          break
      }
    }
  }

  setReducedMotion(reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion
    if (!reducedMotion) return
    this.gogoCamera.reset()
    for (const sprite of this.transferSprites) {
      this.tweens.killTweensOf(sprite)
      sprite.destroy()
    }
    this.transferSprites.clear()
    this.transferringEquipments.clear()
  }

  private showCardFeedback(ev: Extract<RaceEvent, { type: 'cardEffect' }>): void {
    const pony = this.ponies[ev.horseId]
    if (!pony) return
    const labels = { trigger: '✦', resource: `${ev.value >= 0 ? '+' : ''}${Math.round(ev.value)}`, fixed: `${ev.value >= 0 ? '+' : ''}${ev.value}`, target: '➤', guard: '◇', renew: '↻', pony: ev.value ? `+${ev.value}%` : '✦' }
    const color = ev.kind === 'guard' ? '#e9c36b' : ev.kind === 'resource' && ev.value < 0 ? '#ed947d' : '#b5e4bf'
    const label = this.add.text(pony.x, pony.y - 155, labels[ev.kind], { fontFamily: 'sans-serif', fontSize: '28px', color, stroke: '#4a2a14', strokeThickness: 4 })
      .setOrigin(.5).setDepth(35)
    if (this.reducedMotion) { this.time.delayedCall(900, () => label.destroy()); return }
    this.tweens.add({ targets: label, y: label.y - 40, alpha: 0, duration: 1100, onComplete: () => label.destroy() })
  }

  private flashPony(horseId: number, color: number): void {
    if (this.reducedMotion) return
    const pony = this.ponies[horseId]
    if (!pony) return
    const ring = this.add.circle(pony.x, pony.y - 60, 30, color, 0.6).setDepth(30)
    this.tweens.add({
      targets: ring,
      radius: 96,
      alpha: 0,
      duration: 420,
      onComplete: () => ring.destroy(),
    })
  }

  private spawnExplosion(laneIndex: number, posUnits: number): void {
    const x = this.screenX(posUnits)
    const y = laneGroundY(laneIndex)
    const c = this.add.circle(x, y - 20, 18, 0xffb03a, 0.95).setDepth(32)
    this.tweens.add({
      targets: c,
      radius: 84,
      alpha: 0,
      duration: 360,
      onComplete: () => c.destroy(),
    })
    this.dust.emitParticleAt(x, y - 10, 18)
  }

  private screenX(posUnits: number): number {
    return (posUnits - this.camPos) * PX_PER_UNIT
  }

  update(_time: number, delta: number): void {
    const st = this.driver.state
    const player = st.horses[st.playerHorseId]!
    const blinded = st.effects.some(
      (e) => e.ownerHorseId === st.playerHorseId && e.payload.statusId === 'blindedPro',
    )

    // 插值只改变画面，不改变结果
    for (const h of st.horses) {
      const target = h.pos / FP
      const cur = this.renderPos[h.horseId]!
      const d = target - cur
      this.renderPos[h.horseId] = Math.abs(d) > 4000 ? target : cur + d * Math.min(1, delta / 24)
    }

    // 所有世界对象共用同一横向镜头；gogo 只改变玩家在屏幕中的构图。
    this.gogoCamera.update(delta)
    const anchorX = (PLAYER_ANCHOR_X
      + this.gogoCamera.offsetRatio * (PLAYER_GOGO_MAX_X - PLAYER_ANCHOR_X)) * DESIGN_W
    this.camPos = this.renderPos[player.horseId]! - anchorX / PX_PER_UNIT

    const scroll = this.camPos * PX_PER_UNIT
    this.far.tilePositionX = (scroll * PARALLAX.far) / BG_SCALE
    this.front.tilePositionX = (scroll * PARALLAX.front) / BG_SCALE
    for (const lane of this.lanes) lane.tilePositionX = scroll

    this.drawGate()

    this.drawFinishLine()
    this.syncHazards()
    this.syncWind()

    const shake = this.shakeUntil > this.time.now && !this.reducedMotion ? 5 : 0
    const jitter = shake ? (Math.random() - 0.5) * shake : 0

    for (const h of st.horses) {
      const pony = this.ponies[h.horseId]!
      pony.x = this.screenX(this.renderPos[h.horseId]!)
      pony.y = laneGroundY(h.laneIndex) + jitter
      pony.setDepth(14 - h.laneIndex)
      const hide = blinded && h.horseId !== st.playerHorseId
      pony.setVisible(!hide && pony.x > -260 && pony.x < DESIGN_W + 260)
      if (h.horseId === st.playerHorseId) this.playerRing.setPosition(pony.x, pony.y - 2).setVisible(pony.visible)

      const airborne = st.effects.some(
        (e) => e.ownerHorseId === h.horseId && e.payload.statusId === 'airborne',
      )
      const respawning = st.effects.some(
        (e) => e.ownerHorseId === h.horseId && e.payload.statusId === 'respawning',
      )
      pony.setHeadCosmetic(activeHeadCosmetic(st.effects, h.horseId))
      pony.setGhost(respawning && Math.floor(this.time.now / 110) % 2 === 0)
      const ratio = Math.min(1, h.v / FP / 45)
      pony.tickAnim(delta, ratio, airborne, h.v === 0)
      pony.setSpinVisual(isSpinVisualActive(st.effects, h.horseId), st.tick * 20, this.reducedMotion)
      pony.setEquipment(
        activeEquipmentVisuals(st.effects, h.horseId)
          .filter((visual) => !this.transferringEquipments.has(`${h.horseId}:${visual}`)),
        this.reducedMotion ? 0 : Math.floor(this.time.now / 70) % 16,
      )

      if (!h.finished && h.v > 0 && !airborne && pony.visible && Math.random() < ratio * 0.55) {
        this.dust.emitParticleAt(pony.x - 60, pony.y - 6, 1)
      }
    }
  }

  private syncWind(): void {
    const direction = activeWindDirection(this.driver.state.effects)
    for (let i = 0; i < this.windSprites.length; i++) {
      const gust = this.windSprites[i]!
      gust.setVisible(direction !== null)
      if (direction === null) continue
      const pose = windVisualPose(direction, this.driver.state.tick * 20, i, DESIGN_W, this.reducedMotion)
      gust.setFrame(pose.frame).setFlipX(pose.flipX).setPosition(pose.x, pose.y)
    }
  }

  private playEquipmentTransfer(fromHorseId: number, toHorseId: number, equipId: string): void {
    if (this.reducedMotion) return
    const visual = equipmentVisual(equipId)
    const fromPony = this.ponies[fromHorseId]
    const toPony = this.ponies[toHorseId]
    if (!visual || !fromPony || !toPony) return
    const from = fromPony.equipmentWorldPoints(equipId)
    const to = toPony.equipmentWorldPoints(equipId)
    if (from.length === 0 || from.length !== to.length) return

    const spec = EFFECT_TEXTURES[visual]
    const transferKey = `${toHorseId}:${visual}`
    this.transferringEquipments.set(transferKey, (this.transferringEquipments.get(transferKey) ?? 0) + from.length)
    const sizes: Record<typeof visual, [number, number]> = {
      rocket: [82, 55], rainbowTrail: [118, 79], blackhole: [72, 48], fireWheel: [34, 34],
    }
    for (let i = 0; i < from.length; i++) {
      const start = from[i]!
      const finish = to[i]!
      const sprite = this.add.image(start.x, start.y, spec.textureKey, Math.floor(this.time.now / 75) % spec.frameCount)
        .setDisplaySize(...sizes[visual])
        .setDepth(35)
      this.transferSprites.add(sprite)
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 460,
        onUpdate: (tween) => {
          const p = Number(tween.getValue())
          const pose = equipmentTransferPose(start, finish, p, false)
          sprite.setPosition(pose.x, pose.y)
        },
        onComplete: () => {
          this.transferSprites.delete(sprite)
          sprite.destroy()
          const remaining = (this.transferringEquipments.get(transferKey) ?? 1) - 1
          if (remaining <= 0) this.transferringEquipments.delete(transferKey)
          else this.transferringEquipments.set(transferKey, remaining)
        },
      })
    }
  }

  private drawGate(): void {
    const g = this.gate
    g.clear()
    const x = this.screenX(0) + START_LINE_X - PLAYER_START_X
    if (x < -260 || x > DESIGN_W + 260) return
    // 最新侧视稿只有竖向起跑线。
    g.fillStyle(0xfff5db, 0.72)
    g.fillRect(x - 10, TRACK_TOP, 20, TRACK_BOTTOM - TRACK_TOP)
  }

  private drawFinishLine(): void {
    const g = this.finishLine
    g.clear()
    const x = this.screenX(TRACK_UNITS)
    if (x < -60 || x > DESIGN_W + 60) return
    const cell = 18
    for (let row = 0; row * cell < TRACK_BOTTOM - TRACK_TOP; row++) {
      for (let col = 0; col < 2; col++) {
        const dark = (row + col) % 2 === 0
        g.fillStyle(dark ? 0x2a2320 : 0xfaf3e6, 0.95)
        g.fillRect(x + col * cell - cell, TRACK_TOP + row * cell, cell, cell)
      }
    }
    g.fillStyle(PALETTE.gold, 1)
    g.fillRect(x - cell - 6, TRACK_TOP - 26, 2 * cell + 12, 22)
  }

  private syncHazards(): void {
    const st = this.driver.state
    const live = new Set(st.hazards.map((h) => h.hazardId))
    for (const [id, obj] of [...this.hazardIcons]) {
      if (!live.has(id)) {
        obj.destroy()
        this.hazardIcons.delete(id)
      }
    }
    for (const hz of st.hazards) {
      let obj = this.hazardIcons.get(hz.hazardId)
      if (!obj) {
        obj = this.add.container(0, 0)
        const body = this.add.circle(0, 0, 15, 0x2c2c34, 1)
        body.setStrokeStyle(3, 0x15151a)
        const fuse = this.add.circle(9, -15, 4, 0xff9d3a, 1)
        obj.add([body, fuse])
        obj.setDepth(9)
        this.hazardIcons.set(hz.hazardId, obj)
      }
      obj.x = this.screenX(hz.pos / FP)
      obj.y = laneGroundY(hz.laneIndex) - 14
      obj.setVisible(obj.x > -50 && obj.x < DESIGN_W + 50)
      const pulse = 1 + Math.sin(this.time.now / 140) * 0.12
      obj.setScale(this.reducedMotion ? 1 : pulse)
    }
  }
}
