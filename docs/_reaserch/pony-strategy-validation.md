# 小马初始能力与选阵容的策略验证

## 探索原因

角色能力必须能改变选牌偏好；玩家还可通过选马队列挑选四名对手与赛道排列。只用一份固定五马名单测试，会漏掉阵容选择对胜负的影响。需要把定向因果场景、真实派生候选和阵容遍历分开记录。

## 探索目标

验证稀有优先、同类/异类构筑、牛来补给取舍、装备时长与剩余路程、主动放弃与超时；遍历每个玩家角色的所有对手组合和赛道排列。记录实际获得、能力日志与覆盖、体力净收支、五马完赛、原始/结算名次及无卡、无偏好牌、死亡、临近冲线分类。

## 探索结果

### 方法与覆盖

- 规则哈希：`0x4165ca878a179fe4f6a872ee937d6dd3bab34d734e723ab387ef2948e84e6eb7`。能力与卡牌参数保持规范表数值，未按样本调参。
- 定向验证在 `tests/api/ts/pony-strategy.test.ts`：普通兼容 C-27 / 弱即时稀有 C-21 的取舍；先取得动力牌后，Cloud 选新类型、咕咕嘎嘎选同类；牛来在 C-22 支付后选阶段补给 C-23，普通角色选 C-01；啥马主动放弃与超时有不同效果；Berry 提前取 C-11 时多 6 秒有效覆盖并更早完赛，第三检查点才取时额外覆盖为 0、完赛不变。固定牌面是语义场景，不纳入随机胜率。
- 校准、留出分别使用两个独立开场种子，域为 `pony-strategy/{phase}/seed/{n}` 和 `opening/{n}`，`n=0,1`，对应档位 1、2。两组不共享开场 seed/锚。
- 每个角色每个种子为 `C(8,4) × 4! × 5 = 8400` 份名单；每组 `9 × 2 × 8400 = 151200`，合计 302400 行。逐行检查无重复、无缺项、角色/参赛索引对应，属性、玩家 14 张牌与 CPU 牌组均等于 `derivePaidCoreInput`，没有人为塞入偏好牌。
- 固定策略枚举当前面板的合法选择、主动放弃和全部合法刷新序列；用两个独立预测锚最小化自身完赛时间，预测中后续手动面板按超时处理。真实执行锚使用独立域，选择时间为 `openSec + 1`。这是单检查点策略，不是全局最优策略，也不按最终返奖做搜索。
- 302400 行无无效选择，五名参赛者的体力记录全部对账：初始值 + 连续净增减 + 离散事件净增减 = 最终值。连续变化包含恢复/容量钳制，同一时刻的事件按净变化记录。
- 两组完整遍历中刷新次数均为 0；没有因此强制发 C-05。另从真实派生规则搜索并固定 `refresh-probe` 第 174 个种子，策略实际取得 `[5,30,33]`，合法刷新一次、无无效选择；该定向例独立记录，不加入随机结果比例。`first` / `timeout` 对照各在小样本运行，与完整 `finish` 结果分开保存。

### 样本结果

下面胜率对本组两种子与全部名单等权平均；最佳总返还是本组固定策略下最有利名单的平均总返还，含本金。

| 玩家角色 | 校准样本胜率 | 留出样本胜率 | 校准最佳名单总返还 | 留出最佳名单总返还 |
| --- | --- | --- | --- | --- |
| Kiruno | 10.27% | 60.00% | 2.25× | 3.00× |
| Shadow | 33.68% | 60.00% | 3.00× | 3.00× |
| Berry | 10.00% | 51.25% | 1.50× | 3.00× |
| Cloud | 22.74% | 58.75% | 3.00× | 3.00× |
| Thunder | 10.11% | 51.25% | 2.25× | 3.00× |
| 牛来 | 10.00% | 39.82% | 1.50× | 3.00× |
| 啥马 | 13.39% | 57.86% | 3.00× | 3.00× |
| 奶龙 | 10.00% | 51.25% | 1.50× | 3.00× |
| 咕咕嘎嘎 | 10.00% | 57.86% | 1.50× | 3.00× |

- 名单选择确实改变样本结果：不能把一份固定 CPU 名册的结果当成角色平衡结论。
- 校准组啥马有 4265 场未取得卡牌；每个角色各有 6720 场实际受击死亡。留出组 Berry、Thunder 各有 16800 场无对应潜在偏好牌，奶龙有 8400 场；不伪造偏好牌或能力触发来填覆盖。
- 能力计时来自 trace。日志触发次数不等于全部能力的生效次数：轻装、乘风和有牛劲是门控/初始化修正，Berry 由装备生命周期体现，奶龙是瞬时恢复。潜在偏好牌标签与实际触发、实际恢复量分别记录。
- 临近冲线定义为面板开启后距玩家冲线不超过 2000 模拟 ms；两组此分类均为 0。第三检查点的装备取舍另由定向场景验证，没有将普通第三检查点伪记为该分类。

### 求时与交付验证

302400 行中 RK 步数最多的派生样本为 102 步，本地生产 Solver 的 digest 与五马完赛时间均匹配，调用 gas 估计为 3960493。另 80 场固定生产输入在 Monad 只读 state override 中全部结果哈希匹配，平均/最大 solve gas 为 2655783 / 4445799；诊断内核样本为 3686764。上述都不是最坏合法输入认证，未签名、广播或真实部署合约。

角色目录、九个初始能力、名单协议、获得账本、收藏 v2、选马队列、图鉴子页、比赛/结果/分享渲染已接入。新增四个角色均通过真实试玩到分享的浏览器路径；奶龙正式母版采用已验收 v6，咕咕嘎嘎保持已验收两脚原图。合约是单体 Solver 加 Game/Vault/持久 Rewards，无外部计算辅助合约或库链接。

## 复现说明

在项目根目录运行：

```bash
bun --no-env-file test tests/api/ts/pony-strategy.test.ts
bun --no-env-file scripts/analyze-pony-strategies.ts --phase calibration --seeds 2 --policy finish --out .cache/pony-build/strategy-calibration-full
bun --no-env-file scripts/analyze-pony-strategies.ts --phase holdout --seeds 2 --policy finish --out .cache/pony-build/strategy-holdout-full
```

原始输入、实际候选/获得、五马时间、能力/体力记录与 digest 在对应 `.jsonl`；汇总在 `.summary.json`。本次结构核验结果为 [strategy-validation.json](../../.cache/pony-build/strategy-validation.json)，补充刷新例为 [strategy-refresh-case.json](../../.cache/pony-build/strategy-refresh-case.json)，样本求时核对为 [strategy-heavy-gas.json](../../.cache/pony-build/strategy-heavy-gas.json)。这些本地大文件被 Git 忽略，可用脚本重建。

## 注意事项与补充

302400 是结构覆盖数量；独立开场种子只有四个。最佳名单在留出样本中达到 100% 不意味着稳定获胜或保证 3 倍返还。该实验验证偏好可达性与阵容敏感性，不认证所有策略、未采样随机锚或所有档位的最终返奖率；档位 3、4 的功能正确性由跨实现向量与协议测试覆盖，不混入本表的统计。

本次不改真实部署配置、不发布索引器、不以虚拟认证器替代正式域名/真实设备证据。当前配置 Game 的只读规则哈希为 `0x5ff01a27886c1cad8a1d286cf2bb15280f711d7133ab3377b375855bf5d3f84b`，不是测试夹具的 LegacyV4 哈希；已部署 50 ms 旧版本的严格轨迹回放不由本次 250 ms 无名单夹具证明。原 Game 的交易目标绑定与本地旧 ABI 恢复/结算已验证。

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
