# 部署

## 1. 发布入口

静态资源、同源图鉴 API、D1 与 Keeper 部署到 Cloudflare Workers。根 `wrangler.toml` 是配置入口：正式 Worker 名为 `ponygo`，preview 为 `ponygogogo-preview`；正式规范域名默认为 `ponygo.kiruno.cc`。Worker 自定义域绑定和服务凭据需在 Cloudflare 配置。

从仓库根目录执行：

```bash
DRY_RUN=1 bash scripts/deploy.sh
npx wrangler deploy --dry-run --env ''
DEPLOY_ENV=preview bash scripts/deploy.sh
DEPLOY_ENV= bash scripts/deploy.sh
```

`DEPLOY_ENV` 只接受空串或 `preview`。脚本按类型检查、Vite 生产构建、垃圾文件清理、产物限制和缓存覆盖检查、远端 D1 迁移、Worker 发布的顺序执行。`DRY_RUN=1` 在远端迁移前退出；Wrangler dry run 只打包，二者都不是发布证据。`bun run deploy` 调用同一脚本。

构建使用项目环境中的 `VITE_PONY_GAME_ADDRESS`、`VITE_PONY_VAULT_ADDRESS`、`VITE_ALCHEMY_API_KEY` 与 `VITE_ENVIO_GRAPHQL_URL`，逐项含义见对应 `src/chain/` 模块。`VITE_*` 会进入浏览器包；服务私钥、ENVIO_API_TOKEN 和 Cloudflare 凭据使用服务端环境或 secret。浏览器没有默认 Game/Vault 和 Envio 端点。

## 2. Worker、D1 与 Keeper

| 项目 | 仓库配置 |
| --- | --- |
| Worker 入口 | `scripts/Wrangler/worker/collection.ts` |
| 静态资源 | `dist/`，绑定 `ASSETS` |
| 优先进入 Worker 的路由 | `/api/collection*` |
| 缺失静态路径 | `not_found_handling = "none"`，不配置 SPA 回退 |
| D1 绑定 / 迁移目录 | `COLLECTION_DB` / `scripts/Wrangler/migrations/` |
| production / preview 数据库 | `ponygogogo-collection-production` / `ponygogogo-collection-preview` |
| production cron / preview cron | 每两分钟 / 空列表 |

Worker 处理图鉴 challenge/read/write，其余请求交给 ASSETS。D1 迁移 0001/0002 建立收藏、挑战与限流；0003 清空测试收藏、挑战和限流记录；0004 建立 Keeper 游标、开放会话和租约表。发布脚本对所选环境执行尚未应用的迁移，不会每次重新清空已迁移数据库。

正式 Keeper 使用 `[vars]` 中的 `KEEPER_RPC_URL`、`KEEPER_GAME_ADDRESS`、`KEEPER_FROM_BLOCK`，服务密钥通过以下命令设置：

```bash
npx wrangler secret put KEEPER_PRIVATE_KEY --env ''
```

preview 没有 cron。若要手动验收 scheduled 路径，需明确提供它的 Keeper vars 和 secret，不能把正式环境 vars 的配置视为 preview 已配置。

## 3. 产物与缓存

运行时素材已提交到 `public/assets/`；正常构建不重新生成美术。`art-src/` 是本地母版，不随 Git 或部署上传。Vite 把 `public/` 复制到 `dist/`，JS/CSS 在 `dist/build/`。

`public/_headers` 定义以下缓存与安全头：

| 路径 | Cache-Control |
| --- | --- |
| `/build/*` | `public, max-age=31536000, immutable` |
| `/assets/art/*`、`/assets/cards/*`、`/assets/placeholder/*` | `public, max-age=86400, stale-while-revalidate=604800` |
| `/assets/manifest.json`、`/index.html`、`/` | `no-cache` |

素材文件名不带内容哈希，使用短缓存；JS/CSS 带内容哈希，使用 immutable。缓存规则按子目录分开，脚本检查所有 `dist/assets/` 文件都被覆盖。`cards/` 规则仍在配置中，当前 40 张卡图的实际路径为 `assets/art/cards/card-N.webp`。

全站头为 `X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin` 和 `X-Frame-Options: DENY`；当前不设置 CSP。

脚本执行的产物门槛为：单文件 ≤25 MiB、文件总数 ≤20000、`_headers` 存在、所有素材被缓存规则覆盖。这是仓库的发布检查值；实际平台配额以目标账户配置为准。当前素材大小和质量须从本次产物及[素材管线](../../scripts/README-assets.md)检查取得，不沿用历史体积表。

//TODO - 引入 CSP 前用 Report-Only 运行首页、比赛、结算、通行密钥注册/登录和导出流程，在目标浏览器核对上报；确认实际资源和脚本路径后再设置强制头。

## 4. 规范域名与通行密钥

`src/chain/network.ts/defaultRpId()` 返回当前 `location.hostname`，本地访问使用 `localhost`。`src/chain/canonicalHost.ts/enforceCanonicalHost()` 在 React 挂载前把非规范域名跳转到规范域名，保留路径、查询串与片段；本机、回环、私有网段、`.localhost` 与 `.local` 放行。

默认规范域名为 `ponygo.kiruno.cc`，构建期可覆盖或关闭：

```bash
VITE_CANONICAL_HOST=pony.example.com bash scripts/deploy.sh
VITE_CANONICAL_HOST= bash scripts/deploy.sh
```

通行密钥受 rpId 限制，换域名后不能直接用原域的凭据恢复；不能把不同域注册当作同一账户。preview 验收若需停留在 preview 域，应在构建时关闭或设定规范域名，并使用该域自己的测试凭据。

## 5. 发布验收

构建、打包、迁移和发布分别记录结果。发布脚本输出的站点 URL 不证明站点健康；实际发布后须核对 Worker 版本、域名绑定、D1 迁移、Keeper secret/cron 与静态路径，执行正式域名的通行密钥注册、重登及收藏往返。双设备恢复、冲突合并与身份隔离须在远端服务验证。

链上和索引器配置与验收入口见[链上服务](onchain-services.md)。仓库配置不能证明服务已经在线；历史收尾验收已移入[归档](../_archive/README.md)。
