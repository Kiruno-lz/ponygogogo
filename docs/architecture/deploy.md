# 部署与服务

本文记录仓库采用的部署配置与操作入口。仓库配置不能证明服务已经在线；线上状态以 RPC、Cloudflare 与 Envio 的实时查询为准。

## 1. 构建与运行变量

变量模板见根目录 `.env.example`。`VITE_*` 会嵌入浏览器包，只能放公开配置；私钥、API Token 与 Cloudflare 凭据只在本地 shell 或服务端 secret 中使用，不得改名为 `VITE_*`。

| 变量 | 用途 | 生产构建 |
| --- | --- | --- |
| `VITE_ALCHEMY_API_KEY`、`VITE_ALCHEMY_POLICY_ID` | Alchemy 智能账户与 gas 策略 | 必填 |
| `VITE_PONY_GAME_ADDRESS`、`VITE_PONY_VAULT_ADDRESS` | 当前 Game 与 Vault；浏览器没有默认地址，也不从 URL 参数读取 | 必填 |
| `VITE_ENVIO_GRAPHQL_URL` | Envio 公开 GraphQL 端点，钱包战绩使用 | 必填 |
| `VITE_MONAD_RPC_URL`、`VITE_FAUCET_URL` | 覆盖默认 RPC 与水龙头 | 可选 |
| `VITE_CANONICAL_HOST` | 规范域名，默认 `ponygo.kiruno.cc`，设为空串关闭跳转（§4） | 可选 |
| `ETH_RPC_URL`、`DEPLOYER_PRIVATE_KEY_PATH`、`PONY_REWARDS` | Foundry 合约部署（§2） | — |
| `ENVIO_API_TOKEN` | 本地运行索引器访问 HyperSync | — |
| `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` | Wrangler 自动化凭据；本地优先 `wrangler login` | — |

`vite build` 在缺少任一必填变量时直接失败（`vite.config.ts`）：环境变量优先于 `.env`，显式空串也算缺失；开发模式不受影响。有奖入口另需源码常量 `PAID_RACE_FEATURE`（`src/chain/paidGate.ts`）为真、两个地址上确有合约代码、链上 `rulesetHash` 与本地规则哈希一致——填上地址本身不会打开有奖场次。

## 2. 合约部署

`scripts/DeployPony.s.sol` 部署单个 `PaidRaceSolver`（或复用 `PONY_SOLVER` 并校验其规则哈希）、`PonyGame` 与 `PonyVault`，完成绑定；`PONY_REWARDS` 指向已有账本时复用，为空时新建。先模拟、再广播：

```bash
forge script scripts/DeployPony.s.sol --rpc-url "$ETH_RPC_URL"
forge script scripts/DeployPony.s.sol --rpc-url "$ETH_RPC_URL" --broadcast
```

可选变量：`HOUSE_FUND_WEI` 部署时注入庄家流动性（默认 0），`UNPAUSE=1` 部署后开放入场（默认保持暂停）。部署私钥从 `DEPLOYER_PRIVATE_KEY_PATH` 指向的文件读取，`foundry.toml` 只授权读取 `./keys`。复用账本时须由账本 owner 对新 Game 调用 `PonyRewards.setGame`。

当前仓库采用的 Monad 测试网（chainId 10143）部署：

| 合约 | 地址 |
| --- | --- |
| PonyGame | `0x84a319aa7dAdE1fBD49FE135bb70feeD937eCe82`（部署块 69477594，即索引与 Keeper 起点） |
| PonyVault | `0xDe96ccC9874894Bf0004845407585cC192e2fa8d` |
| PaidRaceSolver | `0xEAb3720908E36584b88f85c85b5Cb91c3ba798f0` |
| PonyRewards | `0xaa4181704974A86D4964f6e6f34Ed8Af570882b7` |

Solver、Vault 与 Rewards 地址可由 Game 的 `solver()`、`vault()`、`rewards()` 只读核对。更换部署时同步更新：构建变量 `VITE_PONY_*`、`wrangler.toml` 的 `KEEPER_GAME_ADDRESS` 与 `KEEPER_FROM_BLOCK`、`envio/config.yaml` 及其部署夹具与 live smoke 区间，然后重新生成 Envio 类型并发布。旧 Game 的未完结会话不会出现在新客户端的恢复入口（[链上架构 §8](onchain.md)）。

## 3. Cloudflare 发布

静态资源、同源图鉴 API、D1 与 Keeper 部署到 Cloudflare Workers，配置入口是根目录 `wrangler.toml`：

| 项目 | 仓库配置 |
| --- | --- |
| Worker | 正式 `ponygo`，preview `ponygogogo-preview` |
| 入口 | `scripts/Wrangler/worker/collection.ts` |
| 静态资源 | `dist/`，绑定 `ASSETS` |
| 优先进入 Worker 的路由 | `/api/collection*` |
| 未命中静态资源 | `not_found_handling = "none"`，交给 Worker：导航请求（`Sec-Fetch-Mode: navigate`）回落 `/index.html`，子资源保持 404 |
| D1 绑定 / 迁移目录 | `COLLECTION_DB` / `scripts/Wrangler/migrations/` |
| 数据库 | `ponygogogo-collection-production` / `ponygogogo-collection-preview` |
| cron | 正式每两分钟；preview 为空 |
| 可观测性 | logs、traces、issues 均关闭 |

D1 迁移：0001/0002 建立收藏、挑战与限流；0003 清空测试收藏、挑战与限流记录；0004 建立 Keeper 状态表（扫描游标、开放会话与发送租约）。发布脚本只执行所选环境尚未应用的迁移。

从仓库根目录执行：

```bash
DRY_RUN=1 bash scripts/deploy.sh
DEPLOY_ENV=preview bash scripts/deploy.sh
bash scripts/deploy.sh
```

`DEPLOY_ENV` 只接受空串（正式）或 `preview`。脚本依次执行：环境自检、`tsc -b`、`vite build`、清理系统垃圾文件、产物体积报告与限额检查（单文件 ≤ 25 MiB、文件数 ≤ 20000）、`_headers` 覆盖检查、远端 D1 迁移、`wrangler deploy`。`DRY_RUN=1` 在远端迁移前退出；它与 `npx wrangler deploy --dry-run` 都只证明本地构建与打包，不是发布证据。

`public/_headers` 定义缓存与安全头：

| 路径 | Cache-Control |
| --- | --- |
| `/build/*`（带内容哈希的 JS/CSS） | `public, max-age=31536000, immutable` |
| `/assets/art/*`、`/assets/cards/*`、`/assets/placeholder/*` | `public, max-age=86400, stale-while-revalidate=604800` |
| `/assets/manifest.json`、`/index.html`、`/` | `no-cache` |

素材文件名不带内容哈希，按子目录写死规则以避免同一响应命中多条 `Cache-Control`；脚本检查 `dist/assets/` 下每个文件都被覆盖。`cards/` 规则保留，当前卡图实际在 `assets/art/cards/`。根目录的 `favicon.png`（128×128）与 `favicon.ico`（16/32）不在素材规则内。全站安全头为 `X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin` 与 `X-Frame-Options: DENY`，当前不设置 CSP。

//TODO - 引入 CSP 前用 `Content-Security-Policy-Report-Only` 跑满首页、比赛、结算、通行密钥注册/登录与导出助记词流程，Chrome/Safari 桌面与移动各一遍；上报为零后再切换为强制头。

## 4. 规范域名与通行密钥

`src/chain/network.ts/defaultRpId()` 返回当前 `location.hostname`，本地使用 `localhost`（通行密钥不接受 IP 字面量，开发服务器固定监听 `localhost`）。`src/chain/canonicalHost.ts/enforceCanonicalHost()` 在 React 挂载前把非规范域名跳转到规范域名，保留路径、查询串与片段；本机、回环、私有网段、`.localhost` 与 `.local` 放行。

```bash
VITE_CANONICAL_HOST=pony.example.com bash scripts/deploy.sh
VITE_CANONICAL_HOST= bash scripts/deploy.sh
```

通行密钥受 `rpId` 限制，换域名后不能用原域的凭据恢复，不同域注册不是同一账户。preview 验收若需停留在 preview 域，应在构建时关闭或改设规范域名，并使用该域自己的测试凭据。

## 5. Keeper

Keeper 只回收可判负的会话，不代玩家结算或封锚。核心逻辑在 `src/chain/keeper.ts`，有两个入口：

- **命令行**：`PONY_GAME=0x… bun scripts/keeper.ts`，默认 dry run；`--send` 或 `KEEPER_SEND=1` 才发送判负交易，此时需要 `DEPLOYER_PRIVATE_KEY_PATH`；`--loop` 持续运行。命令行版不限制扫描块数，也不校验 chainId。
- **Worker scheduled**：`scripts/Wrangler/worker/keeper.ts` 把状态存入 D1，每次最多扫描 1000 块，校验 chainId 10143，发送租约 15 分钟。RPC、Game 与起始块在 `wrangler.toml` 的 `[vars]`（`KEEPER_RPC_URL`、`KEEPER_GAME_ADDRESS`、`KEEPER_FROM_BLOCK`），私钥通过 secret 设置：

```bash
npx wrangler secret put KEEPER_PRIVATE_KEY --env ''
```

求时器故障类判负只有 Game owner 能发送；Keeper 私钥不是 owner 时，这类会话停在待处理状态。preview 没有 cron 与 Keeper vars；手动验收 scheduled 路径须显式提供，不能把正式环境的配置视为 preview 已配置。

## 6. Envio

`envio/` 是 git submodule，使用 Envio HyperIndex 3.12.1，从 Game 部署块开始索引当前 Game 与 Vault，通过 `RewardsBound`、`VaultBound` 动态注册账本与 Vault（索引范围见[链上架构 §7](onchain.md)）。

```bash
git submodule update --init
cd envio && pnpm install --frozen-lockfile && pnpm codegen
pnpm typecheck && pnpm test
```

`pnpm smoke` 用真实 HyperSync 区块核对绑定、名单与结算，需要 `ENVIO_API_TOKEN`；Envio Cloud 自带 HyperSync 访问。Cloud 激活与公开 GraphQL 的真实查询才是部署证据，离线处理器测试不够。

## 7. 发布验收

构建、打包、迁移和发布分别记录结果；发布脚本输出的站点 URL 不证明站点健康。真实交付须记录目标、命令、交易或 Worker 版本及独立查询结果，历史测试数量、曾注资的金额或曾经 Active 的索引器状态不能当作当前状态。

//TODO - 正式发布后记录 Worker/cron 版本与 D1 迁移状态，在 `ponygo.kiruno.cc` 验证通行密钥注册/重登、图鉴读写、409 冲突恢复、双设备恢复与跨身份隔离；同步核对 RPC 合约绑定、Keeper 私钥权限与公开 Envio 查询，不能以仓库配置代替线上验收。
