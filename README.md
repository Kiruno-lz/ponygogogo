# Ponygogogo

Monad 测试网上的五马赛马卡牌游戏。选一匹马，在三个里程检查点各从三张卡里挑一张，目标是赢得游戏；有奖场次的名次由链上合约按冻结规则独立复算，并直接以原生 MON 付款。

[在线试玩](https://ponygo.kiruno.cc) · [玩法设计](docs/architecture/game-design.md) · [技术架构](docs/architecture/overall.md) · [项目决策](docs/decision.md)

## 特性

- **卡牌构筑**：40 张卡由九类效果原语组合，状态之间互相咬合。
- **链上裁判**：`PonyGame` 用开场 seed、选牌交易的秒级时间与区块哈希复算五马冲线时间；浏览器名次只是预览，不能决定奖金。
- **一套求时器，两种实现**：TypeScript 与 Solidity 实现同一个事件驱动求时器（无场区间解析积分，重力井区间定点 RK2），由 648 组跨语言向量逐字段对照。
- **只用原生 MON**：开场一笔交易支付下注，`PonyVault` 只锁定本场下注与赔付预留，结算同笔付款；没有充值、提款或退款账户。
- **通行密钥账户**：Mera 通行密钥恢复根账户，Alchemy 智能账户发送交易；0 MON 档是无需登录的本地试玩。
- **加密图鉴**：稀有卡与角色收藏在浏览器内加密，Cloudflare D1 只保存密文。

## 工作原理

```text
浏览器（React + Phaser）  ── 同一 TS 求时器：即时画面与预览
   │ Mera 通行密钥 → Alchemy 智能账户
   ▼
PonyGame ── solve ──▶ PaidRaceSolver      权威名次
   ├──▶ PonyVault ──▶ 玩家智能账户         下注托管与付款
   └──▶ PonyRewards                       获得物账本
合约事件 ──▶ Envio                         历史与统计（只读）
浏览器加密 ──▶ Cloudflare Worker + D1      图鉴密文；scheduled Keeper
```

详见[技术架构](docs/architecture/overall.md)与[链上架构](docs/architecture/onchain.md)。

## 快速开始

需要 [Bun](https://bun.sh)。本地链与合约测试另需 [Foundry](https://book.getfoundry.sh)，索引器需要 pnpm。

```bash
git clone --recurse-submodules git@github.com:Kiruno-lz/ponygogogo.git
cd ponygogogo
cp .env.example .env
bash scripts/dev.sh
```

打开 `http://localhost:5173`。`scripts/dev.sh` 会检查环境、安装依赖、释放端口并做健康检查。通行密钥的 `rpId` 取当前域名，本地 `localhost` 与正式站点 `ponygo.kiruno.cc` 的账户互不相通；注册会向智能账户请求测试币，是否到账以链上余额为准。

运行时素材已生成在 `public/assets/` 并随仓库管理；美术母版，不纳入 Git，只有改动素材时才需要（见[素材管线](scripts/README-assets.md)）。

**本地链全栈**：启动 anvil（chainId 10143）、部署 Game/Vault/求时器并以 `--mode anvil` 运行 Vite，不读取 `.env` 中的任何密钥。

```bash
DEV_CHAIN=anvil bash scripts/dev.sh
```

`DEV_SOLVER=auto|mock|real` 选择求时器（默认 auto：真实求时器能编译即用真实的），`DEV_DETACH=1` 就绪后转入后台，`bash scripts/dev.sh stop` 停止后台进程。

## 测试

```bash
bun run typecheck
bun test src
bun --no-env-file test tests/api
forge test
bun run check:contracts
```

`tests/api` 中的本地链用例需要 Foundry 的 `anvil` 与 `forge`。规则生成物用 `check:paid-cards`、`check:paid-vectors`、`check:pony-rules`、`check:reward-rules`、`check:pony-vectors` 校验是否过期；`check:solver-monad` 以只读调用测量 Monad gas。`bun run build` 需要 `.env` 中的五个生产构建变量（见[部署与服务 §1](docs/architecture/deploy.md)）。

浏览器回归默认使用 Chromium，WebKit 专用回归自行指定引擎：

```bash
bun run test:e2e
```

有奖浏览器动线需要另起本地链；未启动时该文件跳过。验收真实 Solidity 求时器必须使用 `DEV_SOLVER=real`，mock 求时器的流程通过不能当作规则复算证据。

```bash
PORT=5178 DEV_CHAIN=anvil DEV_SOLVER=real DEV_DETACH=1 bash scripts/dev.sh
bun run test:e2e tests/e2e/specs/paid-race.spec.ts
bash scripts/dev.sh stop
```

索引器测试在 `envio/` 子模块中运行，见[部署与服务 §6](docs/architecture/deploy.md)。

## 部署

```bash
DRY_RUN=1 bash scripts/deploy.sh
bash scripts/deploy.sh
```

脚本完成类型检查、生产构建、产物与缓存规则检查、远端 D1 迁移和 Cloudflare Worker 发布。合约部署、构建变量、Keeper 与 Envio 见[部署与服务](docs/architecture/deploy.md)。

## 目录

```text
src/             前端页面、TS 规则内核（src/race）、链交互（src/chain）与 Phaser 场景（src/game）
contracts/       Solidity 合约：PonyGame、PonyVault、PaidRaceSolver、PonyRewards 与内部库
envio/           Envio 索引器（git submodule）
scripts/         开发、规则生成、数值分析、部署与素材脚本；Wrangler Worker 与 D1 迁移
tests/           API、合约、跨语言向量与 Playwright 浏览器测试
public/assets/   已生成的运行时素材
docs/            设计与架构文档
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [项目决策](docs/decision.md) | 当前有效的产品、玩法、经济、账户、规则与部署决策 |
| [技术架构](docs/architecture/overall.md) | 总体模型、架构边界与模块划分 |
| [玩法设计](docs/architecture/game-design.md) | 比赛流程、里程与名次、牌堆、运动与体力参数、角色能力、结算展示 |
| [卡牌设计](docs/architecture/card-design.md) | 效果原语、状态与装备、40 张卡牌、美术需求 |
| [效果系统](docs/architecture/effect-system.md) | 求时器边界、效果实例、写入边界、事件顺序；表现层的场景、页面、素材、结算与海报 |
| [链上架构](docs/architecture/onchain.md) | 账户、合约、Vault 与赔率、规则输入与时钟、随机锚、链上结算、索引与图鉴同步、交易恢复 |
| [部署与服务](docs/architecture/deploy.md) | 构建变量、合约部署、Cloudflare、Keeper、Envio 与发布验收 |
| [素材管线](scripts/README-assets.md)、[音频来源](scripts/README-audio.md) | 母版、运行时产物与处理脚本 |
| [回归复现](tests/e2e/regressions/REPRO.md) | 浏览器回归脚本及覆盖范围 |
| [研究记录](docs/_reaserch/) | 角色策略验证、跑步动作参考 |
| [历史归档](docs/_archive/README.md) | 已失效的计划与验收记录，不再更新 |
