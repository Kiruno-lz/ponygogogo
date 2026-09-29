# 部署

[链上服务交付记录](onchain-services.md)维护部署验收状态；缓存、限制与命令只在本文定义。部署目标是 **Cloudflare Workers 静态资源**，正式域名 `ponygo.kiruno.cc`。Worker 本身与自定义域的绑定在 Cloudflare 侧管理，本文只管仓库这边的构建、缓存与核验。

## 1. 命令

```bash
# 本地/CI 一键构建 + 部署（环境自检 → tsc 类型检查 → vite build → 体积与限制核验 → wrangler 部署）
bash scripts/deploy.sh

# 只构建和核验，不部署
DRY_RUN=1 bash scripts/deploy.sh

# 已构建好 dist/ 时手动部署（名字与目录都从 wrangler.toml 读，不在命令行重复）
npx wrangler deploy
```

接 Git 自动构建时（Workers Builds），面板里两个字段填：

| 字段 | 值 |
| --- | --- |
| 构建命令 | `bun run build` |
| 部署命令 | `npx wrangler deploy` |

两者都是默认值，不需要改——配置的真源是 `wrangler.toml`，它声明了 `[assets] directory` 与 SPA 回退方式。

`package.json` 里也登记了 `bun run deploy`，等价于 `bash scripts/deploy.sh`；但本项目 `bun run <script>` 有已知故障（`CouldntReadCurrentDirectory`，见 `scripts/dev.sh` 的同类规避），确认可靠时一律直接执行 `bash scripts/deploy.sh`。首次部署或 CI 环境需要 `npx wrangler login`，或设置 `CLOUDFLARE_API_TOKEN` 环境变量。

## 2. 缓存策略

策略写在 `public/_headers`（随 `public/` 原样拷进 `dist/`，Workers 从静态资源目录根部读取；语法与 Pages 一致）。

| 路径 | Cache-Control | 理由 |
| --- | --- | --- |
| `/build/*` | `public, max-age=31536000, immutable` | Vite 自身的 JS/CSS 产物，文件名带 content hash，内容一变文件名必变 |
| `/assets/art/*`、`/assets/placeholder/*` | `public, max-age=86400, stale-while-revalidate=604800` | 美术素材文件名**不带 hash**（CSS 里约 30 处写死 `/assets/...` 路径，加 hash 需重写全部引用）；用 SWR 换更新可见性——命中缓存立即返回旧图，后台向源站校验，下一次请求换新版本 |
| `/assets/manifest.json` | `no-cache` | 资源清单是加载流程的前置数据，素材新旧全靠它的内容判断，必须每次校验 |
| `/index.html`、`/` | `no-cache` | 入口文档决定加载哪一版 JS/CSS，缓存住会让用户拿旧壳配新资源 |

素材不带 hash 是刻意决定，不是遗留问题；要换成 `immutable` 需要先把 CSS 里的路径引用改成构建期生成，不在部署阶段单方面推翻。

配套三条安全头对全站生效：`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY`——本项目无嵌入需求，三条足够。**不加 Content-Security-Policy**：Phaser 与 WebAuthn（PRF 扩展、认证器弹窗）各自会触发哪些资源加载与脚本执行路径尚未逐一测过，未验证的 CSP 上线后表现是功能静默失效而非报错，比不加更难查。

//TODO - 加 CSP 前用 `Content-Security-Policy-Report-Only` 跑满一次完整流程（首页、比赛、结算、通行密钥注册与登录、导出助记词），Chrome/Safari 桌面与移动各一遍，确认上报为零 violation 后再切换成强制头。

`_headers` 的一个实现细节：Cloudflare 对同一响应命中多条规则时按逗号拼接重复的头，不做覆盖，而 `Cache-Control` 是单值头，拼接即失效。这里不用 `! 头名` 去撤销外层规则，而是把素材规则按子目录写死成两条互不重叠的路径——产物顶层只有 `art/`、`placeholder/` 和 `manifest.json` 三样，逐个列出即可做到规则不重叠。理由是撤销语义本地无法验证，而它一旦不成立，后果是 `manifest.json` 被缓存一整天、玩家卡在一份指向已删文件的旧清单上；换成不重叠的路径就没有这个赌注。代价是管线将来新增顶层目录时会静默漏掉规则，`scripts/deploy.sh` 的覆盖核验守住这一条：`dist/assets/` 下出现不属于任何规则的文件即 `die`。

## 3. 域名与通行密钥

正式域名是 **`ponygo.kiruno.cc`**。Cloudflare 侧的项目与域名绑定不在本文范围内。

### 3.1 为什么只能有一个域名

账户由 WebAuthn 的 PRF 扩展派生，`rpId` 取 `location.hostname`（[架构第 6 节](../architecture/overall.md)），而 PRF 的输出决定助记词与地址。**同一个人在两个域名下注册，拿到的是两个不同的钱包地址。** 通行密钥永远绑在它被创建的那个域名上，换域名不是迁移而是断代，玩家只能用助记词重新导入。

所以 Pages 项目即便挂多个自定义域，这个应用也只认一个。

（真要让两个来源共享账户，WebAuthn 有 Related Origin Requests：`rpId` 固定，用 `/.well-known/webauthn` 声明允许的来源。浏览器支持面还窄，本项目不需要，不引入。）

### 3.2 规范域名由应用自己守

`src/chain/canonicalHost.ts` 的 `enforceCanonicalHost()` 在挂载 React 之前跑，域名不是 `ponygo.kiruno.cc` 就 `location.replace` 过去，路径、查询串与片段原样带过去。**后果是从任何别的域名打开都会落到规范域名**，包括 Pages 自带的 `*.pages.dev`。

放行规则写死在那里并有 L1 覆盖（`src/chain/canonicalHost.test.ts`）：本机、回环、私有网段与 `.local` 一律不跳——局域网真机试玩走的就是这些，而且本地那套 `rpId` 本来就不参与线上账户。

规范域名由构建期变量 `VITE_CANONICAL_HOST` 覆盖；设成空串则完全关掉跳转：

```bash
VITE_CANONICAL_HOST=pony.example.com bash scripts/deploy.sh   # 换一个规范域名
VITE_CANONICAL_HOST= bash scripts/deploy.sh                   # 不做任何跳转
```

//TODO - 上线后核对账户唯一性：在 `ponygo.kiruno.cc` 注册一把通行密钥记下地址，刷新后重新登录再记一次。判据是两次地址逐字符相等。不等说明 `rpId` 不稳定，回查 `defaultRpId()` 拿到的 host。

## 4. 部署路径取舍

**推荐：本地或 CI 跑 `scripts/deploy.sh`，用 wrangler 把 `dist/` 直传。** `art-src/` 是仅保存在作者本地的美术母版，不纳入 Git 与部署产物；发布所需的运行时素材已作为构建产物保存在 `public/assets/`，脚本只上传 `dist/`。

备选：Cloudflare Git 集成（Workers Builds），push 后自动构建。`art-src/` 不纳入 Git，构建环境只 clone 跟踪的源码与已提交的运行时素材；需要自动预览或发布时使用这条路径。

部署入口与目录由仓库根目录配置固定：`wrangler.toml` 的 Worker 入口是 `scripts/Wrangler/worker/collection.ts`，production 与 preview D1 均从 `scripts/Wrangler/migrations/` 读取迁移。Foundry 的 `foundry.toml` 将脚本目录设为 `scripts/`，合约部署入口为 `scripts/DeployPony.s.sol`。从仓库根目录执行部署命令，让 Wrangler 与 Foundry 读取这两份配置。

## 5. 平台限制核对

| 限制 | 数值 | 核验方式 |
| --- | --- | --- |
| 单文件大小 | ≤ 25 MiB | `scripts/deploy.sh` 构建后用 `find dist -size +25M` 扫描，超出即 `die` 并打印具体文件 |
| 单次版本文件数 | 免费计划 20000，付费计划 100000 | `scripts/deploy.sh` 默认按 20000 核验；确认项目开了付费计划后再放宽脚本里的 `MAX_FILE_COUNT` |

除这两条外，`scripts/deploy.sh` 还核验 `_headers` 确实进了产物，以及 `dist/assets/` 下每个文件都落在某条缓存规则内——三项都在构建后自动跑，不依赖人工目测。

SPA 回退不再用 `_redirects`，改由 `wrangler.toml` 的 `not_found_handling = "single-page-application"` 负责。它只对导航请求（`Sec-Fetch-Mode: navigate`）回退，所以一个拼错的图片路径会正常 404，而不是拿一份 HTML 冒充图片返回。

项目使用静态资源、图鉴 Worker 和 D1；平台用量与费用按 Cloudflare 当前计划和控制台数据核验，不在本文固化可能变动的价格承诺。

结论：产物远在两条硬限制之内，详见[素材管线说明](../../scripts/README-assets.md)里的体积表。
