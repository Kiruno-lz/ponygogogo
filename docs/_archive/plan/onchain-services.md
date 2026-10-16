# 链上服务配置与验收

## 1. 仓库基线

产品、会话协议、收藏格式与规则采用 v0.1，包版本为 0.1.0。链配置使用 Monad 测试网（10143）。下表是仓库部署夹具与配置采用的地址及部署块，不能代替实时 RPC 绑定、余额或暂停状态检查。

| 合约 | 仓库采用的地址 | 部署块 |
| --- | --- | --- |
| PaidRaceSolver | `0xEAb3720908E36584b88f85c85b5Cb91c3ba798f0` | 69477580 |
| PonyRewards | `0xaa4181704974A86D4964f6e6f34Ed8Af570882b7` | 69477585 |
| PonyGame | `0x84a319aa7dAdE1fBD49FE135bb70feeD937eCe82` | 69477594 |
| PonyVault | `0xDe96ccC9874894Bf0004845407585cC192e2fa8d` | 69477607 |

Game/Vault 地址与索引起点见 `envio/config.yaml`、`envio/test/live/deployment.live.ts` 和 `wrangler.toml`；其余部署值来自历史收尾记录；浏览器 Game/Vault 从 `VITE_PONY_GAME_ADDRESS`、`VITE_PONY_VAULT_ADDRESS` 读取，没有默认部署地址。规则哈希由 `cardRules.ts` 的卡表、角色表和玩家基线计算，开场前须与链上 `PonyGame.rulesetHash` 一致。

## 2. 服务边界

Mera 通行密钥恢复根 EOA，Alchemy `sma-b` 独立智能账户承载测试币、下注与返还。注册只请求水龙头并轮询余额，不保证数量或到账。Game 开场收取完整原生 MON 并同笔转给 Vault；Vault 维护 L/H/R，不提供玩家充值、提款或退款账本。档位为 0.3/1/5/10 MON，总返还倍率为 `[3, 1.5, 1, 0, 0]`。

Solver 单体部署，Engine/Motion/Cold 为内部源码边界。正常结算在 Vault 付款前独立抽取收藏奖励，PonyRewards 记录位图；奖励读取或记录失败发出 `CollectibleSkipped`，不代替比赛求时。Vault 对玩家的接收调用失败时实际返还为 0，会话仍结算，不保留补领入口。完整账务与输入规则见[链上架构](../architecture/onchain.md)。

Envio 3.12.1 从当前 Game 的 RewardsBound 注册奖励账本，VaultBound 注册 Vault，按 `roster` 映射角色统计。`config.yaml` 启用重组回滚；实体处理器不保存进程外状态。浏览器历史端点仅从 `VITE_ENVIO_GRAPHQL_URL` 读取，RPC/合约始终决定资金与会话终态。

## 3. 结算与 Keeper

`openSession` 冻结名单、下注、seed 和开场块；`chooseCard` 记录交易秒和区块，窗口、候选与刷新有效性在求时中判定。`settleSession` 封存必要锚并求出五马结果，不接受浏览器名次。所有必要锚封存后没有结算截止时间；未封存锚过 8191 块窗口时可判负。锚齐全但结算预览失败时，仅 owner 可在开场满一天后判负。

- `src/chain/keeper.ts` 提供扫描、预览和判负核心；`scripts/keeper.ts` 默认 dry run，`--send` 才发送判负交易。
- Worker 的 scheduled 入口在 `scripts/Wrangler/worker/collection.ts`，由 `worker/keeper.ts` 适配 D1；正式配置每两分钟执行，preview 不启用 cron。
- D1 保存扫描游标、开放会话与发送租约；每次最多扫描 1000 块。Keeper 只回收可判负会话，不代玩家结算或封锚。
- RPC、Game、起始块在 Worker vars；密钥为 `KEEPER_PRIVATE_KEY` secret。Keeper 校验 chainId 10143。配置存在不代表 cron、密钥或迁移已经在线生效。

## 4. 验证入口与部署证据

| 层次 | 检查入口 | 能证明的范围 |
| --- | --- | --- |
| 表与向量 | `check:paid-cards`、`check:paid-vectors`、`check:pony-rules`、`check:reward-rules`、`check:pony-vectors` | 生成物与当前 TS 表一致 |
| TS / API / Solidity | `bun test src`、`bun --no-env-file test tests/api`、`forge test` | 对应测试的规则、协议、本地链与资金行为 |
| 浏览器 | `bun run test:e2e`；有奖动线要求本地链环境 | 选马、比赛、恢复、结算与图鉴的实际 UI 路径 |
| 合约体积 / Monad 样本 | `check:contracts`、`check:solver-monad` | 单体大小、无外部库链接；80 场只读探针的结果与 gas |
| Envio | `pnpm typecheck`、`pnpm test`、`pnpm smoke`（在 envio 中） | 离线读模型、当前配置真实区块；smoke 需要 ENVIO_API_TOKEN |
| Cloudflare | [部署入口](deploy.md)及正式域名验收 | 远端迁移、版本、cron 与真实图鉴往返；dry run 只证明本地构建/打包 |

真实交付须记录目标、命令、交易或 Worker 版本及独立查询结果。历史测试数量、曾注资的金额或曾经 Active 的索引器状态不能当作当前状态。一次性收尾记录已[归档](../_archive/README.md)，归档内容不再维护。

//TODO - 正式发布后记录 Worker/cron 版本与 D1 迁移状态，在 `ponygo.kiruno.cc` 验证通行密钥注册/重登、图鉴读写、409 冲突恢复和双设备恢复；同步核对 RPC 合约绑定及公开 Envio 查询，不能以仓库配置代替线上验收。
