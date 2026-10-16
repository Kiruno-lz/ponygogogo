# 效果系统与事件求时器架构

`src/race/` 是浏览器端的规则参考实现，用于预览与测试比对；Solidity 复算同一冻结规则（[链上架构](onchain.md)）。本文定规则层与表现层的边界：**规则表、求时器，以及只读规则快照的场景、页面、素材与结算展示**。卡牌规则在[卡牌设计](card-design.md)，运动与体力参数在[玩法设计 §5](game-design.md)，本文只定实现边界、扩展点与确定性约束。

## 1. 为什么只有一个求时器

卡牌会长期增长，[卡牌设计 §3](card-design.md) 的原语包含场上实体、区域场、全局环境、自动触发、监听与发牌游标。如果每张卡自带一段结算逻辑，每加一张卡都可能改变既有卡牌的事件边界或积分函数，浏览器与 Solidity 也要逐张对齐。因此：

- 卡牌的数值与资格只存在于一张规则表（`src/race/paid/cardRules.ts`），角色能力只存在于 `src/race/paid/ponyRules.ts`，玩家基线只存在于 `src/race/paid/playerBalance.ts`；Solidity 表由它们生成。
- 事件边界、同刻顺序与积分只存在于求时器（`src/race/paid/solver.ts` 的 `solvePaidCore`）。免费试玩与有奖比赛共用这一套求解。
- 新的效果机制先进入求时器与规则版本，再进入规则表。

判据是**没有卡牌效果时这段逻辑还需不需要存在**：需要的（运动、体力、里程、冲线、发牌、名次）是求时器的固定部分，不需要的（某些卡才会发生的事）用效果实例表达。

## 2. 求时器的固定部分

即使没有实际获得卡牌，求时器仍负责运动、体力、检查点和名次。输入须包含合法的 14 张玩家牌堆与 CPU 私有牌堆，不能传空卡池。

| 职责 | 说明 | 位置 |
| --- | --- | --- |
| 事件求时与处理顺序 | 有序事件表、无场解析积分、有场确定性数值积分，见 §5 | `paid/solver.ts` |
| 马匹运动学 | 运动基础速度按加速度与上限计算；B 加入 b 后乘百分比，K 外加；重力井场项 | `paid/motion.ts` |
| 体力与资源 | 基线参数由 `createState` 按名单选取（含玩家奶龙容量）；C-22 支付与直接补给单独处理 | `paid/playerBalance.ts`、`solver.ts/createState`、`paid/resources.ts` |
| 里程与终点 | `dist` 积分、25% / 50% / 75% 里程档、`pos ≥ L` 的首次冲线时间、物理排序与【版本答案】结算排序 | `paid/solver.ts`、`core/paidSettlement.ts` |
| 入场派生 | 玩家 14 张牌堆、CPU 各 3 张私有牌与五马性格由 seed 与入场锚经域分离派生，再作为输入传入求时器 | `paid/race.ts/derivePaidCoreInput`、`core/paidDeck.ts`、`paidCpuDeck.ts`、`paidProfiles.ts`、`chainEntropy.ts` |
| 发牌状态 | 游标、刷新额度、自动面板与断卡；窗口早晚由 `openPanel` 判定，断卡、自动、刷新与候选由 `classifyPaidDraw` 判定 | `core/paidDrawRules.ts`、`paid/solver.ts` |
| 效果实例容器 | 实例的挂载、计时与带原因的结束（到期、覆盖、偷取、回收、消费、冲线） | `paid/solver.ts` |
| 速度与体力聚合 | 把当前有效实例求和成百分比贡献、消耗与恢复修正；门控实例按当前条件计入 | `paid/solver.ts` 的 `mods()` |
| 角色能力 | 上限与容量修正（`createState`）、消耗/起飞/持装备加成（`mods()`）、长装备期限（`equip`）、获得卡牌触发（`onPonyCard`），记 `EV_PONY` | `paid/solver.ts`、`paid/ponyRules.ts` |
| 事件日志与摘要 | 每个处理的事件按事件码折叠进 `digest`，与 Solidity 逐项一致 | `paid/events.ts` |

**效果容器与速度聚合归求时器，不归某张卡。** 它们是全部卡牌共用的基础设施；让每张卡各自实现时间边界与数值舍入，会导致两端结果不一致。**里程也归求时器**：检查点抽卡是玩法骨干，不是某张卡的效果。**电脑马与玩家马共用同一运动公式**，没有追赶项、目标速度或噪声。

## 3. 效果实例

一张卡的全部数值在规则表的一行（`PaidCardRule`）。`applyCard` 按该行的 `effect` 分支，把它展开成实例或一次性写入。实例种类：

| 种类 | 含义 | 代表卡 |
| --- | --- | --- |
| `buff` | 限时或永久的百分比、体力修正或状态标志（起飞、亢奋、运气E）。门控实例在每个运动区间按起飞、已获得毛发颜色数量或装备条件重算贡献 | C-01–C-03、C-14、C-16、C-24–C-30、C-32–C-36、C-39；C-31/C-39 触发后另挂 buff |
| `bonus` | C-04 的后续卡附加百分比，以及稀有专精等角色附加速度 | C-04 |
| `equip` | 占装备槽（躯干、尾、四蹄）；重力井作为带场标记的装备存在；到期、被覆盖、被偷、被回收时结束，翻新只更新期限 | C-07、C-08、C-10、C-11 |
| `ability` | 周期性自动触发的能力 | C-09 |
| `respawn` | 死亡后 5000 ms 的免疫 | 系统自持 |
| `watch` | 监听阶段边界、资源阈值、独立里程阈值、装备获得、死亡拦截、力竭拦截或主动放弃；C-37/C-39 持续到消费，C-31/C-40 持续到冲线 | C-23、C-24、C-31、C-37–C-40 |
| `fixed` | 有来源与期限的额外速度 K，死亡保留，到期移除 | C-22 |
| `trait` | 角色能力触发的独立百分比速度实例，按能力期限计时 | Cloud、啥马、咕咕嘎嘎 |

不属于实例、直接记在马或场上的状态：当前显示毛色与已获得毛发类型集合（C-19/C-20）、固定速度 B（C-17/C-18/C-21；C-40 各阶段由监听更新）、目中无人、断卡与 C-04 附加标记；全场风槽与炸弹列表。风火轮的 K 属于装备实例，移除即清除；死亡不改上述状态。

实例上限 96、炸弹上限 20、事件上限 4096，数量超限抛错；模拟时间到 600000 ms 时返回未冲线哨兵值 600001，不抛错。形状合法但违反窗口或候选规则的已存选择按无交易处理，记事件 `EV_CHOICE_INVALID` 并附原因；现有样本不能证明全部合法输入都不会触及数量上限。

交换在求时器内置换两匹马的 `pos` 与站位（内部字段 `lane`，快照与 `paidSwap` 中称 `laneIndex`）；站位的规则语义见[玩法设计 §3](game-design.md)。

规则表缺卡或越界会失败：`paidCardRule` 对越界 id 抛 `INVALID_PAID_CARD`；`PAID_CARD_POOL` 在模块导入时构建，缺元数据即抛 `MISSING_CARD_METADATA`；`scripts/gen-paid-card-rules.ts` 校验 id 连续与卡池下限。

//TODO - 断言规则表里每个 `effect` 在 `applyCard` 都有分支：遍历 `CARD_EFFECT`，逐张单独获得并检查实例或状态确有变化（排除每张卡都会写入的 `EV_CARD`；C-05 只改发牌状态，除外）。`applyCard` 目前以 `default: break` 对未知 `effect` 静默跳过。

## 4. 扩展点与写入边界

### 4.1 新增卡牌与角色能力

- **机制已有的卡**：在 `cardRules.ts` 加一行，在 `src/race/cards/metadata.ts` 登记名称键与图标，在 `src/ui/i18n.ts` 加双语名称、梗文案与描述模板，补卡图。重新生成 Solidity 表与向量，规则哈希随卡表变化。
- **新机制**：先在 `cardRules.ts` 加 `effect` 与字段；在 `solver.ts` 的 `applyCard`、`mods()`、`triggerAt`、`findDue` 加分支；在 `cards/paidCards.ts` 的 `describe()` 与 `paidSnapshot.ts` 的 `effectFrom`、`toRaceEvent` 加文案与表现映射；同步 `contracts/libraries/PaidRaceEngine.sol`、`PaidRaceMotion.sol`、`PaidRaceCardPlan.sol` 与 `PaidRaceCold.sol`。如果一张新卡逼着你改同刻顺序或积分函数，说明它需要第十类原语，先回[卡牌设计 §3](card-design.md) 论证，再改本文，最后才加卡。
- **新角色能力**：`ponyRules.ts` → `gen-pony-rules.ts` 生成 `PonyRules.sol` → 在 `solver.ts` 与 Engine 中实现触发 → `gen-pony-vectors.ts` 重新生成角色向量。

任何规则变化都要重新生成 paid 与 pony 两套向量（后者的 `meta.rulesetHash` 就是 paid 规则哈希），通过[链上架构 §9](onchain.md) 的门禁，部署新的求时器、Game 与 Vault，并对 `PonyRewards` 调用 `setGame` 登记新 Game。

### 4.2 速度与体力是聚合出来的

`mods()` **返回**当前时刻的百分比贡献、消耗与恢复修正，不直接写速度：返回值可以按固定顺序求和，写入则依赖调用次序，而调用次序是最容易在重构中悄悄改变的东西。聚合规则按[卡牌设计 §3.2](card-design.md)：

- 百分比先加总、只乘一次 `b = b_motion + B`，乘数取 `max(0, 1 + P)`；K 在乘法之外。贡献只在挂载、触发或结束时增减，死亡保留。
- 消耗倍率为 `max(0, 1 + Σ消耗修正)`；恢复修正独立加算。
- 重力井的场项在积分内部按同一求解时刻的五马实时位置计算，不取触发时的快照。
- 卡牌不修改基础加速度；B 独立于运动基础上限。力竭的有效加速度为 0，运动基础速度钳至 1200，不清除 B/K；死亡或解除力竭后以恢复加速度 150 回到各自上限，冻结性格不被改写。

### 4.3 写入边界

这张表是[玩法设计 §7](game-design.md) 写入约束的实现落点：每类状态只有列出的位置能写，其余路径只读。

| 写入对象 | 唯一写入位置 |
| --- | --- |
| 任意马的 `pos`、`dist` | `advance` 的运动积分；`pos` 另可由 `swapAttempt` 置换，**`dist` 从不被交换改写** |
| 任意马的站位 `lane` | `swapAttempt` |
| 基础速度、体力 | `advance` 的积分、`applyDue` 第 1 类阈值事件、`kill`、`recover` 与 `applyCard` 的体力写入 |
| 恢复加速度状态 | `kill`、力竭解除时设置 150；达到运动基础上限时清零；冻结 accel 只读 |
| 固定速度 B / 额外速度 K | `applyCard`、实例挂载与结束、风火轮档位与里程监听；`kill` 保留两池 |
| 当前毛色、历史毛发种类、装备槽、风、炸弹 | `applyCard`、`equip` / `steal` / `endInstance`、`placeBombs` 与炸弹触发 |
| 牌堆游标与刷新额度 | `createState`（角色初始刷新）、`core/paidDrawRules.ts` 的 `applyPaidChoice`、`resolvePaidAutomaticChoice` |
| 结算排序 | `core/paidSettlement.ts`：只读 `finishTime` 与已获得卡牌集合，不改 `finishTime`、`rawOrder` |
| 五马入场冻结的基础加速度、速度上限与体力参数 | **无**：`createState` 之后只读 |
| gogo 与镜头 | **无**：`PaidCoreInput` 没有对应字段 |
| 渲染层状态 | **无**：求时器不 import Phaser、React 或资源清单 |

**跨马写入是双向的**：玩家的卡能写电脑马，电脑马的卡也能写玩家。唯一禁死的是性格参数——它们是难度标定的锚点。唯一的过滤条件是【目中无人】：来自其他马的效果对持有者无效，范围见[卡牌设计 §4](card-design.md)。

「`dist` 只由运动积分累加」是里程制免疫刷卡的实现保证：只要没有任何卡能写里程，就不存在任何一张卡能凭空制造抽卡机会。

//TODO - 静态检查写入边界：对 `solver.ts` 做 AST 检查，断言 `horse.dist` 与性格字段（`base`、`accel`、`capMilli`）只在 `advance` 与 `createState` 中被赋值；另断言电脑马路径不读取 `PaidCoreInput` 之外的玩家状态，任何规则函数不读取 gogo 或摄像机。

### 4.4 【力竭】

力竭属于马的体力状态，五匹马规则相同。体力见底时：【亢奋】保证下限 1；30 秒内未消费的【来劲】先拦截一次并补给 250；否则记 `EXHAUST_ENTER`，停止消耗、加速度 0、运动基础速度钳至 1200、按 15/s（受恢复修正影响）恢复。体力恢复到 135 时记 `EXHAUST_EXIT`，开放常规上限但不改变当刻速度。获得【亢奋】可解除已有力竭；直接补给达到退出阈值也可解除。死亡或解除力竭后以 150 加速度恢复至自身运动基础上限，再还原常规加速度。

## 5. 确定性与事件求解

确定性靠输入显式、全整数运算与冻结的事件顺序：

- **输入全显式。** `PaidCoreInput` 是求时器的全部输入：五马性格、两类牌堆、seed、入场锚、角色名单与已存选择。求时器不读系统时钟、不用 `Math.random`，随机一律走 `chainEntropy` 的域分离派生，绑定 seed、可验证区块哈希、检查点、用途与事件序号。
- **全整数。** 时间为整数毫秒，位置、里程、速度与体力为定点整数（`bigint`）；所有循环有界，求不出进展时抛 `NO_PROGRESS`。
- **双时钟。** 模拟时间 τ 与现实时间并行：选牌面板开启时 τ 以 1/10 速度推进（`SLOW_FACTOR`），`txSec`、`openSec` 按现实秒计算。
- **规则版本。** 规则哈希 `PAID_RULESET_HASH` 由 `ponygogogo/paid-rules/v0.1` 域、卡表、角色表与玩家基线共同生成；表或全局参数变化必须升级生成物，已开场会话使用绑定的求时器。
- **事件日志与摘要。** 每个处理的事件（含 `EV_CHOICE_INVALID` 及其原因）折叠进 `digest`，事件码表在 `paid/events.ts`。`checkPaidChoice` / `classifyPaidChoice` 供有奖驱动器在发送前预检、回执后判定选择是否有效。

### 5.1 事件求解

求时器运行一个有序事件表，而不是按固定步长或浏览器帧循环：

1. 初始化五马位置、里程、运动基础速度、体力、P、B、K 与卡牌状态；以 `T0` 为现实时间起点，按双时钟映射模拟时间。
2. 无重力井的区间，对每匹马用 §4.2 的解析式求出最早的速度达上限、体力阈值、里程检查点、静态炸弹触线与冲线时刻（位移至多二次，按整数毫秒二分定位）；卡牌到期、C-09 每 2 秒交换、风火轮叠层、已锁定的选择时间也各提供候选事件。
3. 重力井生效时，五马运动耦合，使用规则冻结的定点 RK2 中点积分（步长 `PAID_CARD_GLOBALS.rkStepMs = 250` ms，生成 Solidity 常量并纳入规则哈希），在积分中定位炸弹、检查点、C-40 里程与终点的首次越过；场项取步中点值，不定位场边界。
4. 取全场最早事件，推进全部未冲线马到该时刻，按下列同刻顺序处理，再建立下一段；直到五马冲线或达到 600000 ms 模拟时间上限。
5. 返回 `finishTime`、`rawOrder`、`settlementOrder`、事件日志与 `digest`。前端练习与有奖展示通过 `PaidTrace`、`sampleHorse` 与 `buildPaidSnapshot` 采样这条规范轨迹，渲染帧不重新积分。

### 5.2 同刻顺序

同一毫秒内的事件按类处理，类内按括号中的键升序；每处理一项都从第 0 类重新扫描，同毫秒新产生的项按同一规则插入：

```
积分推进到最早事件（无场解析 / 有场 RK2，步长 ≤ 250 ms）
     → 0 效果到期与移除（instanceId）；C-02 到期在本类结算死亡
     → 1 基础速度封顶；体力阈值：力竭解除、超容量回落、见底（先由 C-38 拦截，否则进入力竭）（horseId，同一匹马先封顶后体力）
     → 2 冲线（horseId）
     → 3 炸弹首次触线，死亡或免死（horseId，炸弹序号）
     → 4 周期与阶段触发：C-09 交换、C-11 风火轮档位、C-23、C-24、C-40（instanceId）
     → 5 里程检查点越过：电脑马取卡，玩家开面板、断卡或推迟（horseId）
     → 6 玩家面板关闭与取卡
     → 该毫秒无新事件，建立下一积分区间
```

其余监听在触发它的处理内同步执行：C-31 在 `equip` 内、C-37 在 `kill` 内、C-38 在第 1 类、C-39 在第 6 类。面板开启期间越过的检查点记 `PANEL_DEFER`，关闭后按顺序补开；玩家冲线以 `CLOSE_FINISHED` 收起面板。

三条不能挪的顺序：

- **炸弹用连续轨迹的首次触线定位。** 不能只在事件端点检查坐标相等，否则高速运动会漏判。
- **重力井在积分内部计算。** 以该时刻真实距离给当前基础速度提供百分比贡献，不能把场视作单次触发事件或改基础上限。
- **里程只累加自身运动积分。** 位置跳变后用新 `pos` 判断终点，但交换位移不计入 `dist`。

### 5.3 跨语言向量

`tests/vectors/paid-race-v0.1.json`（360 组，`scripts/gen-paid-vectors.ts` 生成，`tests/contracts/PaidRaceSolverVectors.t.sol` 在 Solidity 复算）逐字段比较事件、摘要、检查点、冲线时间与结算排序；`tests/vectors/pony-race-v0.1.json`（288 组，`gen-pony-vectors.ts` 生成，`ponyVectors.test.ts` 与 `PonyAbilityVectors.t.sol` 使用）覆盖角色能力。五个 `check:*` 脚本（paid-cards、paid-vectors、pony-rules、reward-rules、pony-vectors）校验生成物没有过期；`gen-paid-card-rules.ts` 同时生成 `PlayerBalance.sol`。

//TODO - 在真实浏览器引擎中运行同一份向量：新增 Playwright 用例载入 `paid-race-v0.1.json`，断言浏览器求得的 `digest`、事件时间与量化冲线时间与向量一致（Bun 的 `vectors.test.ts` 与 Foundry 的向量复算已覆盖 Bun 与 Solidity）。

//TODO - 用离线高精度参考测定重力井 RK2 中点积分与连续解的误差，按冲线时间偏差（ms）报告最坏样本；误差改变名次时先缩短步长并升级规则哈希。

//TODO - 同秒交易与链重组用例：在 TS 求时器与 Foundry 中固定相同的 `T0/Ti`、区块哈希、卡牌与刷新记录，断言五马事件序列、量化冲线时间与两层排序逐字段一致。

## 6. 表现层

表现层只读取规则快照与链上事实，规则层不 import Phaser、音频、DOM、资源清单或 manifest——这是美术进度与数值调参解耦的唯一方式。动画、声音、掉帧、减少动态效果与资源错误都不能改变规则结果。

### 6.1 快照与赛道场景

```text
src/race/paidSnapshot.ts       求时器轨迹 → RaceState 与 RaceEvent，表现层读取的唯一规则快照
src/race/driver.ts             免费试玩驱动器：本地时钟与本地入场锚
src/race/paidDriver.ts         有奖驱动器：链上规范时间线
src/game/RaceScene.ts          赛道、环境、一次性事件、镜头与 Phaser 场景时序
src/game/pony.ts               PonySprite：马体动画、状态、装备与头饰挂点
src/game/effects.ts            装备/天气素材、状态筛选与纯几何表现数据
src/game/layout.ts             赛道画板与镜头构图常量（PLAYER_ANCHOR_X、PLAYER_GOGO_MAX_X）
src/game/gogoCamera.ts         gogo 点击密度到镜头构图偏移
src/game/sceneArt.ts           按资产 key 解码赛道与效果图片
src/ui/race/useRaceScene.ts    Phaser 生命周期、本场资源解码、失败显示与重试
src/ui/race/raceEventAudio.ts  RaceEvent 到音效与冲线旋律的映射
src/ui/race/RaceScreen.tsx     驱动器帧更新与 HUD 浮层
```

**表现层读取快照，规则层不知道表现层存在。** `paidSnapshot.ts` 把求时器轨迹按固定比例换成 `RaceState`（其中的 `EffectInstance` 带 `primitive` 与 `tags`，只供 HUD 与场景筛选）和 `RaceEvent`；它只按求时器的 `finishTime` 排列显示名次，不做速度、体力或名次计算。表现层按帧读取当前 `RaceState` 中的装备实例，所以转移后的装备跟随新持有者；`RaceEvent` 只用于播放一次的转移动画、声音、碰撞反馈或 `cardEffect` 浮字（触发、资源增减、固定值、目标、拦截、翻新、角色能力）。

gogo 只喂 `GogoCameraMotion`，`RaceScene` 以同一镜头位置绘制全部世界对象；镜头构图规则见[玩法设计 §1](game-design.md)。交换后镜头随玩家新位置立即切换，不做平滑过渡。

各卡的表现约定：

- C-09 成功交换播放 `audio.sfx_swap`，不触发专属镜头、闪光或粒子，两匹马直接按新位置绘制。
- C-10 不显示场范围与目标反馈，来源只由持有者腹部的黑洞装备表达；C-11 的火焰层数不渲染到马身，只显示四蹄风火轮与【起飞】姿态。
- C-02 的【运气E】由 `paidSnapshot.ts` 在 `speedDeath` 实例上输出 `Status`、`statusId: 'luckE'` 与 `spin: true`：马体围绕图片垂直中心纵向压缩/翻面，叠一条居中于马图中心的螺旋拖尾分镜（16 帧、650 ms 循环），拖尾不随马体翻面。
- C-07 火箭与 C-10 黑洞挂在腹部挂点，作为 `PonySprite` 根节点的子对象，随【起飞】升降。
- C-13 消费 `steal { from, to, equipId }` 事件，在两匹马挂点间播放同一装备素材的短弧线转移；场景快照仍决定最终挂载。
- C-19、C-20 的毛色显示为头顶尖发：`activeHeadCosmetic` 按最近一次染色卡选金色或绿色素材，挂在头部锚点，不改马体贴图。
- 玩家持有 C-21【目中无人】时，不绘制他马的精灵、装备、拖尾、炸弹与风，只保留 HUD 名次条。
- 选中马的金圈由 `RaceScene` 绘制在马匹深度之下。减少动态效果时 C-02 保持稳定姿态、C-13 直接完成转移，均不影响规则状态。

//TODO - 插槽回归：对每件装备（含黑洞）逐帧比对挂载点与 rig 关键帧的偏差，判据为装备不脱离马身、不穿模、【起飞】时全部挂载物随根节点整体偏移；用 `toHaveScreenshot` 快照基线比对。现有 `tests/e2e/specs/pony-visual.spec.ts` 只覆盖 8 号角色的风火轮、火箭、彩虹挂点。

### 6.2 页面、卡面与资源

页面状态由 `src/App.tsx` 管理（loading/home/select/race/result/collection/effectShowcase），设置、钱包与注册为浮窗。舞台画板：首页 1611×976，结算页 1620×971，加载、选马、比赛、图鉴与特效验收页 1619×971（`src/game/layout.ts`）；共享 `useStage` 等比缩放舞台，切片版位由 `src/ui/styles/` 的 CSS 固定，`src/ui/theme.css` 按 base、controls、screens、result 顺序导入。

卡面、选牌面板、图鉴与获得窗口使用同一个 DOM 卡面组件（`src/cards/Card.tsx`）；HUD 与结算回顾以图标和名称简化展示。数值、品质与描述由 `paidCardDef` 从规范表生成，名称与梗文案读取 i18n，图像经 `cardIconUrl` 指向 40 张独立 WebP。中英文名称、描述模板、提示与错误集中在 `src/ui/i18n.ts`，数值从规则表插值；美术图片里的字由素材处理，装饰英文保留。

资源按 manifest 的 boot/home/race/result 分级（`src/app/useAssets.ts`、`src/assets/`）：先加载 boot，再阻塞加载 home，其余后台预取；选马、比赛、图鉴等待 race 级，结算等待 result 级，由加载页与分级门 `TierGate`（`src/ui/loading/`）把关。标为 deferred 的角色分镜与立绘不随分级加载，`useRaceScene` 开赛前按本场名单单独解码五个角色与场景资源后创建 Phaser，卸载时销毁。任何一级加载或解码失败都显示失败项并允许重试，不提供逐件占位降级，不以缺图继续进入（[卡牌设计 §9.2](card-design.md)）。素材生成见[素材管线](../../scripts/README-assets.md)。

### 6.3 结算与海报

玩家冲线后保存本地名次预览，有奖资金状态独立显示；回执确认后改用链上名次与实际返还，并与 TS 复算比对（[链上架构 §5](onchain.md)）。获得窗口只使用回执确认的获得事实。结算页的信息与印章规则见[玩法设计 §8](game-design.md)。结算名牌位于奖章下层，奖章按 1–5 名取素材，名次数字已在图片上，DOM 保留读屏节点。

海报由 `src/export/` 的离屏 Canvas 在预制美术上绘制，输出 1620×971 PNG，不截取页面 DOM；复制直接调用 Clipboard API，保存使用临时 download 链接。

### 6.4 开发特效验收入口

首页的特效验收入口只由 `import.meta.env.DEV` 控制，生产构建不显示。入口列出完整 40 张 `PAID_CARD_POOL`，以确定性输入运行生产 `solvePaidCore`、轨迹采样与 `buildPaidSnapshot`，复用生产选马、`RaceScreen`、`RaceScene`、结算页与获得窗口；`EffectShowcaseDriver`（`src/game/effectShowcase.ts`）实现与生产相同的驱动器接口。场景可暂停、逐步推进、跳到效果或下一事件、重播，并按所选角色预览结算与获得窗口（获得物使用演示数据）。展示时钟按页面单调相对时间推进，不用 `Date.now` 或 `Math.random` 决定规则事件；入口不调用钱包、不提交链上选择、不持久化收藏，也不维护第二套效果数值。

验收以源码测试和确定性场景检查为门槛：测试覆盖情景状态、效果映射、装备转移事件与减少动态效果分支；浏览器验收（`tests/e2e/specs/effect-showcase.spec.ts`）再核对真实 `RaceScene` 的动画、挂点、层级与入口的开发/生产可见性。

## 7. 目录结构

在[技术架构 §3](overall.md) 的基础上细化规则层：

```text
src/race/paid/     求时器与规范表：cardRules、ponyRules、playerBalance、rewardRules、constants、solver、motion、
                   resources、events、race（入场派生组装）、vectorCodec 与测试工具 testkit
src/race/core/     入场派生与结算的纯函数：paidProfiles、paidDeck、paidCpuDeck、paidDrawRules、paidSwap、
                   paidSettlement、chainEntropy、roster；表现层使用的 RaceState 类型与 fixed/rng/constants
src/race/cards/    卡面：名称键与图标（metadata）、由规则表生成的说明（paidCards）、卡池导出（pool）与图标地址
src/race/*.ts      驱动器与快照：driver.ts、paidDriver.ts、paidSnapshot.ts、paidResult.ts、paidWindow.ts、raceView.ts
contracts/PaidRaceSolver.sol、contracts/libraries/PaidRace*.sol   Solidity 复算
contracts/libraries/PaidCardRules.sol、PonyRules.sol、PlayerBalance.sol、RewardRules.sol   由 TS 规范表生成
tests/vectors/     paid-race-v0.1.json、pony-race-v0.1.json、构筑分析 paid-card-builds.json
```

规则表是纯数据：**加一张已有机制的卡，正常路径是往 `cardRules.ts`、`metadata.ts` 加记录，并补 i18n、卡图和生成物，不需改求时器。** 如果一张新卡逼着你改求时器，按 §4.1 走完整流程。
