/**
 * Demo 卡池：21 张（C-01 … C-21），rare 12 张。
 * 数值取自 docs/card-design.md §8.2 的原始设定，此处只做量纲落地，不做强弱判断。
 * 加一张卡的正常路径是往本文件加一条记录，不改 src/race/core/ 一行。
 */
import { fx } from '../core/fixed.ts'
import { paidCardRule } from '../paid/cardRules.ts'
import type { CardDef } from './types.ts'

const S = 50 // 1 秒 = 50 tick
const GRAVITY_STRENGTH = paidCardRule(10).strengthBps!

export const CARD_POOL: CardDef[] = [
  {
    cardId: 'C-01',
    quality: 'common',
    name: { zh: '中国马能飞', en: 'Chinese Horses Can Fly' },
    desc: {
      zh: '立即【起飞】并加速 20%，持续 30 秒。飞在天上的马踩不到地面的炸弹。',
      en: 'Gain Airborne and +20% speed for 30s. Airborne horses ignore ground hazards.',
    },
    meme: '网络梗「中国 X 能飞」',
    art: { icon: 'icon_16' },
    cpuUsable: true,
    modules: ['mod.airborne', 'mod.speed'],
    effects: [
      {
        primitive: 'Status',
        moduleId: 'mod.airborne',
        durationTicks: 30 * S,
        tags: ['buff'],
        payload: { statusId: 'airborne' },
      },
      {
        primitive: 'Modifier',
        moduleId: 'mod.speed',
        durationTicks: 30 * S,
        tags: ['buff'],
        payload: { modifiers: [{ target: 'speed', op: 'padd', pool: 'b1', value: fx(0.2) }] },
      },
    ],
  },
  {
    cardId: 'C-02',
    quality: 'rare',
    name: { zh: '旋转突进的蓝色小马', en: 'Spinning Blue Pony' },
    desc: {
      zh: '加速 30% 并获得【运气 E】，持续 30 秒。30 秒到期时必定【死亡】一次。',
      en: '+30% speed and Luck E for 30s. On expiry you are guaranteed to die once.',
    },
    meme: '蓝色枪兵的旋转冲刺 / lancer 又死了',
    art: { icon: 'icon_07' },
    cpuUsable: true,
    modules: ['mod.speed', 'mod.death', 'mod.trail', 'mod.trigger'],
    effects: [
      {
        primitive: 'Modifier',
        moduleId: 'mod.speed',
        durationTicks: 30 * S,
        tags: ['buff'],
        payload: { modifiers: [{ target: 'speed', op: 'padd', pool: 'b1', value: fx(0.3) }] },
      },
      {
        primitive: 'Status',
        moduleId: 'mod.trail',
        durationTicks: 30 * S,
        tags: ['buff'],
        payload: { statusId: 'luckE', spin: true },
      },
      {
        primitive: 'Trigger',
        moduleId: 'mod.trigger',
        durationTicks: 30 * S,
        tags: ['debuff'],
        payload: { trigger: { kind: 'onExpire', action: 'death' } },
      },
    ],
  },
  {
    cardId: 'C-03',
    quality: 'rare',
    name: { zh: '最后的波纹', en: 'The Last Ripple' },
    desc: {
      zh: '加速 40%，持续 20 秒。代价：后续检查点不再发牌，本场再也拿不到卡。',
      en: '+40% speed for 20s. Cost: no more cards for the rest of the race.',
    },
    meme: 'JOJO 的波纹',
    art: { icon: 'icon_12' },
    cpuUsable: false,
    modules: ['mod.speed', 'mod.draw'],
    effects: [
      {
        primitive: 'Modifier',
        moduleId: 'mod.speed',
        durationTicks: 20 * S,
        tags: ['buff'],
        payload: { modifiers: [{ target: 'speed', op: 'padd', pool: 'b1', value: fx(0.4) }] },
      },
      {
        primitive: 'DrawRule',
        moduleId: 'mod.draw',
        durationTicks: null,
        tags: ['buff'],
        payload: { drawRule: 'cut' },
      },
    ],
  },
  {
    cardId: 'C-04',
    quality: 'rare',
    name: { zh: '选择困难综合症', en: 'Decision Paralysis' },
    desc: {
      zh: '后续检查点由系统替你随机选牌，也不能刷新。补偿：之后每张卡额外 +20% 加速。',
      en: 'Later checkpoints auto-pick for you and refresh is lost. In exchange every later card carries +20% extra speed.',
    },
    meme: '通用网络梗',
    art: { icon: 'icon_13' },
    cpuUsable: false,
    modules: ['mod.draw', 'mod.speed'],
    effects: [
      {
        primitive: 'DrawRule',
        moduleId: 'mod.draw',
        durationTicks: null,
        tags: ['buff'],
        payload: { drawRule: 'auto', bonusPct: fx(0.2) },
      },
    ],
  },
  {
    cardId: 'C-05',
    quality: 'rare',
    name: { zh: '海贼王的宝藏', en: "Pirate King's Treasure" },
    desc: {
      zh: '获得 1 次【刷新】：后续任一检查点可点掉展示中的一张，由牌堆下一张顶替。额度可累计。',
      en: 'Gain 1 Refresh: at any later checkpoint, discard one shown card and draw the next from the deck. Credits stack.',
    },
    meme: 'One Piece',
    art: { icon: 'icon_18' },
    cpuUsable: false,
    modules: ['mod.draw'],
    effects: [
      {
        primitive: 'DrawRule',
        moduleId: 'mod.draw',
        durationTicks: null,
        tags: ['buff'],
        payload: { drawRule: 'refresh', credits: 1 },
      },
    ],
  },
  {
    cardId: 'C-06',
    quality: 'rare',
    name: { zh: '炸弹来咯', en: 'Bombs Away' },
    desc: {
      zh: '在其他四条赛道的当前位置各放一枚炸弹，踩到的马【死亡】。炸弹是中立的，换道后也可能炸到自己。',
      en: 'Drop a bomb on each of the other four lanes at your current position. Anyone who crosses it dies — including you, if you swap lanes.',
    },
    meme: '炸弹人',
    art: { icon: 'icon_08' },
    cpuUsable: true,
    modules: ['mod.hazard', 'mod.death'],
    effects: [
      {
        primitive: 'Hazard',
        moduleId: 'mod.hazard',
        durationTicks: null,
        tags: ['buff'],
        payload: { hazardKind: 'bomb' },
      },
    ],
  },
  {
    cardId: 'C-07',
    quality: 'common',
    name: { zh: '火箭喷射器', en: 'Rocket Booster' },
    desc: {
      zh: '躯干装上火箭喷射器 40 秒：加速 15%，体力消耗减半。',
      en: 'Mount a rocket booster on the torso for 40s: +15% speed and half stamina cost.',
    },
    meme: '通用',
    art: { icon: 'icon_02' },
    cpuUsable: true,
    modules: ['mod.equipment', 'mod.speed', 'mod.stamina'],
    effects: [
      {
        primitive: 'Equipment',
        moduleId: 'mod.equipment',
        durationTicks: 40 * S,
        tags: ['equipment', 'buff'],
        payload: {
          slot: 'torso',
          equipId: 'rocket',
          modifiers: [
            { target: 'speed', op: 'padd', pool: 'b1', value: fx(0.15) },
            { target: 'staminaCost', op: 'mul', value: fx(0.5) },
          ],
        },
      },
    ],
  },
  {
    cardId: 'C-08',
    quality: 'common',
    name: { zh: '彩虹猫', en: 'Nyan Cat' },
    desc: { zh: '尾巴喷出像素彩虹 60 秒：加速 10%。', en: 'A pixel rainbow trail for 60s: +10% speed.' },
    meme: 'Nyan Cat',
    art: { icon: 'icon_10' },
    cpuUsable: true,
    modules: ['mod.equipment', 'mod.speed', 'mod.trail'],
    effects: [
      {
        primitive: 'Equipment',
        moduleId: 'mod.equipment',
        durationTicks: 60 * S,
        tags: ['equipment', 'buff'],
        payload: {
          slot: 'tail',
          equipId: 'rainbowTrail',
          modifiers: [{ target: 'speed', op: 'padd', pool: 'b1', value: fx(0.1) }],
        },
      },
    ],
  },
  {
    cardId: 'C-09',
    quality: 'rare',
    name: { zh: '不义游戏', en: 'Boogie Woogie' },
    desc: {
      zh: 'gogo 变成【拍手交换】30 秒：点一下与相邻赛道的马随机换位，2 秒冷却。占用期间节奏锁定在半速。',
      en: 'For 30s gogo becomes Clap Swap: swap places with a random adjacent-lane horse, 2s cooldown. While bound, your rhythm is locked at half.',
    },
    meme: '咒术回战 东堂葵',
    art: { icon: 'icon_11' },
    cpuUsable: false,
    modules: ['mod.ability-bind', 'mod.swap'],
    effects: [
      {
        primitive: 'Ability',
        moduleId: 'mod.ability-bind',
        durationTicks: 30 * S,
        tags: ['buff'],
        payload: { abilityId: 'clapSwap' },
      },
    ],
    stack: 'replace',
  },
  {
    cardId: 'C-10',
    quality: 'rare',
    name: { zh: '重力井', en: 'Gravity Well' },
    desc: {
      zh: `躯干挂上史瓦西黑洞 10 秒：前方的马按距离减速，最高 ${GRAVITY_STRENGTH / 100}%；后方的马同样被加速——追兵会被拉近。`,
      en: `A Schwarzschild black hole on your torso for 10s: horses ahead slow down by up to ${GRAVITY_STRENGTH / 100}%, horses behind speed up by the same amount.`,
    },
    meme: '史瓦西黑洞',
    art: { icon: 'icon_03' },
    cpuUsable: true,
    modules: ['mod.equipment', 'mod.field'],
    effects: [
      {
        primitive: 'Equipment',
        moduleId: 'mod.equipment',
        durationTicks: 10 * S,
        tags: ['equipment', 'buff'],
        payload: { slot: 'torso', equipId: 'blackhole' },
      },
      {
        primitive: 'Field',
        moduleId: 'mod.field',
        durationTicks: 10 * S,
        tags: ['buff'],
        payload: { fieldKind: 'gravityWell', radius: 8000 * 10000, strength: GRAVITY_STRENGTH },
      },
    ],
  },
  {
    cardId: 'C-11',
    quality: 'rare',
    name: { zh: '风火轮', en: 'Wind Fire Wheels' },
    desc: {
      zh: '四蹄装上风火轮 30 秒：gogo 变成长按，按住时【起飞】+ 加速 40%，每秒叠 1 层【火焰】；7 层【死亡】。松开全失。',
      en: 'Wind Fire Wheels on all four hooves for 30s: hold gogo to gain Airborne and +40% speed while stacking 1 Burning per second; 7 stacks kills you. Release and it all goes.',
    },
    meme: '哪吒',
    art: { icon: 'icon_15' },
    cpuUsable: false,
    modules: ['mod.equipment', 'mod.ability-bind', 'mod.airborne', 'mod.stack', 'mod.death'],
    effects: [
      {
        primitive: 'Equipment',
        moduleId: 'mod.equipment',
        durationTicks: 30 * S,
        tags: ['equipment', 'buff'],
        payload: { slot: 'hoof_fl', equipId: 'fireWheel', multiSlot: ['hoof_fl', 'hoof_fr', 'hoof_bl', 'hoof_br'] },
      },
      {
        primitive: 'Ability',
        moduleId: 'mod.ability-bind',
        durationTicks: 30 * S,
        tags: ['buff'],
        payload: { abilityId: 'wheelHold' },
      },
    ],
    stack: 'replace',
  },
  {
    cardId: 'C-12',
    quality: 'common',
    name: { zh: '起风了', en: 'The Wind Rises' },
    desc: {
      zh: '刮起一阵随机方向的风，只吹得动【起飞】的马：顺风 +10%，逆风 −10%。玩家与电脑马一视同仁。',
      en: 'A wind of random direction. It only touches Airborne horses: +10% with it, −10% against it — everyone alike.',
    },
    meme: '天气预报 /「起风了」',
    art: { icon: 'icon_09' },
    cpuUsable: true,
    modules: ['mod.env', 'mod.speed'],
    stack: 'replace',
    effects: [
      {
        primitive: 'Environment',
        moduleId: 'mod.env',
        durationTicks: null,
        tags: ['env'],
        payload: { envKind: 'wind', strength: fx(0.1) },
      },
    ],
  },
  {
    cardId: 'C-13',
    quality: 'rare',
    name: { zh: '顺手牵羊', en: 'Sticky Fingers' },
    desc: {
      zh: '从场上其他马身上随机偷一件装备装到自己身上，时长刷新为完整时长。场上没装备时这张牌什么也不做。',
      en: 'Steal one random piece of equipment from another horse, its duration refreshed. If nobody is wearing anything, this card does nothing.',
    },
    meme: '成语的字面直用',
    art: { icon: 'icon_06' },
    cpuUsable: true,
    modules: ['mod.steal', 'mod.equipment'],
    stack: 'refresh',
    effects: [
      {
        primitive: 'Equipment',
        moduleId: 'mod.steal',
        durationTicks: null,
        tags: ['buff'],
        payload: { steal: true },
      },
    ],
  },
  {
    cardId: 'C-14',
    quality: 'common',
    name: { zh: '望梅止渴', en: 'Quench Thirst by Watching Plums' },
    desc: { zh: '体力恢复速度 +100%，持续 5 秒。', en: 'Stamina regeneration +100% for 5s.' },
    meme: '成语的字面直用',
    art: { icon: 'icon_14' },
    cpuUsable: true,
    modules: ['mod.stamina'],
    effects: [
      {
        primitive: 'Modifier',
        moduleId: 'mod.stamina',
        durationTicks: 5 * S,
        tags: ['buff'],
        payload: { modifiers: [{ target: 'staminaRegen', op: 'padd', pool: 'b1', value: fx(1) }] },
      },
    ],
  },
  {
    cardId: 'C-15',
    quality: 'common',
    name: { zh: '肾上腺素', en: 'Adrenaline' },
    desc: {
      zh: '立即恢复 200 点体力，可以暂时超过上限。超出的部分只能被消耗掉。',
      en: 'Restore 200 stamina immediately — it may exceed the cap. The excess can only be spent, never topped up.',
    },
    meme: '通用',
    art: { icon: 'icon_04' },
    cpuUsable: true,
    modules: ['mod.stamina'],
    effects: [
      {
        primitive: 'Modifier',
        moduleId: 'mod.stamina',
        durationTicks: 0,
        tags: ['buff'],
        payload: { instantStamina: fx(200) },
      },
    ],
  },
  {
    cardId: 'C-16',
    quality: 'rare',
    name: { zh: '咖啡因过量', en: 'Caffeine Overdose' },
    desc: {
      zh: '获得【亢奋】10 秒：体力见底也不再减速、按钮也不锁。疯狂地 gogo 吧。',
      en: 'Wired for 10s: hitting zero stamina no longer slows you down and never locks the button. Mash gogo.',
    },
    meme: '熬夜 / 美式续命',
    art: { icon: 'icon_05' },
    cpuUsable: true,
    modules: ['mod.stamina', 'mod.suppress'],
    effects: [
      {
        primitive: 'Status',
        moduleId: 'mod.suppress',
        durationTicks: 10 * S,
        tags: ['buff'],
        payload: { statusId: 'wired', suppressTag: 'system' },
      },
    ],
  },
  {
    cardId: 'C-17',
    quality: 'common',
    name: { zh: '薄肌', en: 'Lean Muscle' },
    desc: { zh: '速度 +10，永久。起步时最有用，全速时几乎感觉不到。', en: 'Speed +10, permanent. Worth the most off the line, almost nothing at top speed.' },
    meme: '网络梗「薄肌」',
    art: { icon: 'icon_01' },
    cpuUsable: true,
    modules: ['mod.speed'],
    effects: [
      {
        primitive: 'Modifier',
        moduleId: 'mod.speed',
        durationTicks: null,
        tags: ['buff'],
        payload: { modifiers: [{ target: 'speed', op: 'add', value: fx(10) }] },
      },
    ],
  },
  {
    cardId: 'C-18',
    quality: 'rare',
    name: { zh: '薄肌 pro max ultra', en: 'Lean Muscle Pro Max Ultra' },
    desc: { zh: '速度 +20，永久。', en: 'Speed +20, permanent.' },
    meme: '「薄肌」叠加厂商命名梗',
    art: { icon: 'icon_01' },
    cpuUsable: true,
    modules: ['mod.speed'],
    effects: [
      {
        primitive: 'Modifier',
        moduleId: 'mod.speed',
        durationTicks: null,
        tags: ['buff'],
        payload: { modifiers: [{ target: 'speed', op: 'add', value: fx(20) }] },
      },
    ],
  },
  {
    cardId: 'C-19',
    quality: 'common',
    name: { zh: '黄毛', en: 'Blonde' },
    desc: { zh: '头顶戴上一撮金色尖发。好像没有什么用…？但是酷酷的！', en: 'A tuft of golden spikes on your head. Seems useless…? But it looks cool!' },
    meme: '通用',
    art: { icon: 'icon_19', tint: 45 },
    cpuUsable: false,
    modules: ['mod.cosmetic'],
    effects: [
      {
        primitive: 'Status',
        moduleId: 'mod.cosmetic',
        durationTicks: null,
        tags: ['buff'],
        payload: { statusId: 'coat', coat: '#f4c542' },
      },
    ],
    stack: 'replace',
  },
  {
    cardId: 'C-20',
    quality: 'common',
    name: { zh: '我要把这玩意儿染成绿的', en: "I'm Dyeing This Thing Green" },
    desc: { zh: '头顶戴上一撮绿色尖发。好像没有什么用…？但是酷酷的！', en: 'A tuft of green spikes on your head. Seems useless…? But it looks cool!' },
    meme: '通用',
    art: { icon: 'icon_19', tint: 110 },
    cpuUsable: false,
    modules: ['mod.cosmetic'],
    effects: [
      {
        primitive: 'Status',
        moduleId: 'mod.cosmetic',
        durationTicks: null,
        tags: ['buff'],
        payload: { statusId: 'coat', coat: '#63b34a' },
      },
    ],
    stack: 'replace',
  },
  {
    cardId: 'C-21',
    quality: 'rare',
    name: { zh: '理解孙学', en: 'Enlightened' },
    desc: {
      zh: '再也看不见场上其他的小马，速度 +10。看不见的马不会和你换位、炸不到你、天气也吹不到你。',
      en: 'You can no longer see the other ponies, +10 speed. What you cannot see cannot swap with you, bomb you, or blow you around.',
    },
    meme: '网络梗「孙学」',
    art: { icon: 'icon_17' },
    cpuUsable: false,
    modules: ['mod.cosmetic', 'mod.speed'],
    effects: [
      {
        primitive: 'Status',
        moduleId: 'mod.cosmetic',
        durationTicks: null,
        tags: ['buff'],
        payload: { statusId: 'blindedPro' },
      },
      {
        primitive: 'Modifier',
        moduleId: 'mod.speed',
        durationTicks: null,
        tags: ['buff'],
        payload: { modifiers: [{ target: 'speed', op: 'add', value: fx(10) }] },
      },
    ],
  },
]

export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(
  CARD_POOL.map((c) => [c.cardId, c]),
)

/** 强效果子集 === rare 品质的卡集合 */
export const RARE_POOL = CARD_POOL.filter((c) => c.quality === 'rare')
export const CPU_POOL = CARD_POOL.filter((c) => c.cpuUsable)

/** 【版本答案】的构件 */
export const COMBO_PARTS = {
  all: ['C-19', 'C-21'],
  anyOf: [['C-17'], ['C-18']],
}
