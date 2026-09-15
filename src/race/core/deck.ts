/**
 * 发牌派生。整副牌堆是整场比赛里唯一由 seed 固定的东西。
 *
 *   deck[12], deck[13] ← 从「强效果」(rare) 子集中无放回取 2 张   // 保底
 *   deck[0..11]        ← 从剩余全部卡中无放回取 12 张
 *   全部取牌用 H(seed, "card", 位置) 定序，位置按上面两步的顺序编号
 *
 * 抽取顺序是派生式的一部分：无放回意味着第 k 张取决于前 k−1 张抽走了谁。
 */
import { CARD_POOL, CARD_BY_ID } from '../cards/pool.ts'
import { CPU_DECK_SIZE, DECK_RARE_TAIL, DECK_SIZE } from './constants.ts'
import { H } from './rng.ts'

/** 卡池的规范顺序：cardId 升序。换顺序即换发牌规则，要跟着升 rulesVersion */
function canonicalPool(): string[] {
  return CARD_POOL.map((c) => c.cardId).sort()
}

function drawWithoutReplacement(
  remaining: string[],
  seed: string,
  domain: string,
  position: number,
  extra: number[] = [],
): string {
  const idx = H(seed, domain, ...extra, position) % remaining.length
  const [picked] = remaining.splice(idx, 1)
  return picked!
}

/** 派生玩家的 14 张有序牌堆 */
export function deriveDeck(seed: string): string[] {
  const all = canonicalPool()
  const rare = all.filter((id) => CARD_BY_ID[id]!.quality === 'rare')
  const deck: string[] = new Array(DECK_SIZE)

  // 第一步：末两张保底从 rare 子集取
  const rareRemaining = [...rare]
  for (let k = 0; k < DECK_RARE_TAIL; k++) {
    deck[DECK_SIZE - DECK_RARE_TAIL + k] = drawWithoutReplacement(rareRemaining, seed, 'card', k)
  }

  // 第二步：前十二张从剩余全部卡取（保底两张已被拿走）
  const taken = new Set(deck.slice(DECK_SIZE - DECK_RARE_TAIL))
  const restRemaining = all.filter((id) => !taken.has(id))
  for (let k = 0; k < DECK_SIZE - DECK_RARE_TAIL; k++) {
    deck[k] = drawWithoutReplacement(restRemaining, seed, 'card', DECK_RARE_TAIL + k)
  }

  return deck
}

/** 每匹电脑马的 3 张私有牌堆，从 cpuUsable 子集无放回派生 */
export function deriveCpuDeck(seed: string, horseId: number): string[] {
  const usable = CARD_POOL.filter((c) => c.cpuUsable)
    .map((c) => c.cardId)
    .sort()
  const remaining = [...usable]
  const deck: string[] = []
  for (let k = 0; k < CPU_DECK_SIZE; k++) {
    deck.push(drawWithoutReplacement(remaining, seed, 'cpudeck', k, [horseId]))
  }
  return deck
}

/** 静态断言：总卡池 ≥ 14、强效果子集 ≥ 2。这是对所有 seed 都成立的事实，不靠遍历 */
export function assertPoolViable(): void {
  const all = canonicalPool()
  const rare = all.filter((id) => CARD_BY_ID[id]!.quality === 'rare')
  if (all.length < DECK_SIZE) {
    throw new Error(`卡池不足：需要 ≥ ${DECK_SIZE} 张，实际 ${all.length}`)
  }
  if (rare.length < DECK_RARE_TAIL) {
    throw new Error(`强效果子集不足：需要 ≥ ${DECK_RARE_TAIL} 张，实际 ${rare.length}`)
  }
}
