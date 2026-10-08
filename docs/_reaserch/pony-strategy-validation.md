# 小马初始能力与选阵容的策略验证

## 探索原因

角色能力必须能改变选牌偏好；玩家还可通过选马队列挑选四名对手与赛道排列。只用一份固定五马名单测试，会漏掉阵容选择对胜负的影响。需要把定向因果场景、真实派生候选和阵容遍历分开记录。

## 探索目标

验证稀有优先、同类/异类构筑、牛来补给取舍、装备时长与剩余路程、主动放弃与超时；遍历每个玩家角色的所有对手组合和赛道排列。记录实际获得、能力日志与覆盖、体力净收支、五马完赛、原始/结算名次及无卡、无偏好牌、死亡、临近冲线分类。

## 探索结果

### 方法与覆盖

当前规则哈希为 `0x4a4e90bccef7cf8b0b7d35c97468135965be84c21e48619d230f551a6fa4e4ed`。卡牌取规范表，玩家基线取playerBalance.ts；不为统计样本改参。定向场景必须通过生产求时器与真实选择路径，分别验证稀有、主功能、装备时长、即时补给、主动放弃和超时的区别。

统计逐行保留真实派生seed/锚、名单、候选、合法刷新、获得卡牌、效果覆盖、体力净变化、五马用时、排序及digest。毛发历史数量、死亡保留效果、逐件翻新加速与来劲力竭拦截均按现行定义计算。校准与留出seed分离，不把固定定向牌面混入随机胜率。

//TODO - 使用下节命令重新生成当前规则的校准/留出完整名单样本；逐行核验derivePaidCoreInput与体力对账，汇总前确认规则哈希一致。未完成复算前不提供当前规则胜率、最佳名单返还或gas统计。

## 复现说明

在项目根目录运行：

```bash
bun --no-env-file test tests/api/ts/pony-strategy.test.ts
bun --no-env-file scripts/analyze-pony-strategies.ts --phase calibration --seeds 2 --policy finish --out .cache/pony-build/strategy-calibration-full
bun --no-env-file scripts/analyze-pony-strategies.ts --phase holdout --seeds 2 --policy finish --out .cache/pony-build/strategy-holdout-full
```

原始输入、实际候选/获得、五马时间、能力/体力记录与digest写入各输出目录的jsonl，汇总写入summary.json。所有统计使用生成时的规则哈希，旧文件不能作为当前数值的证据。

## 注意事项与补充

302400份名单来自四个独立开场种子，名单覆盖数量不等于独立随机样本量；完整遍历也不证明所有随机锚、策略和档位的稳定胜率。当前研究不执行部署，不将本地规则测试视为链上真实会话证据。卡牌、玩家和pony基础数值的计算统一见[数值规划](../plan/numerical-balance.md)。

### 核验核心代码与思路

临时核验程序已删除；可复用的派生、枚举、选择与记录逻辑保留在 [analyze-pony-strategies.ts](../../scripts/analyze-pony-strategies.ts) 和 [pony-strategy-policy.ts](../../scripts/pony-strategy-policy.ts)。逐行核验的核心是：

```ts
// 每个 phase/seed/pony 使用 8400 位记录 ordinal，重复或缺项均失败。
import assert from 'node:assert/strict'
const json = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x)
assert.deepEqual(roster, [...ponyStrategyRosters(pony)][ordinal].roster)
assert.equal(playerHorseId, roster.indexOf(pony))
// seed/锚按 phase 域重新生成；属性与两个牌组必须逐字段匹配派生。
const expected = derivePaidCoreInput({ seed, openAnchor, stakeTier, playerHorseId, roster, choices: [null, null, null] })
assert.equal(json(input.profiles), json(expected.profiles))
assert.deepEqual(input.playerDeck, expected.playerDeck)
assert.deepEqual(input.cpuDecks, expected.cpuDecks)
// 核验五名参赛者；净变化来自真实 trace，不以标称恢复量代替。
assert.equal(initial + continuousGain - continuousLoss + eventGain - eventLoss, final) // 五项均为 BigInt
```
