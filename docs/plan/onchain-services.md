# 链上服务交付

## 当前执行状态（2026-10-03）

本节只记录当前实现状态、验证证据与剩余计划。当前阶段正式上线范围仅为 Monad 测试网，不包含主网；创建账户自动领取 1 MON 测试币等机制仍保留。经济与最坏 gas 验收按项目决策延后；当前下一步是 Envio 游戏站点来源接入验收。

| 范围 | 状态 | 证据与下一步 |
| --- | --- | --- |
| Mera 根 EOA 与 sma-b 账户模型 | 已实现 | `src/chain/wallet.ts` 以通行密钥 PRF 派生根 EOA（地址与派生路径不变），登录/注册时解析并记住 sma-b；根 EOA 只签名，水龙头与显示余额都指向 sma-b。`migrateRootFunds()` 把根 EOA 余额（扣 gasLimit×maxFee）转入 sma-b，到账不足 0.001 MON 跳过；EOA 交易显式填 nonce/chainId，避开 Monad `eth_fillTransaction` 以节点费率覆盖本地费率导致余额不足；同一根 EOA 3 块内不得重复清空（Monad 保留余额规则），界面禁止重复提交 |
| Mera 独立图鉴 PRF | preview 实测通过；生产 Worker 未部署 | `wallet.ts` 以独立 PRF 命名空间派生 AES 密钥与 Ed25519 身份；`collectionCipher.ts`/`collectionSync.ts`/`scripts/Wrangler/worker/collection.ts` 完成一次性挑战、验签、`expectedVersion` 条件写密文。D1 迁移位于 `scripts/Wrangler/migrations/`。preview Worker `https://ponygogogo-preview.kiruno-ldz.workers.dev` 与两套 D1（0001/0002 已迁移）可用，临时身份完成空读、首次写入、解密恢复、版本冲突，挑战按 ID 签名且按来源每分钟限 30 次。真实通行密钥在正式域名的往返与赛后奖励写入未验收 |
| `PonyVault` 原生 MON 账本 | 新资金路径本地验收通过，尚未部署 | `contracts/PonyVault.sol` 只接受 Game 的 payable 下注登记，直接向玩家智能账户支付结算返还，维护 `L/H/R` 不变量；Foundry 8 项 Vault 测试含 256 轮随机账务。已部署旧版地址与注资交易保留在测试网记录中，不作为新路径部署证据。 |
| 规则基础件（两端） | 已实现并由求时器调用 | 开场 seed `paidSeed`、熵 `chainEntropy`、性格 `paidProfiles`、玩家 14 张牌堆 `paidDeck`（40 张资格，末两张稀有）、电脑马 3 张牌堆 `paidCpuDeck`、发牌状态 `paidDrawRules`、交换目标 `paidSwap`、赔率 `RacePayout`、名次与版本答案 `paidSettlement`，Bun/Foundry 向量逐字段一致。40 张卡的有奖效果类型、数值与资格由 `src/race/paid/cardRules.ts` 统一提供，生成 `contracts/libraries/PaidCardRules.sol`（打包表解码，`get()` 解码结果与 TS 表逐项相等，共享数值参数参与哈希），表哈希 `0x5fe93ed7…143912`、规则哈希 `0xbb2c9df7…dae876`。旧分片参考件已两端连同测试删除，回归测试改为冻结字面值 |
| `RandomAnchor` 与锚封存 | 已集成并在测试网实测 | `contracts/libraries/RandomAnchor.sol` 通过 BLOCKHASH 与 EIP-2935 读取入场及选择区块哈希；同块拒绝、窗口边界、锚封存和过窗判负由 Foundry 与测试网流程覆盖。 |
| `PaidRaceSolver` 求时器 | 单体与 250 ms 规则本地验收通过；Monad 只读探针通过，尚未部署 | `PaidRaceSolver` 内联 Engine/Motion/watch/gated 与 `PaidRaceCold`，Engine 唯一持有比赛内存；冷路径保留领域库，构造不部署辅助组件。runtime 35,144 B、initcode 35,172 B，Monad 体积门禁通过且无库链接。355 场跨语言向量逐字段、事件与 digest 一致；80 场固定生产输入 Foundry 冷调用均值 2.932M、最大 4.701M，Monad state override 均值 2.420M、最大 3.854M，80/80 完整结果哈希与对照研究一致；对抗诊断内核在 Monad 为 3.599M。116 项 Foundry 测试含无辅助合约构造回归；anvil 验证单井、重叠井、真实 Game 会话与 Solver nonce=1。150 s 单井投影为 600 步、5.828M Foundry gas，不是可达最坏输入证明。复现：`forge test`、`bun run check:contracts`、`bun run check:paid-vectors`、`bun run check:solver-monad`。 |
| 测试网部署（协议 v2 / 规则 v3） | 测试网已部署并通过真实会话；测试网有奖入口开放；规则 v4（40 张卡，重力井 3000 bps）尚未部署 | 以下为已部署的 v3 记录。部署者 `0xB2Cd…960e`：PaidRaceSolver `0xc3193E71AA2A9C527Fd7B6Ae9B715d756e73880A`（辅助 PaidRaceSupport `0x339FFc6bF7d0cB360386943efade025e104A2880`）、PonyGame `0x92428770e79A95377c641F2Da9C9D97F4AA899c8`（块 66458114）、PonyVault `0xb1677bc7bceD53612f9569ac42eE752081485282`（块 66458121）；部署、绑定、注资 3 MON、开放入场合计 14,673,411 gas、1.496688 MON；规则哈希 `0x5ff01a27886c1cad8a1d286cf2bb15280f711d7133ab3377b375855bf5d3f84b`、绑定、体积与偿付链上核对一致，Sourcify 四份 `exact_match`；`.env` 已指向新地址。会话 `0xc214e38e…91f2`（sma-b `0x9C6E…6894`，马 2，0.3 MON）三次真实选牌均在窗口内生效（20/39/57 s 开启，23/42/61 s 入块），`previewSettlement` 与 `SessionSettled`（含 `acquired [15,25,13]`）和 `solvePaidRace` 逐字段一致，第 3 名返还 0.3 MON 并提回 sma-b。bundle gas：开场 0.61M、选牌各约 0.285M（v1 为 0.83/1.38/3.63M）、结算 6.90M、提款 0.27M；提交→入块 p50 1,583 ms、最大 1,843 ms，入块→最终确认 p50 1,645 ms。保管人空跑无待办。旧 v1 合约（Game `0x221E…BF57`、Vault `0xfb66…ebc5`）已暂停入场并取回庄家资金，测试玩家 0.05 MON 留在旧 Vault。//TODO - 部署规则 v4 的求时器与 PonyGame，核对 `rulesetHash`、体积与偿付后切换 `.env` 地址，并按「有奖规则 v4」重跑真实会话。 |
| 庄家流动性 | 测试网注资已确认 | 2026-09-29 从 Vault owner `0xB2Cd1aBBb940D612A71e545067C05f900B32960e` 调用 `fundHouse()` 注入 30 MON 至 Vault `0xb1677bc7bceD53612f9569ac42eE752081485282`；交易 `0x304dd1e559791ccf4b50fc583a4f95e26c320c2c74cdd94279e15b9e33f4dc9d`，块 66613076。回执成功后 `houseLiquidity = 33.3 MON`、Vault 原生余额 `33.3 MON`、`reservedLiquidity = 0`，偿付不变量成立。
| Alchemy 独立 `sma-b` | 受赞助交易已在测试网实测 | 临时密钥的 sma-b `0x39fFB4053194CD91D266491C2057A053cD62bB5D` 经 Policy 赞助完成首笔调用 `0x60f54da115099fced65f66620f90a733142ee30b3b58816bac8be2664dbe90f9`（块 66074666，EntryPoint v0.7，gasUsed 344157，提交到入块约 2.9 s，sma-b 余额前后均为 0）；首笔调用部署账户，反事实地址重复请求不变，可接收原生 MON。调用目标为 sma-b 自身报 `AA23`，余额不足的带值调用在 `prepareCalls` 失败。Alchemy 控制台只读记录（2026-09-29）：Policy Active，仅 Monad Testnet；总交易数上限显示 200，单钱包上限显示 0；金额上限字段显示总额 $0、单钱包 $0、单笔 $10。Access control 为 None（无地址限制），Webhook custom rule 未配置；API key 与 Policy ID 是浏览器端公开配置。 |
| Agent 限权会话 | 权限与预算已写，真实授权未执行 | `contracts/abstracts/AgentBudget.sol` 账户级累计额度/到期/撤销，Foundry 2/2；`openAgentSession` 在 Vault 锁注前检查并扣减授权预算 |
| 会话资金协议 | 新路径本地实现，尚未部署 | 智能账户 → payable Game.openSession → payable Vault.lockStake 在同笔开场内完成；Game.settleSession 发起 Vault 直接付款，保留下注锁与净赔付预留，移除玩家可用余额和充值/提款入口。Foundry 全量 116/116；源测 898 通过、11 项缺失马匹母版跳过；钱包浏览器动线 4/4。anvil 两场真实 Solver 会话的三次正常选择与无效选择重放，结算与 TS 逐字段一致并直接付款；API 全量 66/66，钱包与资金对照通过。//TODO - 部署新 Game/Vault 并切换地址后验收真实智能账户会话。 |
| 浏览器余额/下注 | 新路径本地验收通过；等待新 Game/Vault 部署 | `src/chain/mock.ts`、`port.ts` 已删除。`src/chain/funds.ts` 只读取 sma-b 原生余额；钱包面板不提供 Vault 游戏余额或充值/提款入口。当前资金协议的本地实现与旧部署记录分别列示。有奖会话由 `src/chain/paidSession.ts`（开场直接支付完整下注、回执解析 `SessionOpened/CardChosen/SessionSettled`、回执块哈希即锚、失败或超时先读合约再决定重试、`sessionOf`+`getSession`+RPC 块哈希恢复）、`chainClock.ts`（以块时间戳上下界估计链上时钟，误差约 ±0.5 s 加一次 RPC 往返）与 `src/race/paidDriver.ts` 驱动：每帧本地时钟→链上时间→`wall`→`τ`，显示时间以 0.25×–3× 追随且不倒退，超过 5 s 的缺口直接跳转；下限过 `openSec` 才发送选择，上限到 `openSec+20−余量` 停止接受点击（Alchemy 余量 5000 ms，anvil EOA 2000 ms），点击后按预测入块秒重解，回执到达后按真实 `txSec`/锚重解，位置差 700 ms 内衰减；被拒选择按超时重解。玩家冲线显示「待链上验证」，链上时间过 `ceil(finishWall/1000)·1000+300 ms` 自动结算，`RaceNotFinished` 自动重试两次，结果页以 `SessionSettled` 展示名次、返还、净值与交易链接。登录发现未完结会话时弹窗继续比赛或去结算。开关：`PAID_RACE_FEATURE = true`，有奖档位只在两个合约地址均已配置且进入选择页时经 RPC 确认两处都有合约代码后可选（`paidContractsDeployed`/`paidEntry`；未部署、未登录、确认中各有提示，RPC 失败下次进入重试）；E2E 由 `tests/e2e/isolatedEnv.ts` 显式清空合约地址并指向拦截主机，复用以 `.env` 启动的服务器时整轮失败；开发覆盖只在 Vite 开发构建且 `VITE_PAID_RACE_DEV=1` 时生效，不读 URL 参数。`DEV_CHAIN=anvil bash scripts/dev.sh` 启动 anvil（chainId 10143、0.5 s 出块）、以 anvil 默认密钥部署、写 `.env.anvil.local` 并以 `vite --mode anvil` 运行，开发链账户为直连 EOA |
| Monad 测试网部署密钥 | 可用 | `.env` 指向被 Git 忽略、权限 `0600` 的 `keys/ponygogogo-monad-testnet.private`，派生地址与当前测试网 Vault owner 一致；密钥内容不输出、不入库 |
| 合约安全、经济与 gas 验收 | 合约基础审计与测试网验证已完成；经济与最坏 gas 验收按决策延期 | 只读对抗审计复核 Vault 守恒与防重入、单次状态迁移防双付、seed 不可自选、EIP-2935 窗口与字节码一致且无法靠压 gas 伪造锚丢失、汇编结构偏移与内存安全、实例/炸弹/井上限不可越界（最多 42/64、20/20、5/5）、Agent 预算范围。退款类的两项（已知败局拖到过窗退款、未结算赢局被作废）按「会话协议 v2」不设退款后不复存在；v2 下锚过窗即判负，诚实客户端须在冲线后及时结算，界面须显示约 47 分钟的结算期限。当前测试参数的既有模拟仅作早期风险信号；牌库、卡牌数值和电脑马性格尚未定稿，不作为最终经济结论或本阶段门槛。//TODO - 对规则 v4（实例上限 96、装备回收与刷新、监听实例）重做对抗审计，并断言新的实例与事件上限不可越界。//TODO - 补充牌库、完成卡牌数值平衡和电脑马性格平衡后，按冻结版本重新核算返奖率并确定门槛。//TODO - 同一平衡阶段结束后，以对抗构造的最大合法输入（含事件切分重力井步）直接断言求时 gas 上限；覆盖炸弹上限恰为 20。 |
| Envio | Development 部署与首次 GraphQL 查询已完成；游戏站点来源接入验收列为下一步 | `envio/` 是 `Kiruno-lz/ponygogogo-indexer` 的 Git submodule，固定在 Cloud 当前部署提交 `b4fd21c`；克隆主仓库后运行 `git submodule update --init --recursive`。索引器仓库独立维护并推送到 `main`，主仓库通过更新 submodule 指针记录采用的版本。索引器（`envio@3.12.1` 精确锁定，Cloud 拒绝版本范围且忽略 lockfile）按「会话协议 v2」事件建模：`Session`（含判负状态、`acquired`、净值）、`Choice`（提交与是否生效，由 `SessionSettled.acquired` 回填）、`Player`、`HorseStat`、`CardStat`、`StakeLock`、`VaultTransfer`、`VaultStat`、`GameStat`；只在首次出现时累计，Game 与 Vault 处理器互不读取，保留默认重组回滚（深度 200 块）。Vitest（`createTestIndexer`）25/25，以 HyperSync token 对测试网部署块冒烟通过；v2 ABI 暂按规格手写，合约重建后以 `pnpm abis:check` 核对。浏览器查询 `src/chain/history.ts` 的 `fetchRecentSessions(sma-b)` 返回 `not-configured/ok/error`，不暴露余额，L1 12 项。Cloud 设置：目录 `/`、配置 `config.yaml`、分支 `main`、Development 计划、无环境变量。首个 Cloud 部署提交 `b4fd21c`（2026-09-29）为 Active；Monad Testnet（10143）从块 66458114 同步至链头，处理 23 个事件。Envio Playground 查询验证了嵌套 `choices` 与 `_meta`（chainId=10143、isReady=true）；Development 部署端点 `https://indexer.dev.hyperindex.xyz/20a6128/v1/graphql` 已写入本机 `.env` 的 `VITE_ENVIO_GRAPHQL_URL`。当前 Development 部署端点供测试网阶段使用；本阶段不要求配置固定生产端点。免费计划：每组织 3 个索引器、每个 3 次部署，30 天或超 20 GB 删除；软限制 10 万事件、5 GB 或 7 天无查询，触发后 7 天宽限、3 天只读再删除。Cloud 部署自带 HyperSync 访问，本地运行用 `ENVIO_API_TOKEN`，不用 HyperRPC。//TODO - 下一步：从游戏站点来源发起最近场次查询，验收浏览器 CORS、嵌套 `choices` 与 `_meta`。本轮尚未执行。 |

当前基线（2026-10-04）：`bun test src` 898 通过、11 项缺失母版跳过，`bun --no-env-file test tests/api` 66/66，`forge test` 116/116，`bun run build`、`tsc -b`、`forge fmt --check`、`bun run check:contracts`、卡牌生成物与 355 场 v4 向量 `--check` 均通过。浏览器本轮重力井共享轨迹回归 1/1；同日较早的两场免费试玩名次/音效回归通过，本轮未重跑；2026-10-03 的全量 49 通过、3 跳过未重跑。Envio 25/25 与 react-doctor 82/100 为 2026-09-29 的结果，本轮未重跑。本机经代理访问 `agents.devnads.com` 证书不匹配，应用内领水在本机失败，需在其他网络复核。


## 有奖规则 v4

规则标识 `rulesetHash = keccak256(utf8("ponygogogo/paid-rules/v4/" + cardTableHash))`，其中 `cardTableHash = keccak256(utf8(JSON.stringify({globals,cards})))`，`cards` 为 `paidCardRuleTuple` 固定 25 个字段顺序的 40 项数组，`globals` 含 C-04 附加默认时长、体力消耗下限 `minCostFactorBps` 与重力井 RK2 步长 `rkStepMs = 250`。当前表哈希 `0x5fe93ed7989dd76dcccbc106fc2c4d0441b0c046f09e722906afd77a3b143912`，规则哈希 `0xbb2c9df7e6a29f0c6c54510063905c4652e08e0e987b262484cc77eb46dae876`。v4 相对已部署的 v3：卡牌表由 26 项扩为 40 项（C-22 至 C-26 由无效果占位改为正式效果，新增 C-27 至 C-40），重力井强度与重合强度由 6000 改为 3000 bps，求时器与 Solidity 增加监听、固定值、门控等实例类型与事件码，并支持有符号固定值的过零积分。本文规则是权威依据；`src/race/paid/cardRules.ts` 为其类型化实现，生成库中固定两个哈希。参数修改后必须重新生成、验证向量并部署新求时器与 Game。

**档位（项目方，2026-09-28）**：下注额为 `0 / 0.3 / 1 / 5 / 10 MON`。0 仅免费本地试玩，不存 Vault 下注；四档有奖下注 `0.3 / 1 / 5 / 10 MON` 按 wei 精确比较，依次对应性格区间第 1–4 档 `(b₀,a,C)`：`(1120–1240,10–13,1700–1840)`、`(1180–1300,11–14,1780–1920)`、`(1240–1360,12–15,1860–2000)`、`(1300–1420,13–16,1940–2080)`。赔率仍为 `[3, 1.5, 1, 0, 0]` 倍，开场最大庄家净预留依次为 `0.6 / 2 / 10 / 20 MON`，庄家流动性不足的档位开场即被 Vault 拒绝。当前为测试阶段，目的是跑通完整流程；档位写死在 PonyGame 代码、性格区间写死在求时器代码中，随合约不可变部署；规则哈希覆盖卡牌表、共享数值参数与版本标签。最终 RTP 重算按[项目决策](../decision.md)推迟到牌库、卡牌数值与电脑马性格平衡完成后；不作为当前测试网发布门槛。

卡牌效果与数值的唯一接口是 `paidCardRule(cardId)`；`PAID_CARD_RULES` 是 40 张有奖卡的效果与资格单一数据源；`bun scripts/gen-paid-card-rules.ts --check` 验证 Solidity 生成表，`bun scripts/gen-paid-vectors.ts --check` 验证 355 场 v4 向量（`tests/vectors/paid-race-v4.json`）。TS 与 Solidity 求时器和有奖界面均已接入。修改规则须更新生成物、向量与规则版本，并部署新的求时器/Game；既有会话继续使用原规则。免费试玩与有奖比赛使用同一规则表和求时器，试玩的时钟与入场锚取自本地。

### 单位与常量

| 量 | 表示 | 取值 |
| --- | --- | --- |
| 模拟时间 τ、现实时间 t | 整数毫秒；t 以入场块 `T0 = block.timestamp·1000` 为 0 | 最长模拟时间 600000 |
| 位置 `pos`、里程 `dist` | µu，1 赛道单位 = 10⁶ µu | `L = 10¹¹`；检查点 `dist ≥ k·L/4`，k = 1,2,3 |
| 基础速度 `b` | mu/s（10⁻³ 单位/秒） | 性格 `b₀/a/C` 沿用 `paidProfiles`；未力竭时每毫秒增加 `a`，达 `C·1000` 为止 |
| 百分比 `P` | bps 加总 | 乘子下限 0：`max(0, 10000+P)` |
| 固定值 `K`、力竭扣速 `E` | 单位/秒 | `K` 有符号（C-40 起始 −20）；`E ∈ {0, 10}` |
| 体力 `s` | µ体力 | 容量 `10⁹`；基础消耗 24/s，恢复 10/s，即每毫秒 `cost·1000`、`regen·1000`。消耗由各效果的 `costDeltaBps` 加算（火箭 −5000、省流 −4000、狂暴 +5000），`costFactor = max(1000, 10000 + Σ)`，`cost = floor(24000·costFactor/10000)`；恢复由 `regenBonusBps` 单独加算（望梅止渴 +10000） |
| 场与卡牌常量 | — | 重力井 `R = 8000` 单位、强度 3000 bps；风 ±1000 bps；`ΔvWheel = 10`；积分基步 `H = 250` ms；自动选牌面板 3 s；实例上限 96、炸弹上限 20、事件上限 4096 |

有效速度 `v = max(0, floor(b·max(0,10000+P)/10000) + (K−E)·1000)` mu/s。百分比乘子不取负是本版对多井叠加的冻结口径；`K` 为负使表达式跨过 0 时，在过零点划分运动区间，只积分 `max(0, v)`，不产生负位移或倒退里程。

### 时间映射与检查点

- 求时器按模拟时间推进，同时维护分段线性映射 `wall(τ)`：常态 `wall = wallRef + (τ − τRef)`；玩家面板期间 `wall = openWall + (τ − τOpen)·10`。
- 玩家 `dist` 首次达到阈值的毫秒为 `τOpen`，`openWall = wall(τOpen)`，`openSec = ceil(openWall/1000)`。关闭时刻 `closeWall`：实际选择或主动放弃取交易秒 `txSec·1000`，须 `openSec ≤ txSec < openSec+20`；无交易取 `(openSec+20)·1000` 超时；持有【选择困难综合症】取 `(openSec+3)·1000` 自动选定。`τClose = τOpen + floor((closeWall − openWall)/10)` 为该卡规范生效时刻，其后 `wallRef = closeWall`、`τRef = τClose`。
- 持有【最后的波纹】后到达的检查点不开面板、不慢放，记 `forfeited`；玩家已冲线则不再有检查点。面板开启期间若玩家达到下一阈值，推迟到当前面板关闭时刻开启。
- 电脑马在自身 `dist` 越过阈值的毫秒立即取私有牌堆下一张生效，不开面板。
- 被推迟的面板在前一面板关闭且其卡生效后开启，故在该处取得的 C-03/C-04 立即使其断卡或自动；多个被推迟的阈值依次开启。断卡检查点记 `openSec = 0`、`closeWall = openWall`；超时与主动放弃都使正向游标前进 3。
- 玩家在自己面板开启期间冲线时，面板在冲线毫秒关闭且不取卡（原因 `finished`）。
- 不合法的已存选择按该检查点无交易处理（超时、自动或断卡照常由规则推导），并记事件。不合法包括：该检查点未开启或已关闭、`txSec` 不在 `[openSec, openSec+20)`、`txSec·1000 ≥` 玩家 `finishWall`、处于自动或断卡状态、刷新槽越界/重复/超出额度/牌堆耗尽、`cardId` 不在刷新后的候选中。任意已存选择都不得使求时回退。事件码 28 `CHOICE_INVALID`（`arg = checkpoint·16 + 原因`：1 未开启、2 过早、3 过晚、4 晚于冲线、5 自动、6 断卡、7 无刷新额度、8 刷新槽非法、9 牌堆耗尽、10 非候选），记在决定它的面板事件之后，从未开启的检查点记在比赛结束处。冻结口径：玩家在面板内冲线而已存选择晚于冲线时，该选择秒仍作为面板的临时关闭时刻参与积分步切分，只有重力井在冲线所在步生效时才可能使冲线相差约 1 ms；其余原因与无交易逐字段相同。
- 事件的现实时间取处理时生效的映射：面板关闭毫秒内先于关闭处理的事件取慢放映射，关闭及其后取 `closeWall`。`untilWall` 停在第一个现实时间晚于它的事件之前。
- 冲线现实时间 `finishWall = wall(finishTime)`；未冲线马 `finishWall = wall(600000)`。

### 运动区间

区间内 `P/K/E` 与有效加速度 `a_eff` 不变：未力竭且 `b < C·1000` 时 `a_eff = a`，否则为 0。

```text
Δpos(Δτ) = floor(max(0,10000+P) · (2·b·Δτ + a_eff·Δτ²) / 20000) + (K − E)·1000·Δτ   // 未力竭，E = 0
Δpos(Δτ) = v·Δτ                                                                      // 力竭，a_eff = 0，v 为常数
```

每个事件与每个积分步的边界都推进全部五匹马，并在边界处取整（floor）。`dist` 累加同一 `Δpos`，交换不改 `dist`。基础速度在 `Δτ = ceil((C·1000 − b)/a)` 达上限，事件时 `b` 置为 `C·1000`。检查点、终点、炸弹的越过时刻取区间内满足条件的最小整数毫秒；区间终态由区间起点一次算出。

### 体力

- 未力竭且 `s > 容量`：只按 `cost` 下降，降到不高于容量的首个毫秒为事件；此后按 `net = regen − cost` 变化并钳在 `[0, 容量]`。
- `net < 0` 时 `s` 在 `ceil(s/−net)` 见底：无【亢奋】进入【力竭】；有【亢奋】停在 0 且保持加速度。
- 【力竭】：`a_eff = 0`、`E = 10`、停止消耗，按 `regen` 恢复，达到容量的首个毫秒退出。
- 【亢奋】获得时移除【力竭】；到期时若 `s = 0` 且 `net < 0` 立即进入【力竭】。【肾上腺素】`s += 2·10⁸` 可超容量，力竭中若因此 `s ≥ 容量` 立即退出。
- 普通恢复（C-24、C-30、C-36、C-39）钳在容量，已有的超容量体力不被裁低，也不新增超容量；C-22 先快照 `paid = min(s, 3·10⁸)` 再扣除。恢复未达到容量时不解除已生效的【力竭】。

### 卡牌效果

玩家与电脑马使用同一规则；时长为模拟毫秒，每个效果实例独立计时。

| 卡 | 规则效果 | 时长 |
| --- | --- | --- |
| C-01 | 【起飞】；`P +2000` | 30000 |
| C-02 | `P +3000`；到期对持有者结算【死亡】 | 30000 |
| C-03 | `P +4000`；此后检查点断卡 | 20000 |
| C-04 | 此后检查点自动选定且不可刷新；此后获得的每张卡附加 `P +2000` | 永久 |
| C-05 | 刷新额度 +1 | 永久 |
| C-06 | 在持有者以外四条赛道、持有者当前 `pos` 各放一枚炸弹 | 瞬时 |
| C-07 | 躯干【火箭喷射器】：`P +1500`，消耗减半 | 40000 |
| C-08 | 尾部【彩虹拖尾】：`P +1000` | 60000 |
| C-09 | 【拍手交换】：获得时刻起每 2000 尝试一次，共 15 次，+30000 到期同刻不触发 | 30000 |
| C-10 | 躯干【史瓦西黑洞】：重力井，强度 3000 bps | 10000 |
| C-11 | 四蹄【风火轮】：【起飞】；装备后 +7000/+14000/+21000/+28000 各 `K +10` | 30000 |
| C-12 | 环境风：`entropy % 2` 为 0 逆风 `−1000`、为 1 顺风 `+1000`，只作用于【起飞】马，替换旧风 | 永久 |
| C-13 | 从其他未冲线马的全部装备中等概率偷一件，装到自己身上并刷新为完整时长；无装备时无效 | 随被偷装备 |
| C-14 | 恢复 `+10000` bps | 5000 |
| C-15 | 体力 +200 | 瞬时 |
| C-16 | 【亢奋】 | 10000 |
| C-17 / C-18 | `K +10` / `K +20` | 永久 |
| C-19 / C-20 | 外观（头顶尖发）：把当前毛色写为金色 / 绿色，无数值效果；供 C-29 门控与版本答案判定 | 永久 |
| C-21 | `K +10`；【目中无人】 | 永久 |
| C-22 | 支付 `min(s, 3·10⁸)` 体力，挂载 `P +floor(3500·paid/3·10⁸)` | 12000 |
| C-23 | 前 6000：`P −1500`、恢复 `+20000` bps；到 6000 触发后 `P +3000`、恢复加成取消 | 24000 |
| C-24 | `P +500` 持续 10000；有效期内体力首次 `≤ 2·10⁸` 时恢复 `3·10⁸`，触发即消费监听 | 20000 |
| C-25 | `P −500`，消耗 `−4000` bps | 30000 |
| C-26 | `P +2500`，消耗 `+5000` bps；持有【亢奋】时再 `P +1000` | 20000 |
| C-27 | `P +500`；【起飞】时再 `P +1500`，本卡不提供起飞 | 20000 |
| C-28 | 未【起飞】时 `P +2000` | 20000 |
| C-29 | 当前毛色为 C-19 的金色：`P +1500`；C-20 的绿色：恢复 `+15000` bps；其他毛色：`P +500` | 30000 |
| C-30 | 回收自身剩余时长最短的装备（并列取 `instanceId` 小者）：恢复 `1.5·10⁸` 体力，`P +2500` 持续 15000；无装备则 `P +1000` 持续 10000 | 15000 / 10000 |
| C-31 | `P +500` 持续 30000；永久监听实际获得装备，每次再 `P +1000` 持续 10000；获得时已持有装备则立即触发一次 | 永久 |
| C-32 | 把自身全部装备刷新至各自完整时长（保留周期相位与已消费事件）；无装备则 `P +500` 持续 5000 | 瞬时 / 5000 |
| C-33 | 无任何装备时 `P +2500`，否则 `P −500` | 30000 |
| C-34 | 自身 `P +500`；获得时选前方最近（`pos` 更大且最小）、未冲线、非【目中无人】的马，使其 `P −2000`；无目标则只有自身加成 | 8000 |
| C-35 | 获得时若物理排第一（并列取 `horseId` 小者）`P +2500`，否则 `P +800`；分支一次冻结 | 8000 |
| C-36 | 所有未冲线马恢复 `2·10⁸` 体力；自身 `P +1500` | 10000 |
| C-37 | 永久监听：拦截下一次死亡请求，仅一次；【重生】免疫不消耗它 | 永久 |
| C-38 | 有效期内监听下一次实际死亡；死亡清零后挂载 `K +120` 持续 30000，不立即加速；再次死亡清除该贡献 | 50000 |
| C-39 | `P −1000` 持续 8000；永久监听第一次主动放弃选牌：恢复 `3·10⁸` 体力、`P +2500` 持续 12000 | 永久 |
| C-40 | 获得时 `K −20`；此后自身 `dist` 每再增加 `2·10¹⁰`（赛道的 20%）`K +30`，最多 4 次 | 永久 |

- C-04 附加时长：规则表 `bonusMode` 为 `follow` 的卡跟随其主效果时长；`permanent` 的 C-05、C-12、C-17–C-21、C-31、C-37、C-39、C-40 永久；`default` 的 C-04 自身、C-06、C-15 为 20000；`loot` 的卡取实际时长（C-13 偷到的装备完整时长、C-30 的 15000 或 10000、C-32 无装备时的 5000），没有实际时长时为 20000。
- 【死亡】请求依次判定：处于【重生】则免疫（不消耗 C-37）；持有未消费的 C-37 则消费并拦截；否则 `b = 0`、`K = 0`，有来源的固定值贡献以原因 `death` 结束，获得 5000 ms【重生】，期间免疫【死亡】；其他效果、装备与层数保留。随后若持有未过期的 C-38 监听则消费它并挂载固定值贡献。
- 炸弹只由连续运动触发（`pos_before < bombPos ≤ pos_after`），交换跳变不触发；【起飞】马不触发且炸弹保留；【目中无人】不受他马放置的炸弹影响；是否触发按越过它的那段运动期间的【起飞】/【目中无人】判定，死亡或免死在处理该炸弹时判定，【重生】中触发时炸弹消失但免死。
- 装备槽为躯干、尾、四蹄；同槽新装备直接移除旧实例，不结算旧实例的到期效果。偷取候选按（持有者 `horseId`，槽位 躯干 < 尾 < 四蹄）排序后取 `entropy % n`。
- 【起飞】来自 C-01 或装备中的风火轮。他马放出的风对【目中无人】持有者无效。
- 重力井：目标 `Δ = pos_t − pos_o`，`d = |Δ|`；`d ≥ R` 贡献 0；`factor = 10000 − floor(d·10000/R)`，`k = floor(3000·factor/10000)`；`Δ > 0` 取 `−k`，`Δ ≤ 0` 取 `+k`。重合时给目标 `+3000 bps`，按后方处理。持有者冲线或装备移除即失效，对已冲线马不再计算。
- 交换：沿用 `paidSwap` 的目标派生；持有者或目标已冲线或持有【目中无人】时空过，仍消耗尝试序号。两匹参与交换的马都未冲线、交换前后都在终点前，交换本身不会造成冲线。
- 电脑马持有仅经显式牌堆可达的卡时：C-03 断其后续私有卡，C-04 只附加 `P +2000`，C-05 无效。马冲线后其效果静默结束，不改变任何结果。

### 重力井数值积分

场上存在任一生效黑洞时，求时器按步推进，步长 `Δ = min(H, 到下一个已知事件)`：

1. 按步首位置求每匹马的场项 `P₀`；
2. 以 `P静 + P₀` 解析推进 `floor(Δ/2)` 得中点位置；
3. 按中点位置求场项 `Pm`；
4. 以 `P静 + Pm` 作为本步冻结百分比解析推进 `Δ`，并在本步内定位越过事件，有事件即截断到该毫秒，截断后的步沿用本步中点场值。

“已知事件”指效果到期、交换尝试、风火轮爆发、监听触发（含 C-40 的里程阈值）、体力与基础速度阈值、面板关闭、`untilWall` 与 600000。

该 RK2 中点规则的输出即规范轨迹。它与连续解的误差由离线高精度参考测定并记录在本文，不影响付款口径。

### 同刻事件与终止

同一毫秒按以下顺序处理，类内按括号中的键升序：

0. 效果到期与移除（`instanceId`）：含 C-02 到期死亡、【重生】结束、【亢奋】到期检查；
1. 体力与基础速度阈值（`horseId`）；
2. 冲线（`horseId`）；
3. 炸弹（`horseId`）；
4. 交换尝试、风火轮爆发与监听触发（C-23 阶段切换、C-24 阈值、C-40 里程；`instanceId`）；
5. 检查点越过（`horseId`）：电脑马取卡、玩家开面板或记断卡；
6. 玩家面板关闭与取卡。

每轮处理最小的（类，键）；同一毫秒新产生的项按同一规则插入，故检查点处取得的 C-09 在该毫秒紧随取卡进行首次尝试。类 1 中基础速度上限先于体力阈值，【亢奋】到期为零与【肾上腺素】退出力竭也在类 1 同毫秒处理，C-16 获得时立即移除力竭；类 3 的键为（`horseId`，炸弹放置序号）。重复直到该毫秒无新事件；τ = 600000 的事件仍处理。五马全部冲线或 τ 达 600000 时结束，未冲线者 `finishTime = 600001`。`rawOrder` 按 `(finishTime, horseId)`，【版本答案】沿用 `paidSettlement`。效果实例上限 96、炸弹上限 20、事件上限 4096；超限视为规则实现缺陷，测试须证明合法输入不可达。

### 随机派生

- 开场锚派生玩家牌堆、电脑马牌堆与性格。
- 玩家第 k 检查点实际选择的卡：锚为该选择交易块哈希，`checkpoint = k`；自动选定的卡：锚为最近一次实际选择交易块哈希，`checkpoint = k`；风与偷取的 `eventIndex = 0`，交换为尝试序号。
- 电脑马 `h` 的第 `c` 张卡：锚为开场锚，`checkpoint = 0`，`eventIndex = h·3 + (c−1)`；其 C-09（仅显式牌堆可达）的交换 `eventIndex = (h·3 + c − 1)·256 + 尝试序号`。
- 摘要：每个处理的事件折叠为 `digest = keccak256(abi.encode(digest, uint8 code, uint32 τ, uint8 horse, int256 arg))`，初值为 0；事件码表以 `src/race/paid/events.ts` 为准，两端逐项一致。
- 用途域为 `keccak256` 的 `swap`、`wind`、`steal`、`autopick`。

## 会话协议 v2

**决定（项目方，2026-09-28）：Vault 不设退款。** 随机锚过窗而永久不可结算的会话、玩家放弃结算的赢局或败局，都视为玩家自己放弃权益，按返还 0 判负。合约与界面中不存在任何退款入口。

- **合约组成**：`PonyGame`（会话与权威结算）、`PonyVault`（下注托管与直接付款）、单个 `PaidRaceSolver`（内联 Engine/Motion/watch/gated 与冷路径内部库，实现 `IPaidRaceSolver.solve`）。求时器地址与其 `rulesetHash` 在 Game 构造时固定；换规则即部署新求时器与新 Game，已开场会话始终由原 Game 与原求时器完成。
- **开场**：浏览器只发送 `Game.openSession{value: stake}(horseId, stake)`，Game 同笔转入 Vault；不读取玩家 Vault 可用余额或发送充值调用。合约按单调 nonce 派生 seed，记录 `T0`、`b₀`，锁定下注并预留最大净赔付；同一账户同时只有一个未完结会话。
- **随机锚**：`RandomAnchor.read(b)` 在 256 块内使用 `BLOCKHASH`，更早则读取 EIP-2935 历史合约（8191 块，约 47 分钟），再早不可用。`chooseCard` 顺带封存已可读的前序锚，`settleSession` 封存全部所需锚，`sealAnchors` 任何人可调用；浏览器不为封锚单独发交易。
- **选择**：`chooseCard(sessionId, checkpoint, cardId, refreshSlots)` 只做廉价检查（玩家本人、会话开放、检查点 1..3 严格递增、`cardId ≤ 40`、刷新数 ≤ 3）并记录 `Ti` 与 `b_i`，不运行求时器，`cardId = 0` 为主动放弃。选择是否生效在结算的求时中判定（见「有奖规则 v4」），浏览器在回执后用同一 TS 求时器判定并按结果渲染。
- **结算**：`settleSession` 任何人可调用，要求 `(block.timestamp − T0)·1000 ≥` 玩家 `finishWall` 且所需锚可得；合约运行完整求时器，按 `settlementRank` 指示 Vault 同笔直接向玩家智能账户返还，`SessionSettled` 同时给出每个检查点实际获得的卡。结算不设截止时间，锚封存后任何时候都可结算。
- **判负**：`forfeitSession` 任何人可调用，条件为某个所需锚未封存且其块已过去、超出读取窗口；owner 可在 T0 后 1 天对求时器回退的会话判负，只为释放该玩家的会话占用。判负按返还 0 结算：下注转入庄家流动性并释放预留，发 `SessionForfeited`。判负与结算互斥。
- **保管人**：庄家脚本不代玩家结算赢局，也不为其封锚。对玩家冲线超过宽限期仍未结算的会话，等所需锚过窗后以 `forfeitSession` 回收（只读存储与记账，不运行求时器）。
- **事件**：`SessionOpened`、`CardChosen`（只表示提交，是否生效以结算为准）、`RandomAnchorSealed`、`SessionSettled(sessionId, player, finishTime[5], rawOrder[5], settlementOrder[5], playerSettlementRank, payout, digest, acquired[3])`、`SessionForfeited(sessionId, player, stake, reason)`（`reason` 1 = 所需锚丢失，2 = owner 关闭求时器故障会话）；Vault 判负发 `StakeSettled(sessionId, player, 0)`，不再有 `SessionRefunded/StakeRefunded`。
- **gas 口径**：Monad 按 gas limit 计费。选择不在链上求时后，一场的求时开销只发生在一次结算；保管人回收用判负而非结算。

## 相关依据

当前有效的产品与账户决策见[项目决策](../decision.md)；完整合约边界见[链上架构](../architecture/onchain.md)，资金与结算公式见[链上与经济](../chain-and-economy.md)。本文件只维护执行状态、验证证据与剩余上线门槛。
