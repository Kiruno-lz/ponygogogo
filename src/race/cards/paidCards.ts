/**
 * 有奖场次的卡面：名称与美术沿用免费试玩卡池，**效果说明一律由 `paidCardRule` 生成**——有奖规则 v2 的
 * 数值（时长、百分比、固定值、体力、周期）只有 src/race/paid/cardRules.ts 一个来源，卡面不能写死 Demo 的旧数字。
 */
import { paidCardRule, type PaidCardRule } from '../paid/cardRules.ts'
import { PAID_CARD_POOL } from './paidPlaceholders.ts'
import type { CardDef } from './types.ts'

const BY_ID = new Map(PAID_CARD_POOL.map((c) => [c.cardId, c]))

const pct = (bps: number) => `${bps / 100}%`
const sec = (ms: number) => `${ms / 1000}`

function describe(rule: PaidCardRule): { zh: string; en: string } {
  const d = rule.durationMs ?? 0
  switch (rule.effect) {
    case 'airborneSpeed':
      return { zh: `获得【起飞】，速度 +${pct(rule.pBps!)}，持续 ${sec(d)} 秒。起飞的马不触发地面炸弹。`, en: `Airborne and +${pct(rule.pBps!)} speed for ${sec(d)}s. Airborne horses skip ground bombs.` }
    case 'speedDeath':
      return { zh: `速度 +${pct(rule.pBps!)}，持续 ${sec(d)} 秒；到期时【死亡】一次。`, en: `+${pct(rule.pBps!)} speed for ${sec(d)}s; you die once when it ends.` }
    case 'drawCut':
      return { zh: `速度 +${pct(rule.pBps!)}，持续 ${sec(d)} 秒。代价：此后的检查点不再发牌。`, en: `+${pct(rule.pBps!)} speed for ${sec(d)}s. Cost: no more cards at later checkpoints.` }
    case 'drawAuto':
      return { zh: `此后的检查点自动选牌、不能刷新；此后获得的每张卡额外 +${pct(rule.bonusBps!)} 速度。`, en: `Later checkpoints pick for you and cannot refresh; every later card adds +${pct(rule.bonusBps!)} speed.` }
    case 'refresh':
      return { zh: `刷新额度 +${rule.count}：之后的检查点可以换掉一张候选，由牌堆末端顶替。`, en: `+${rule.count} refresh: swap one offered card at a later checkpoint for one from the deck's end.` }
    case 'bomb':
      return { zh: '在其他四条赛道、你当前的位置各放一枚炸弹，踩到的马【死亡】。', en: 'Drops a bomb at your position in each of the other four lanes; a horse that runs over one dies.' }
    case 'rocket':
      return { zh: `躯干装备火箭喷射器 ${sec(d)} 秒：速度 +${pct(rule.pBps!)}，体力消耗减半。`, en: `Torso rocket for ${sec(d)}s: +${pct(rule.pBps!)} speed, half stamina cost.` }
    case 'rainbow':
      return { zh: `尾部装备彩虹拖尾 ${sec(d)} 秒：速度 +${pct(rule.pBps!)}。`, en: `Rainbow tail for ${sec(d)}s: +${pct(rule.pBps!)} speed.` }
    case 'swap':
      return { zh: `【拍手交换】${sec(d)} 秒：每 ${sec(rule.periodMs!)} 秒自动与另一条赛道的马交换位置，共 ${rule.count} 次。`, en: `Clap Swap for ${sec(d)}s: every ${sec(rule.periodMs!)}s trade places with a horse in another lane, ${rule.count} tries.` }
    case 'gravity':
      return { zh: `躯干装备史瓦西黑洞 ${sec(d)} 秒：${rule.radiusMicro! / 1e6} 单位内，前方的马减速、后方的马加速，最多 ${pct(rule.strengthBps!)}。`, en: `Torso black hole for ${sec(d)}s: within ${rule.radiusMicro! / 1e6} units, horses ahead slow and horses behind speed up, up to ${pct(rule.strengthBps!)}.` }
    case 'wheel':
      return { zh: `四蹄装备风火轮 ${sec(d)} 秒：【起飞】，每 ${sec(rule.periodMs!)} 秒速度 +${rule.fixedSpeed}，共 ${rule.count} 次。`, en: `Fire wheels for ${sec(d)}s: Airborne, +${rule.fixedSpeed} speed every ${sec(rule.periodMs!)}s, ${rule.count} times.` }
    case 'wind':
      return { zh: `刮起顺风或逆风（±${pct(rule.strengthBps!)}），只吹得动【起飞】的马，替换之前的风。`, en: `A tail or head wind (±${pct(rule.strengthBps!)}) that only moves Airborne horses; replaces any earlier wind.` }
    case 'steal':
      return { zh: '从其他未冲线的马身上随机偷一件装备装到自己身上，时长刷新；没有装备时无效。', en: 'Steal a random piece of equipment from a horse still racing, at full duration; nothing happens if none is worn.' }
    case 'regen':
      return { zh: `体力恢复 +${pct(rule.regenBonusBps!)}，持续 ${sec(d)} 秒。`, en: `Stamina regeneration +${pct(rule.regenBonusBps!)} for ${sec(d)}s.` }
    case 'adrenaline':
      return { zh: `体力 +${rule.staminaMicro! / 1e6}，可以超过上限。`, en: `+${rule.staminaMicro! / 1e6} stamina, may exceed the cap.` }
    case 'wired':
      return { zh: `【亢奋】${sec(d)} 秒：体力见底也不会力竭。`, en: `Wired for ${sec(d)}s: an empty stamina bar does not exhaust you.` }
    case 'fixed':
      return { zh: `速度固定 +${rule.fixedSpeed}，永久。`, en: `Speed +${rule.fixedSpeed}, permanent.` }
    case 'coat':
      return rule.id === 19
        ? { zh: '头顶戴上一撮金色尖发。酷酷的！', en: 'A tuft of golden spikes on your head. Looks cool!' }
        : { zh: '头顶戴上一撮绿色尖发。酷酷的！', en: 'A tuft of green spikes on your head. Looks cool!' }
    case 'blindFixed':
      return { zh: `速度固定 +${rule.fixedSpeed}；【目中无人】：他马的炸弹、风与交换对你无效。`, en: `Speed +${rule.fixedSpeed}; Blinded Pro: other horses' bombs, wind and swaps skip you.` }
    case 'none':
      return { zh: '没有效果。', en: 'No effect.' }
  }
}

const CACHE = new Map<string, CardDef>()

/** 有奖卡面：`C-01` … `C-26`；未知 id 返回 undefined。 */
export function paidCardDef(key: string): CardDef | undefined {
  const cached = CACHE.get(key)
  if (cached) return cached
  const base = BY_ID.get(key)
  const m = /^C-(\d{2})$/.exec(key)
  if (!base || !m) return undefined
  const rule = paidCardRule(Number(m[1]))
  const def: CardDef = { ...base, quality: rule.rare ? 'rare' : 'common', desc: describe(rule) }
  CACHE.set(key, def)
  return def
}
