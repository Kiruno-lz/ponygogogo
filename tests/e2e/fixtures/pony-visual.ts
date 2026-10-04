import Phaser from 'phaser'
import { fetchManifest } from '../../../src/assets/source.ts'
import { EFFECT_TEXTURES, HEAD_COSMETIC_TEXTURES } from '../../../src/game/effects.ts'
import { ponyById } from '../../../src/game/ponyCatalog.ts'
import { PonySprite, ponyTextureKeys } from '../../../src/game/pony.ts'

const manifest = await fetchManifest()
class VisualScene extends Phaser.Scene {
  preload() {
    const keys = ponyTextureKeys(8)
    for (const action of ['idle','running'] as const) this.load.spritesheet(keys[action], `/assets/art/ponies/8-${action}.webp`, { frameWidth: 256, frameHeight: 192 })
    for (const spec of Object.values(EFFECT_TEXTURES)) this.load.spritesheet(spec.textureKey, '/' + manifest[spec.assetKey]!.path, { frameWidth: spec.frameWidth, frameHeight: spec.frameHeight })
    for (const spec of Object.values(HEAD_COSMETIC_TEXTURES)) this.load.image(spec.textureKey, '/' + manifest[spec.assetKey]!.path)
  }
  create() {
    const pony = new PonySprite(this, { profile: ponyById(8) }).setPosition(300,450).setScale(2)
    pony.setEquipment(['fireWheel','rocket','rainbowTrail'],0)
    const snapshot = () => {
      const root = pony.list.find(child => child instanceof Phaser.GameObjects.Container) as Phaser.GameObjects.Container
      const torso = root.list.find(child => child instanceof Phaser.GameObjects.Image && child.texture.key.startsWith('pony_')) as Phaser.GameObjects.Image
      const accessory = root.list.find(child => child instanceof Phaser.GameObjects.Image && child.texture.key.startsWith('fx.head.')) as Phaser.GameObjects.Image
      return { feet: pony.equipmentWorldPoints('fireWheel'), rocket: pony.equipmentWorldPoints('rocket'), tail: pony.equipmentWorldPoints('rainbowTrail'),
        frame: torso.frame.name, texture: torso.texture.key, width: torso.displayWidth, height: torso.displayHeight,
        alpha: root.alpha, headVisible: accessory.visible }
    }
    Object.assign(window, { ponyVisual: { snapshot, run: () => pony.tickAnim(70,1,false,false), fly: () => pony.tickAnim(90,1,true,false),
      spin: () => pony.setSpinVisual(true,325,false), ghost: () => pony.setGhost(true), head: () => pony.setHeadCosmetic('blonde') } })
  }
}
new Phaser.Game({ type: Phaser.CANVAS, parent: 'game', width: 600, height: 650, backgroundColor: '#c4dec3', scene: VisualScene,
  render: { antialias: true }, audio: { noAudio: true } })
