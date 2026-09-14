# 无链最小 Demo 计划

## 1. 边界

这份计划的唯一目标是**把游戏做出来并做到好玩**。范围内没有任何链交互，链的位置用一个 mock 端口占住。

它覆盖[交付计划](delivery.md)的 A、B 两阶段，并把这两阶段做成一个自身完整、可以从头玩到尾的产品；C、D、E 阶段不在本文范围内。玩法规则一律以[玩法设计](../game-design.md)为准，卡牌清单与效果原语以[卡牌设计](../card-design.md)为准，效果模块边界以[效果系统架构](../architecture/effect-system.md)为准；本文不重复定义数值。

**绝对禁止项，全部可机械检查：**

| 禁止 | 检查方式 |
| --- | --- |
| 任何链依赖进入 `package.json` | 依赖名匹配 `viem`/`wagmi`/`ethers`/`@mera`/`web3` 即判失败 |
| 源码里出现 RPC URL、chainId、合约地址、ABI | 全量 grep，命中即失败 |
| 源码 import `window.ethereum` 或任何钱包对象 | 同上 |
| 界面出现 tx hash、区块浏览器链接、"上链中"字样 | 文案检查；mock 的状态一律用中性词 |

放开这条边界的唯一方式是本文作废、回到 `delivery.md` 的 C 阶段，不是在这里加一个"小小的"真实调用。

## 2. 验收：什么叫"完整完成游戏"

一条不能断的动线，任意一环走不通就不算完成：

```
启动 → 加载页（进度、失败可重试） → 首页（开始/图鉴/设置/语言）
     → 选马（五匹，看得出区别） → 下注（mock，含 0） → 起跑倒计时
     → 比赛（快跑、体力、镜头跟随、四匹电脑马实时追赶）
     → 检查点 ×3（慢放、三选一或放弃、20 秒限时、刷新机制）
     → 冲线 → 尾场快放 → 结算（名次、返还、三次选择回顾）
     → 分享出图 → 再来一局（回到首页且状态干净）
```

加上三条质量门禁：

1. **逻辑完整性门禁**：固定 seed 下五匹马最终都能结束，名次严格落在 1–5 且不重复；玩家每次选择、放弃、超时、刷新、力竭、死亡、交换和冲线都只发生一次，比赛不会卡在中间状态。
2. **确定性门禁**：同一 `(seed, horseId, 输入序列)` 重放 100 次，全场轨迹逐字段完全相等；30/60/120fps 下终态相等；关闭动画不改变结果。
3. **完整性门禁**：Playwright 跑通上面那条动线，每个关键节点截图核对，并单独跑通加载、入场和结算失败后的重试路径。

数值强弱和策略优劣不属于本 Demo 的验收项；这里只验收规则不出错、流程能结束、画面与规则状态一致。

## 3. 链边界的 mock

整个项目与链之间只有一个接口，两个方法：

```ts
// src/chain/port.ts —— 这个文件是全项目唯一允许出现"链"这个概念的地方
export interface ChainPort {
  enterRace(stake: bigint): Promise<{ seed: Hex; raceId: bigint }>
  settleRace(result: RaceResult): Promise<{ receiptId: string }>
  getBalance(): Promise<bigint>
}
```

mock 实现放在 `src/chain/mock.ts`：

- `seed` 由本地 PRNG 生成，**支持 URL 参数固定**（`?seed=0x...`），否则调不了参也测不了回放。
- 人为延迟默认 600ms，模拟出块等待，可配置为 0（测试用）或 5s（测加载态）。
- 可注入失败：`?mockFail=enter|settle`，用来验证失败路径的 UI 不会卡死。
- `receiptId` 是一个本地随机串，**不叫 txHash、不以 `0x` 开头、界面不展示**，防止有人顺手把它当交易哈希渲染出去。

`settleRace` 收下的 `RaceResult` 就是将来要进 calldata 的那份记录（`horseId`、名次、完成 tick、三次选牌、刷新位置、点击差分、结束原因）。mock 阶段把它 `JSON.stringify` 存进 `localStorage` 当战绩，**字段定义此刻就要定死**——它是这份计划唯一为将来上链付的代价，也是唯一值得付的。

Demo 先固定以下记录结构；没有发生的事件必须用显式状态表达，不能用缺省字段猜测：

```ts
interface RaceResult {
  raceId: string
  seed: string
  horseId: number
  rank: 1 | 2 | 3 | 4 | 5
  finishTick: number
  choices: Array<{
    checkpoint: 0 | 1 | 2
    cardId: string | null
    reason: 'picked' | 'forfeited' | 'timeout' | 'not-reached'
    refreshes: number[]
  }>
  gogoClicks: number[]
  endReason: 'finished' | 'forced-combo'
}
```

mock 只保存最近一场 `ponygogogo:last-result`，不做历史页；“再来一局”必须清除当前比赛状态、临时资源和未完成的错误态，但保留语言与音量设置。

### 3.1 页面与输入决定

- 页面状态固定为 `Loading → Home → HorseSelect → StakeSelect → Countdown → Race ↔ CardChoice → TailRace → Result`；入场与结算失败都留在当前页面显示错误，不跳白屏。
- 下注只提供四个 mock 预设：`0 / 1 / 5 / 10 MON`。它们只影响难度档位与结果展示，不读取钱包、不产生真实余额变化。
- 五匹马固定使用 `horseId 0..4`；赛道布局使用 `laneIndex 0..4`，选马只改变玩家身份和颜色，不改变对手集合。
- 比赛输入只有 `Space`、鼠标点击和触控点击；卡牌面板打开时三者全部禁用。移动端只支持横屏，竖屏显示“请横屏”的阻塞提示。
- 起跑倒计时固定 3 秒；玩家冲线后立即进入结果页，尾场在后台以最多 5 秒的快放演出完成，不阻塞结果页的查看与再来一局。
- 图鉴显示完整 Demo 卡池的只读卡面与效果说明，不记录收集进度；英文缺失文案使用直译占位，不能因翻译缺失阻断加载。

## 4. 目录结构

```text
src/race/            纯规则内核：推进、卡牌效果、发牌派生、输入编码。不 import 任何渲染/DOM/链
src/race/cpu/        橡皮筋 AI
src/race/__vectors__/ 确定性终态向量
src/game/            Phaser 场景、插值渲染、镜头
src/cards/           卡面组件与三段动画
src/result/          结算展示
src/export/          出图与分享
src/assets/          资源清单、加载器、AssetSource 抽象
src/ui/              首页、加载页、选马、HUD、设置、i18n
src/chain/           port.ts + mock.ts，仅此两个文件
scripts/dev.sh       一键启动
tests/e2e/           Playwright
```

`src/race/` 单向依赖是这套结构的核心：它能在纯 Bun 环境里跑完整场比赛，因此手感门禁的批量模拟不需要浏览器，几千场只要几秒。**这一条被破坏，手感调参就退化成手动试玩。**

## 5. 素材

### 5.1 占位素材来源

全部选 CC0，因为占位素材的第一要求是零法律负担、可随时整包替换。Kenney 的包全部 CC0 且风格统一，能凑齐视觉与音频的绝大部分；马匹动画 Kenney 没有，从 OpenGameArt 取一个 CC0 的。

| 类别 | 来源 | 许可 | 内容 |
| --- | --- | --- | --- |
| 马匹动画 | [Pixel Horse](https://opengameart.org/content/pixel-horse)（alizard） | CC0 | 82×66；跑动 5 帧、idle 7 帧、甩尾 idle 4 帧 |
| 界面纹理与按钮 | [Kenney UI Pack](https://kenney.nl/assets/ui-pack) | CC0 | 430 个：面板九宫格、按钮各态、滑块、勾选框 |
| 卡牌框 | [Kenney Playing Cards Pack](https://kenney.nl/assets/playing-cards-pack) | CC0 | 270 个：卡面底框与花色 |
| 图标（卡牌效果、Buff、装备） | [Kenney Game Icons](https://kenney.nl/assets/game-icons) + [Expansion](https://kenney.nl/assets/game-icons-expansion) | CC0 | 箭头、闪电、心形、齿轮等通用符号 |
| 视差背景 | [Kenney Background Elements](https://kenney.nl/assets/background-elements) | CC0 | 110 个：可分层的远景元素 |
| 界面音效 | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) + [UI Audio](https://kenney.nl/assets/ui-audio) | CC0 | 150 个：点击、确认、取消、切换 |
| 胜负提示音 | [Kenney Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 | 85 段短 jingle |
| 循环 BGM | [OpenGameArt CC0 Music](https://opengameart.org/content/cc0-music)、[CC0 Upbeat/Electronic](https://opengameart.org/content/cc0-upbeat-electronic-music) | CC0 | 首页一首、比赛一首，需自行挑选可无缝循环的 |

不选 [LPC Horses Rework](https://opengameart.org/content/lpc-horses-rework)：它是 CC-BY/GPL 需要署名，且只有四方向俯视各 3 帧，横向侧面赛马用不上。

下载与入库由 `scripts/fetch-assets.sh` 完成：拉取上述包、解压、只挑用得到的文件进 `public/assets/placeholder/`、生成清单。目录名带 `placeholder` 是为了让替换时一眼看见范围；脚本要幂等，重复执行不产生重复文件。

**素材缺口要说在前面，不要假装凑齐了：**

- **[卡牌设计](../card-design.md)要求的装备是挂到骨架插槽的持久对象（火箭喷射器、黑洞、风火轮），没有任何现成的 CC0 横向侧视素材包能满足。** 占位阶段不把装备画在马身上：马的身份用**色相旋转 + 号码布数字**表达，装备与 Buff 一律以图标形式出现在 HUD 和卡面上，规则照常运行。这正好对上卡牌设计 §1 的「规则与表现单向依赖，美术缺失时规则照常运行」——占位阶段就是那个美术缺失的状态，不是把它当缺陷绕过去。
- 五匹马靠色相旋转区分，不找五套素材：`hue = f(horseId)`，确定性映射。这正好对上「马由 `horseId` 标识、`laneIndex` 只是可变站位」——换赛道不换颜色，玩家跟得住自己那匹。
- Kenney 的 Music Jingles 是几秒的短提示音，**不是循环 BGM**，两者不能互相顶替。长 BGM 必须单独挑，且要确认首尾能无缝循环，否则每轮接缝都会有一声爆音。

### 5.1.1 音频设计

音频不是贴上去就完事，有两处跟规则直接咬合：

- **快跑点击的三档反馈必须听得出区别，它报的是时机不是速度。** 命中、太快、太慢各一个音，音高或音色区分开。玩家靠耳朵校准的是节拍，而节拍决定体力恢复速度（[玩法设计 §5](../game-design.md)）——速度那一路由频率驱动，玩家从马身上就看得出来，不需要再用声音报一遍。只给一个"咔"等于没做节奏玩法。
- **另需一个进入【力竭】的明确提示音。** 那一刻按钮会锁死，没有声音玩家只会以为游戏卡了。力竭解除也要有声音，否则玩家不知道什么时候能重新按。
- **抽卡慢放不做单独的音乐素材。** 0.1 倍慢放期间给 BGM 挂一个 Web Audio 的 `BiquadFilterNode`（低通）并降低 `playbackRate`，出来就是"时间被拉慢"的听感，恢复时反向过渡。这比切一首慢版 BGM 省素材，也不会在切换点断音。

音效清单（最小集）：按钮点击/悬浮、卡牌发牌、卡牌悬浮、卡牌选定、卡牌刷新、倒计时滴答、起跑枪、快跑三档（净减/持平/净增）、进入力竭、力竭解除、检查点通过、冲线、结算展开、胜负 jingle。

### 5.1.2 组件动效规范

动效是 Demo 的验收内容，不是素材有余力时再补的装饰。所有动效只使用 `transform`、`opacity`、颜色或阴影，不得引起布局跳动；动效从表现层状态差异触发，不能反过来驱动规则状态。

| 组件 / 触发 | 动效要求 | 默认时长 |
| --- | --- | ---: |
| 任意可用按钮 `pointerdown` / 键盘按下 | 立即缩放至 `0.94`，释放后带轻微回弹至 `1.0`；按钮不可用时不播放按下态 | 160ms |
| `gogo` 按钮每次按下 | 在通用按下缩放上叠加一次完整旋转；缩放轨迹为 `0.88 → 1.08 → 1.0`，旋转轨迹为 `0° → 360°` | 260ms |
| 马匹或 HUD 状态新增 | 对应状态图标/徽章先缩小到 `0.65`，放大到 `1.18` 后回到 `1.0`，同时左右摇晃 3 次（最大 ±6°） | 260ms |
| 已有状态增加一层 | 只对状态图标/层数徽章播放一次同样的缩放与摇晃；普通 tick 更新计时器或层数不变时不得重复播放 | 260ms |

状态新增与加层必须由一次明确的表现事件触发；事件连续到达时重置当前组件动画，不排队堆积动画。`gogo` 的旋转与按钮缩放只表达“输入已被按下”，点击是否被规则接受仍由规则内核独立判断，动画不得写入输入记录、改变 tick 或改变名次。

所有按钮必须覆盖鼠标、触控和键盘触发路径；`Space` 触发的 gogo 与鼠标/触控触发同一套动效。设置 `prefers-reduced-motion: reduce` 时取消旋转、摇晃和大幅缩放，改用不超过 100ms 的颜色/阴影闪现，但仍保留按下反馈和状态新增反馈。

动效回归至少覆盖：每个按钮一次按下都有缩放；gogo 一次按下同时有旋转和缩放；状态首次新增与每次加层各播放一次；同一状态普通计时 tick 不重复播放；关闭动效或启用 reduced motion 后比赛结果、输入记录和页面流程逐字段不变。

### 5.2 加载抽象

加载页现在读本地、将来读分布式存储，差别必须收敛在一个接口里：

```ts
export interface AssetSource {
  load(key: AssetKey): Promise<{
    url: string
    bytes: number
  }>                                    // 加载并返回可直接使用的资源 URL
}
```

- `LocalAssetSource`：从构建产物读取 `manifest[key].path`，通过浏览器资源加载事件报告完成。
- `RemoteAssetSource`：从 `${gateway}/${manifest[key].cid}` 读取，成功后返回 Blob URL；gateway 只存在于 source 构造参数，调用方不拼接路径。

`manifest` 是一张 `key → { kind, path, cid?, bytes, sha256 }` 的表，随构建生成。加载器按 `kind` 选择图片、音频或 Phaser 纹理的验证方式；调用方只认 `key`，永远不拼路径——**这是将来换成远程加载时唯一不用改的保证**。当前 Demo 先实现 `LocalAssetSource`，`RemoteAssetSource` 只保留同一接口的测试替身，不提前接入分布式储存服务。

加载页的硬要求：

- 逐项进度，不是一个假的定时进度条。
- **失败必须可重试且指明失败项**，不能白屏。远程加载迟早会失败，这条现在不做，将来接远程时就得重做加载页。
- 全部资源就绪才进首页。Phaser 纹理必须预加载，中途缺纹理是运行时崩溃而不是降级。

//TODO - 加载失败路径验证：断网、单个资源 404、gateway 超时三种情况各跑一次，判据为都停在加载页并给出可重试的明确提示，无白屏、无控制台未捕获异常。远程实现落地前用 mock 的 `AssetSource` 注入这三种失败。

## 6. 阶段

每阶段以可运行入口验收，没有验收证据不标完成。

| 阶段 | 做什么 | 验收 |
| --- | --- | --- |
| **D0 骨架** | Vite + React + TS + Phaser 起项目；`bun tsc -b` 通过；`scripts/dev.sh` 一键启动；素材下载入库 | 空白场景能跑起来；依赖检查脚本确认零链依赖 |
| **D1 一匹马跑起来** | `src/race/` 规则内核：固定 50Hz 步长、定点整数、玩家加速度 / 电脑马目标速度→有限加减速→位移；快跑与体力；Phaser 渲染一匹马 + 跟随镜头 | 纯 Bun 跑 `bun test` 完成一整场；同一输入序列 30/60/120fps 终态相等；快跑输入、无输入和力竭恢复都能完成比赛 |
| **D2 五匹马** | 橡皮筋 AI（`base/min/max/gain/slack/ease/amp/tau` 八参数、抖动、阻尼）；seed 派生四组性格；选马界面；冲线判定与名次 | 固定 seed 重放 100 次轨迹逐字段相等；抖动用 seed+tick 确定性函数（代码审查）；速度函数入参不含名次或目标完成时间（代码审查）；五匹马都能结束且名次唯一 |
| **D3 发牌与选牌** | 14 张牌堆 + 游标发牌；检查点触发、0.1 倍慢放、20 秒限时、超时记 `null`；刷新机制；卡面三段动画，效果先用空实现 | 遍历 seed 断言牌堆十四张互不重复、末两张为强效果卡；任意刷新组合可回放一致；限时、禁用输入和重试状态可重复验证 |
| **D4 效果骨架与纯状态卡** | `EffectInstance`、`tags`、三种算子、模块调度；`Modifier` / `Status` / `Trigger`；先接入不依赖场景实体的卡牌 | 打乱模块注册顺序后终态逐字段不变；缺模块构建期失败；关闭动画与清空资源不改变规则结果 |
| **D5 场景效果与装备** | `Equipment` / `Ability` / `Hazard` / `Field` / `Environment` / `DrawRule`；`laneIndex`、rig 插槽、装备挂载、炸弹、重力井和天气表现 | 注入式测试牌堆逐项覆盖交换、炸弹、装备、场、天气和发牌修正；资源缺失时规则仍完成，表现降级为占位 |
| **D6 完整动线** | 加载页、首页、图鉴、设置、i18n、下注（mock）、结算页、出图与分享 | 第 2 节那条动线 Playwright 全程通过；`?mockFail=` 三条失败路径不卡死；再来一局状态干净 |
| **D7 打磨与回归** | 音效、BGM、组件动效、慢放听感、移动横屏适配、占位素材替换边界与最终截图基线 | 三条质量门禁全部达标；动效回归通过；无控制台未捕获异常、无卡死、无演出与规则状态不一致 |

D2 就要第一次做完整性回归，不要拖到 D7。橡皮筋 AI 是比赛逻辑的基础，越晚发现输入、冲线或尾场状态不一致，返工越贵。

## 7. 测试分层

按全局工程规范分层，但这个项目没有后端也没有跨语言契约，所以 L2 退化：

- **L1（`bun test`，持续跑）**：规则内核全部逻辑——推进、卡牌效果与叠加顺序、发牌派生、橡皮筋 AI、输入编码解码。固定 seed、mock 时钟，零 IO。核心算法分支覆盖 100%。
- **L2（`tests/api/`）**：只有一件事——`ChainPort` 的契约测试。mock 实现与接口定义的一致性、`RaceResult` 编码解码的往返相等。**这份契约测试是给将来的真实实现准备的**：真实实现接上时，同一份测试必须原样通过。
- **L3（`tests/e2e/`）**：第 2 节的完整动线，关键节点截图核对。

//TODO - 交互回归：`bun run scripts/race-sweep.ts --seeds 2000`，每个 seed 使用固定的合法输入序列、放弃序列、超时序列和刷新序列各跑一次。判据：五匹马都结束，名次为不重复的 1–5，三次检查点记录数量与实际触发一致，编码解码往返相等；不比较策略优劣或卡牌强弱。

## 8. 一键启动

`scripts/dev.sh` 按全局规范提供：环境自检与缺失提示、端口占用检测与释放、启动 Vite、健康检查确认就绪。本项目只有前端一个组件，脚本不必复杂，但入口必须统一。

React 相关的体检由用户自行执行 `npx -y react-doctor@latest`，不由 agent 代跑。
