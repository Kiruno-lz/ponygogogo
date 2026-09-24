# 最小 Demo 计划

## 1. 边界

本地 Demo 已有完整页面动线和真实 Mera 测试网钱包，但比赛入场、选牌和结算仍由 `ChainPort` mock 处理；它不具备可付款的排名证明。此文档只定义免费本地演示与素材/页面验收，有奖版本的玩法和信任边界以[玩法设计](../game-design.md)、[链上架构](../architecture/onchain.md)与[交付计划](delivery.md)为准。旧浏览器规则、旧端口字段和 mock 返还不得限制新的链上协议。

## 2. 演示动线

```text
启动 → 加载 → 登录/注册 → 选马 → 本地下注 → 倒计时
     → 五马竞速 → 检查点选牌/放弃 → 玩家冲线 → 本地预览结果
     → 分享/再来一局
```

钱包地址、测试币余额、领取与导出走真实 Mera/RPC；本地游戏余额与链上代币余额必须分开列示。mock 结果不显示真实结算交易哈希，也不宣称已获链上奖金。当前代码仍是 gogo 加速/体力耦合和橡皮筋电脑马的旧实现；待迁移目标为五马体力支付固定加速度、性格基础速度上限、百分比效果乘当前基础速度且相加、固定值效果在百分比之外相加、力竭回满后解除、C-09 四赛道自动交换、C-11 满层固定值爆发、重力井实时距离场，以及按真实时间运行的 0.1 倍选牌慢动作。

质量门禁：五马都能结束、检查点与选牌状态不重复、同一 seed/选择交易时间/区块哈希在浏览器内确定性重放、渲染帧率不改变规则终态；gogo 输入改变后目标规则状态不变。免费 Demo 的 mock 测试不构成链上复算证据。

## 3. Mock 与真实链边界

`src/chain/mock.ts` 是免费演示适配器，`receiptId` 只能是本地标识，不叫 txHash。浏览器的 `RaceResult` 是预览/调试记录，不是将来合约接受的结果声明。真实链实现必须增加开场、每个实际检查点选择、随机锚封存、合约复算结算或超时退款；不能只把 mock 的 `settleRace(result)` 换成 RPC 调用。

//TODO - 在切换到有奖模式前，用 Foundry 证明浏览器自报任意名次不影响返还，选牌区块哈希与规则版本可核验，最坏五马模拟能在单笔 gas 上限内完成。免费 mock 与测试网资金路径应在 UI 上明确区分。

## 4. 目录结构

```text
src/race/            纯规则内核：推进、卡牌效果、发牌派生、输入编码。不 import 任何渲染/DOM/链
src/race/cpu/        电脑马自主运动
src/race/__vectors__/ 确定性终态向量
src/game/            Phaser 场景、插值渲染、镜头
src/cards/           卡面组件与三段动画
src/result/          结算展示
src/export/          出图与分享
src/assets/          资源清单、加载器、AssetSource 抽象
src/ui/              首页、加载页、选马、HUD、设置、i18n
src/chain/           network.ts 网络与端点、derive.ts 账户派生、wallet.ts 通行密钥钱包、
                     faucet.ts 领测试币、store.ts localStorage 封装、port.ts + mock.ts 比赛端口
scripts/dev.sh       一键启动
tests/e2e/           Playwright
```

`src/race/` 单向依赖是这套结构的核心：它能在纯 Bun 环境里跑完整场比赛，因此规则向量的批量模拟不需要浏览器；这一边界也是 Solidity 逐字段比对的前提。

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

下载与入库由 `scripts/fetch-assets.sh` 完成：拉取上述包、解压、只挑用得到的文件进 `art-src/placeholder/`、生成清单。目录名带 `placeholder` 是为了让替换时一眼看见范围；脚本要幂等，重复执行不产生重复文件。

**素材缺口要说在前面，不要假装凑齐了：**

- **[卡牌设计](../card-design.md)要求的装备是挂到骨架插槽的持久对象（火箭喷射器、黑洞、风火轮），没有任何现成的 CC0 横向侧视素材包能满足。** 占位阶段不把装备画在马身上：马的身份用**色相旋转 + 号码布数字**表达，装备与 Buff 一律以图标形式出现在 HUD 和卡面上，规则照常运行。这正好对上卡牌设计 §1 的「规则与表现单向依赖，美术缺失时规则照常运行」——占位阶段就是那个美术缺失的状态，不是把它当缺陷绕过去。
- 五匹马靠色相旋转区分，不找五套素材：`hue = f(horseId)`，确定性映射。这正好对上「马由 `horseId` 标识、`laneIndex` 只是可变站位」——换赛道不换颜色，玩家跟得住自己那匹。
- Kenney 的 Music Jingles 是几秒的短提示音，**不是循环 BGM**，两者不能互相顶替。长 BGM 必须单独挑，且要确认首尾能无缝循环，否则每轮接缝都会有一声爆音。

### 5.1.1 音频设计

音频不是贴上去就完事，有两处跟规则直接咬合：

- **gogo 音效只确认镜头输入。** 点击频率可以改变镜头位置和反馈密度，不得暗示加速、体力消耗或排名变化。
- **另需一个进入【力竭】的明确提示音。** 那一刻按钮会锁死，没有声音玩家只会以为游戏卡了。力竭解除也要有声音，否则玩家不知道什么时候能重新按。
- **抽卡慢放不做单独的音乐素材。** 0.1 倍慢放期间给 BGM 挂一个 Web Audio 的 `BiquadFilterNode`（低通）并降低 `playbackRate`，出来就是"时间被拉慢"的听感，恢复时反向过渡。这比切一首慢版 BGM 省素材，也不会在切换点断音。

音效清单（最小集）：按钮点击/悬浮、卡牌发牌、卡牌悬浮、卡牌选定、卡牌刷新、倒计时滴答、起跑枪、gogo 镜头点击、进入力竭、力竭解除、检查点通过、冲线、结算展开、胜负 jingle。

### 5.1.2 组件动效规范

动效是 Demo 的验收内容，不是素材有余力时再补的装饰。所有动效只使用 `transform`、`opacity`、颜色或阴影，不得引起布局跳动；动效从表现层状态差异触发，不能反过来驱动规则状态。

| 组件 / 触发 | 动效要求 | 默认时长 |
| --- | --- | ---: |
| 任意可用按钮 `pointerdown` / 键盘按下 | 立即缩放至 `0.94`，释放后带轻微回弹至 `1.0`；按钮不可用时不播放按下态 | 160ms |
| `gogo` 按钮每次按下 | 在通用按下缩放上叠加一次完整旋转；缩放轨迹为 `0.88 → 1.08 → 1.0`，旋转轨迹为 `0° → 360°` | 260ms |
| 马匹或 HUD 状态新增 | 对应状态图标/徽章先缩小到 `0.65`，放大到 `1.18` 后回到 `1.0`，同时左右摇晃 3 次（最大 ±6°） | 260ms |
| 已有状态增加一层 | 只对状态图标/层数徽章播放一次同样的缩放与摇晃；普通 tick 更新计时器或层数不变时不得重复播放 | 260ms |

状态新增与加层必须由一次明确的表现事件触发；事件连续到达时重置当前组件动画，不排队堆积动画。`gogo` 的旋转与按钮缩放只表达“输入已被按下”，点击不由规则内核处理，动画不得写入输入记录、改变 tick 或改变名次。

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
  keysOf(tier: AssetTier): AssetKey[]   // 按级取 key，同样不暴露路径
}
```

- `LocalAssetSource`：从构建产物读取 `manifest[key].path`，通过浏览器资源加载事件报告完成。
- `RemoteAssetSource`：从 `${gateway}/${manifest[key].cid}` 读取，成功后返回 Blob URL；gateway 只存在于 source 构造参数，调用方不拼接路径。

`manifest` 是一张 `key → { kind, path, cid?, bytes, sha256, tier }` 的表，随构建生成。加载器按 `kind` 选择图片、音频或 Phaser 纹理的验证方式；调用方只认 `key`，永远不拼路径——**这是将来换成远程加载时唯一不用改的保证**。当前 Demo 先实现 `LocalAssetSource`，`RemoteAssetSource` 只保留同一接口的测试替身，不提前接入分布式储存服务。

#### 分级加载

`tier` 的语义是「在哪个阻塞点之前必须就绪」，四级：`boot`（加载页自身）、`home`（首页）、`race`（选马、下注、比赛、选牌、图鉴、设置）、`result`（结算页）。归属由 `scripts/measure-display-sizes.ts` 实测每张图首次出现在哪个页面得出，不按目录猜。

- **进首页只等 `boot`+`home`**（实测 1.83 MB / 17 项，全量是 7.79 MB / 142 项）。加载页的进度只统计这两级，而且 `done` 只数真的进了缓存的项——**100% 必须真的等于「可以进首页了」**，失败项计入 done 会把进度条变成谎话。
- **`race`、`result` 在首页渲染之后后台预取**，顺序固定 race 先于 result：玩家下一步一定是点「开始游戏」。
- **每个页面进去之前用 `ensureTier` 兜底**。预取正常跑完时它是一次 `isTierReady` 判断，零成本；没跑完就挂到同一个在途 promise 上等，预取失败过就在这里补一次。
- 分级不是「缺了就降级渲染」：Phaser 纹理必须预加载，中途缺纹理是运行时崩溃而不是降级。

缺 `tier` 字段的清单直接报错，不按最早的级兜底：产物一定带 tier，缺失只说明清单来自旧构建，而兜底会让整份清单退化成「全部阻塞」——分级被悄悄抹掉而表面一切正常，比直接报错难查得多。

加载页与兜底遮罩的硬要求：

- 逐项进度，不是一个假的定时进度条。
- **失败必须可重试且指明失败项**，不能白屏。远程加载迟早会失败，这条现在不做，将来接远程时就得重做加载页。
- **失败记录按级隔离**。前台加载和后台预取是并发的，共用一份 failures 数组会互相覆盖；每一级各记各的，重跑一级只补没进缓存的项——失败项和从没试过的项本来就是同一回事，不需要单独的重试队列。
- 阻塞级失败停在加载页；后台级失败不打扰首页，玩家真的点进那个页面时才拦，给明确错误和重试入口，底下那一页照常渲染。

//TODO - 加载失败路径验证：断网、单个资源 404、gateway 超时三种情况各跑一次，判据为都停在加载页并给出可重试的明确提示，无白屏、无控制台未捕获异常。远程实现落地前用 mock 的 `AssetSource` 注入这三种失败（`?mockAssetFail=<key>` 按 key，`?mockAssetFailTier=<tier>` 按级）。

## 6. 演示验收

先保持现有可玩的免费 Demo；目标玩法迁移按[交付计划](delivery.md)执行：将 gogo 移出规则，五马统一加速度/体力状态，百分比卡乘当前基础速度、固定值在乘法外直加，C-09/C-11 改自动规则，保留重力井连续距离场与版本答案特殊结算，再以固定 seed、链上秒级时间与区块哈希向量对比浏览器和合约。真实资金路径只在链上复算与 Vault 不变量都通过后启用；未给定的体力消耗和风火轮爆发幅度不能由旧点击公式继承。

## 7. 测试分层

免费本地 Demo 按全局工程规范分层；有奖版本新增 TypeScript/Solidity 跨语言向量与 Foundry 合约测试，不能用下列 mock 测试代替：

- **L1（`bun test`，持续跑）**：规则内核全部逻辑——推进、卡牌效果与叠加顺序、发牌派生、独立 CPU、选择/区块哈希编码解码。固定 seed、mock 时钟，零 IO。核心算法分支覆盖 100%。
- **L2（`tests/api/`）**：两份契约测试。`ChainPort` 那份断言 mock 实现与接口定义的一致性、`RaceResult` 编码解码的往返相等，**它是给将来的真实实现准备的**——真实实现接上时同一份测试必须原样通过。钱包那份跨 WebAuthn、RPC 与水龙头 HTTP 三个外部契约，三者全用注入替身，断言的是我们这一侧的协同：注册与登录落在同一个地址、全程不往持久存储写任何东西、多把密钥各自独立、导出助记词取的是当前账户那一把、余额来自 RPC、领水失败不阻断注册、失败被分类成可判别的错误码。
- **L3（`tests/e2e/`）**：第 2 节的完整动线，关键节点截图核对。

钱包动线在 `tests/e2e/specs/wallet.spec.ts`，用 Chrome 的 CDP 虚拟认证器（`WebAuthn.addVirtualAuthenticator`，开 PRF 扩展）驱动真实的 mera 代码路径，RPC 与水龙头在路由层拦下，不打测试网也不消耗水龙头额度。它证明的是代码路径正确，证明不了设备差异——后者只能人工实测，清单见[交付计划](delivery.md)。

//TODO - 交互回归：`bun run scripts/race-sweep.ts --seeds 2000`，每个 seed 使用固定的合法输入序列、放弃序列、超时序列和刷新序列各跑一次。判据：五匹马都结束，名次为不重复的 1–5，三次检查点记录数量与实际触发一致，编码解码往返相等；不比较策略优劣或卡牌强弱。

## 8. 一键启动

`scripts/dev.sh` 按全局规范提供：环境自检与缺失提示、端口占用检测与释放、启动 Vite、健康检查确认就绪。本项目只有前端一个组件，脚本不必复杂，但入口必须统一。

React 相关的体检由用户自行执行 `npx -y react-doctor@latest`，不由 agent 代跑。
