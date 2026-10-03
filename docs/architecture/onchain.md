# 链上架构

## 1. 权威边界

Monad 上的 `PonyGame` 以固定规则版本、入场 seed、选择卡牌和随机效果的实际区块哈希和五马状态等必要条件，独立复算冲线名次。浏览器运行相同规则用于即时画面与预览，不是付款裁判。规则详见[玩法设计](../game-design.md)与[卡牌设计](../card-design.md)。
每场比赛在入场和结算时写链，选择卡牌时产生小笔交易。

```text
Mera 通行密钥 → 根 EOA → Alchemy sma-b → Monad
       │              │                         ├─ PonyGame → PaidRaceSolver
       │              └─ owner / recovery       └─ PonyVault (原生 MON)
       └─ 独立 PRF 命名空间 → 图鉴密钥

浏览器：规则预览、交易发起与状态恢复
Envio：合约事件的可回滚历史与统计
图鉴 Worker/D1：仅同步浏览器加密后的图鉴密文
```

## 2. 账户、资产与授权

保持现有 Mera 根 EOA 的 WebAuthn PRF、BIP-39/BIP-32 派生路径及地址。由该 EOA 拥有并恢复独立 Alchemy Modular Account V2（`sma-b`），显式 `createAdditional: true`，持久记录每条链上的账户地址；不要把根 EOA 当成默认同址 EIP-7702 账户。[Alchemy 账户类型](https://www.alchemy.com/docs/wallets/transactions/using-eip-7702)、[Monad EIP-7702 规则](https://docs.monad.xyz/developer-essentials/eip-7702)。

项目只使用 Monad 原生 MON，不部署或依赖 ERC-20/WMON。Vault 通过 `payable` 入账、按 wei 记账并以原生 MON 返还；用户钱包余额与 Vault 偿付余额均读取原生币余额。图鉴解密仍用独立 PRF salt；图鉴密钥不签交易。Agent Session Key 只获 PonyGame 指定入口权限、有效期和链上累计下注上限，禁止任意转账、提款和 owner 修改。临时 Action Key 不作为结果权威。

入场可在一次智能账户确认中批量完成 `deposit{value: 差额} → openSession`（Vault 可用余额已够则只发 `openSession`）。下注从 Vault 的玩家可用 MON 余额锁定；不需要 ERC-20 授权。浏览器跟踪调用 ID 与交易哈希，状态不确定时先读链上会话状态再决定是否重试。免费本地试玩与有奖链上会话分离，不能用免费试玩结果领取链上奖金。

## 3. 合约与资金不变量

部署 `PonyGame` 和 `PonyVault`。Vault 固定资产与唯一 Game 地址；Game 固定 Vault 地址。管理员可暂停新入场、管理庄家流动性，但不得修改已开场规则、提取用户可用余额或占用已锁定的下注。求时器与 `rulesetHash` 在 `PonyGame` 构造时固定；换规则即部署新求时器、新 `PonyGame` 与新 `PonyVault`，已有会话由旧 Game 按其求时器结算或判负。**Vault 不设退款。**

定义 `A` 为用户可用余额总和、`L` 为未结算下注总和、`H` 为庄家自有流动性、`R` 为最大庄家净赔付预留总和：

```text
address(Vault).balance >= A + L + H
H >= R
R(session) = max(maxPayout - stake, 0)
```

开场时从用户可用余额锁定下注并预留最大净赔付。结算时 `PonyGame` 按求时器给出的 `settlementOrder` 计算赔付，调用 `settleStake(sessionId, payout)`；Vault 只接受 `PonyGame` 的调用，且要求 `payout` 不超过锁定的最大赔付，随后原子释放预留并记入实际返还。判负由 `forfeitSession` 执行：所需随机锚过窗永久不可读时任何人可调用；求时器故障时仅 owner 可在开场 1 天后调用，并先以 `FORFEIT_PROBE_GAS` 预算探测结算预览确实失败。判负按返还 0 处理：下注转入庄家流动性并释放预留；判负与结算互斥；玩家放弃某个检查点的选牌不判负。庄家仅可提取 `H - R`。转账前先扣账并防重入；Envio 或管理员不能调用 Game 专用记账入口。

## 4. 比赛输入、真实时间与随机锚

`openSession(horseId, stake)` 锁定 `sessionId`、玩家智能账户、选中马、下注档位、seed、入场交易区块 `b_0` 和该块的 `block.timestamp = T0`；`rulesetHash` 与各名次赔率是 `PonyGame` 的不可变常量，不随会话存储。seed 由合约按 `(chainId, Game, 玩家, 单调 nonce)` 确定性导出（`PaidSeed`），不接受玩家传入。入场块哈希在后续块读取并链上封存；玩家 14 张牌堆与 CPU 私有牌堆由 `H(seed, blockhash(b_0), 0, purpose, eventIndex)` 派生，牌堆固定取完整的 40 张卡池，不引入卡集合或拥有资格；四匹电脑马的基础参数按下注档位区间由同一锚派生，玩家马参数固定。

`chooseCard(sessionId, checkpoint, cardId, refreshSlots)` 记录实际交易的入块秒 `Ti = block.timestamp − T0`、区块号 `b_i` 和输入，`cardId = 0` 表示主动放弃该检查点。每个实际选择块哈希在后续区块验证并封存：`chooseCard`、`settleSession` 与公开的 `sealAnchors` 都会封存当时可读的锚，客户端不需要单独发送封存交易。锚先直读 `BLOCKHASH` 的 256 块，之后读 [EIP-2935](https://eips.ethereum.org/EIPS/eip-2935) 历史合约至 8191 块（约 47 分钟，`RandomAnchor`）；超窗仍未封存即视为丢失，任何人可 `forfeitSession`。C-09 的全部自动交换始终从获得该卡的 `b_i` 派生，用触发序号域分离。自动选牌从已锁定的上一阶段锚派生；主动放弃、超时和断卡不生成新随机锚。

**权威规则时间使用链上可读的秒级时间，不使用区块高度换算比赛时钟。** 正常阶段模拟时间以 `dτ/dt=1` 推进，选牌慢放阶段为 `0.1`；合约从 `T0`、各 `Ti`、由赛马状态推导的检查点开启时刻与 20 秒截止时刻建立时间区间，直接求冲线用时。客户端 `performance.now()` 只负责流畅画面和待确认预览。若浏览器停止运行，链上规范时间仍前进，恢复页面必须从已锁定交易时间重新求时；不得提交本地声称的暂停时长或完成 tick 当作权威事实。

检查点精确规则开启时刻为 `openMs`，选择窗口用 `openSec = ceil(openMs / 1000)` 至 `openSec + 20`（末端不含）。`chooseCard` 对每个检查点只记录第一笔交易，只做形状检查：玩家本人、检查点 1..3 严格递增、`cardId ≤ 40`、刷新数 ≤ 3、刷新位置 ≤ 2。`Ti` 是否落在 `[openSec, openSec + 20)`、候选与刷新额度是否合法由结算求时判定，违规的选择按无交易处理并记 `CHOICE_INVALID`，该检查点不能重发，所以由浏览器负责不提前、不过晚发送：候选 UI 在 `openMs` 展示，到 `openSec` 才允许提交；规范效果时刻为 `Ti × 1000ms`，超时在 `(openSec + 20) × 1000ms`。这最多增加不足 1 秒的面板等待，却避免秒级时间戳把检查点前交易误认成有效选择。

选择交易的 `Ti` 以秒计，最多只能证明秒级规范动作时间，不能证明鼠标点击的毫秒瞬间。浏览器必须在交易确认后将画面校正到规范时间线；若要求毫秒级真实墙钟一致性，纯链上时间戳不满足，需新的可信计时来源。自动选牌/超时不等别人发送“唤醒”交易，但其结果必须能从此前链上输入唯一推导。链重组时按 canonical 区块时间与哈希重新求时。[Solidity `block.timestamp` 单位](https://docs.soliditylang.org/en/latest/units-and-global-variables.html)。

**区块哈希是可复核的随机输入，不自动保证绝对无偏。** 正式资金场次还须检验交易排序、选择性不提交与可重试开场的偏差；若风险不可接受，改用独立 VRF 或承诺揭示，而非声称 blockhash 单独解决公平性。

## 5. 链上解析求时与结算

`PonyGame.settleSession(sessionId)` 不接收可付款名次、完成时间或浏览器终态。合约从本场已锁定的 seed、入场哈希、选马与档位、五马参数及 CPU 私有卡、刷新/放弃、每次实际选择的 `Ti/b_i/cardId` 和对应已核验区块哈希，**直接求出五匹马各自首次跨过终点的 `finishTime[0..4]`**。用 `(finishTime, horseId)` 升序得到物理排序 `rawOrder`（玩家名次 `rawRank`）。随后从规范获得的卡牌集合检查【版本答案】；触发时把玩家置于结算排序 `settlementOrder` 第一，其余马保持物理相对顺序（玩家名次 `settlementRank`）；否则两者相同。`PonyGame` 按玩家在 `settlementOrder` 中的名次计算赔付。特殊分支是合约规则，不是客户端可写的 `forcedRank`。

求时器运行一个有序事件表，而不是按固定步长或浏览器帧循环：

1. 初始化五马位置、累计里程、性格基础速度、体力、有效百分比 `P`、固定值 `K` 和卡牌状态；以 `T0` 为现实时间起点，选牌阶段按 `dτ/dt=0.1` 映射模拟时间。
2. 无重力井的区间，对每匹马用 `b(τ)=min(C,b₀+a·Δτ)`、`v(τ)=max(0,b(τ)·(1+Σp)+Σk−E)` 的解析积分，解出最早的速度达上限、体力见底/回满、里程检查点、静态炸弹碰撞与冲线时刻；卡牌到期、每 2 秒交换、风火轮叠层、已锁定选择时间也各提供候选事件。
3. 重力井生效时，`P_i(τ)` 含随目标与持有者实时距离变化的场项；五马运动耦合，使用规则版本冻结的定点数值积分（步长不超过 50 ms 的 RK2，被事件截断），并在积分中定位炸弹、检查点、C-40 里程与终点的首次越过（最小整数毫秒）；场项取步中点值，不定位场边界。不能取触发时距离快照，也不能把渲染帧当积分步长。
4. 取全场最早事件，推进五马到该时刻，按固定优先级结算并建立下一段；直到五匹马都有首次 `pos >= L` 的规范时间。交换只跳变 `pos/laneIndex`，不凭空增加 `dist`；马可因交换在事件时刻冲线。
5. 结算事件保留 `finishTime`、`rawOrder` 与 `settlementOrder`；`PonyGame` 按经合约检测彩蛋后的 `settlementOrder` 计算赔付。浏览器在回执后用同一 TS 求时器与 `SessionSettled` 逐字段比对，只提示不一致，不上链，也不进入赔率或付款公式。

重力井的场修正为 `p_target(τ)=±0.3·max(0,1−|pos_target(τ)−pos_owner(τ)|/r_well)`（`r_well` 为规则表 `radiusMicro`，即 8000 单位），符号由实时前后关系决定；持有者变化、赛道交换和越过场源都会改变场方程。天气方向在触发时固定直到替换。C-09 的随机目标由原卡选择区块哈希与触发序号决定。只有**无动态场**的区间可把百分比视为常量，位移积分化为至多二次多项式；动态场区间需解耦合轨迹，不能用逐 tick 回放作为结算备用路径。

例如在未达性格上限、`P` 与 `K` 不变的 `Δτ` 内，`Δpos=(1+P)·(b₀·Δτ+a·Δτ²/2)+K·Δτ`；到上限后把剩余时段改为线性。体力流率、卡牌到期或跨马事件若更早发生，必须先截断区间，不能把公式套过事件边界。根的取整方向、定点舍入、零速、同刻事件与并列名次顺序都由 `rulesetHash` 冻结，浏览器与 Solidity 使用同一组测试向量。

十五次仅是五马卡牌**挂载**上限，不是事件数上限；自动交换、叠层、死亡、体力循环仍会产生事件。规则冻结的上限：最长比赛时间 `MAX_TAU = 600000` ms、事件数 `MAX_EVENTS = 4096`、效果实例 `MAX_INSTANCES = 96`、炸弹 `MAX_BOMBS = 20`，越界抛错而不是静默截断。全部运算为整数，冲线时间量化到 1 ms（取满足 `pos ≥ L` 的最小整数毫秒），同毫秒并列按 `horseId`。重力井积分误差与最坏合法场次 gas 的验收记录在[链上服务交付](../plan/onchain-services.md)；若最坏场次超 Monad 单笔 gas 限制，有奖版不能退回浏览器名次或逐 tick 合约循环。[Monad gas 规则](https://docs.monad.xyz/developer-essentials/gas-pricing)。

第三个实际检查点完成选择/放弃/自动处理且所需哈希可读后，输入已齐，任何人都能提前调用同一求时器预计算；前端仍等玩家冲线才展示结果。未到第三检查点就冲线的场次仅纳入已发生事件。结算交易须满足 `(block.timestamp − T0) × 1000 ≥ finishWall[玩家]`（`finishWall` 含选牌慢放映射），不接受浏览器提供的完成证明。

## 6. 事件与查询

`PonyGame` 发 `SessionOpened`（sessionId、玩家、马、下注、seed、`openedAt`、`openedBlock`、`rulesetHash`）、`CardChosen`（检查点、`cardId`（0 为主动放弃）、刷新位置、`txSec`、区块号）、`RandomAnchorSealed`（源区块与实际哈希）、`SessionSettled`（`finishTime[5]`、`rawOrder`、`settlementOrder`、玩家结算名次、返还、`digest`、实际获得的三张牌）、`SessionForfeited`（含判负原因）；Vault 发充值、提款、`StakeLocked`、`StakeSettled`（判负为返还 0）和庄家资金事件。Envio 按合约事件建立比赛历史、玩家战绩、马匹胜率与 Vault 统计。RPC/合约决定资金与会话状态；Envio 仅作可回滚的读模型，不能决定付款。链重组后按最终 canonical 事件重算统计。

## 7. 验收门禁

跨语言向量、Vault 不变量、最坏路径 gas、测试网时延和剩余上线门槛统一记录在[链上服务交付](../plan/onchain-services.md)。修改已部署规则时，须重新跑该记录定义的向量与 Foundry 门禁，并部署新的求时器、`PonyGame` 与 `PonyVault`；有奖结算不得依赖浏览器自报名次、退款入口、Game Server 或逐 tick 链上回放。
