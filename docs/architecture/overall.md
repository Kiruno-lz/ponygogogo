# 技术架构

## 1. 总体模型

React/Vite 前端负责页面、输入与比赛预览，Phaser 绘制赛道；TypeScript 事件求时器为免费试玩与有奖比赛提供同一套确定性规则与轨迹。Monad 上的 PonyGame/PaidRaceSolver 独立复算有奖结果，PonyVault 执行下注托管与付款。Envio 提供事件历史，Cloudflare Worker/D1 同步图鉴密文。

```text
Mera 通行密钥 → 根 EOA → Alchemy sma-b → PonyGame → PaidRaceSolver
                                            ├─ PonyVault → 智能账户返还
                                            └─ PonyRewards → 获得位图
合约事件 → Envio → 浏览器战绩
独立 PRF → 浏览器图鉴加密/签名 → 同源 Worker → D1 密文
```

| 主题 | 文档 |
| --- | --- |
| 比赛流程、里程、牌堆、运动与体力参数、角色能力、结算展示规则 | [玩法设计](game-design.md) |
| 效果原语、状态与装备、40 张卡、美术需求 | [卡牌设计](card-design.md) |
| 求时器边界、效果实例、写入边界、事件顺序；表现层的场景、页面、素材与结算 | [效果系统](effect-system.md) |
| 账户、合约、Vault 与赔率、规则输入与时钟、随机锚、链上结算、索引与图鉴、交易恢复 | [链上架构](onchain.md) |
| 构建变量、合约部署、Cloudflare、Keeper、Envio、发布验收 | [部署与服务](deploy.md) |

## 2. 模块边界

| 模块 | 职责 |
| --- | --- |
| `src/main.tsx`、`src/App.tsx` | 规范域名跳转后挂载；页面状态、资源门与浮窗 |
| `src/app/`、`src/assets/` | manifest、分级加载、重试、后台预取与音频 |
| `src/ui/loading/`、`src/ui/home/`、`src/ui/settings/`、`src/ui/shared/` | 加载页与分级门、首页、设置、共享舞台缩放与对话框 |
| `src/ui/wallet/` | 通行密钥仪式、账户状态、余额、助记词展示与战绩 |
| `src/ui/select/` | 选马队列与下注档位 |
| `src/ui/race/` | 比赛页与 HUD、Phaser 生命周期；`usePaidRace` 管理有奖会话的开场、选牌、结算与恢复 |
| `src/ui/collection/` | 图鉴页与收藏进度合并、同步 |
| `src/ui/showcase/` | 开发特效验收入口，仅开发构建可见 |
| `src/chain/` | 网络配置、规范域名、账户、会话读写、资金、随机锚期限、奖励、图鉴协议与 Keeper 核心 |
| `src/race/paid/`、`src/race/core/`、`src/race/cards/` | 规范表、整数求时、随机派生、发牌、排序与卡面数据 |
| `src/race/*.ts` | 试玩与有奖驱动器、规范轨迹到场景快照的转换 |
| `src/practice.ts` | 试玩 seed 解析与本地局号 |
| `src/game/` | 角色目录、Phaser 场景、挂点、动画、镜头与特效验收驱动 |
| `src/cards/` | DOM 卡面与选牌面板 |
| `src/result/`、`src/export/` | 结算页、获得窗口与海报导出 |
| `scripts/Wrangler/` | 同源图鉴 API、SPA 回退与 scheduled Keeper；D1 迁移 |
| `contracts/` | Solidity 权威规则与资金（[链上架构 §3.3](onchain.md)） |
| `envio/` | 独立索引器读模型（git submodule） |
