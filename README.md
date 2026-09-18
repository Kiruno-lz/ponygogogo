# Ponygogogo

Monad 上的横向赛马社交游戏。每场五匹马，玩家挑一匹作为自己的马，与其余四匹电脑马竞速，通过节奏点击和三次选牌争取率先冲线。下注允许 0 MON；下注越多，电脑马越可能跑得凶。

当前的[最小 Demo](docs/plan/demo.md) 已经可玩：加载页、首页、选马下注、起跑倒计时、竞速与节奏输入、三次检查点选牌、冲线结算、分享出图、再来一局构成一条完整动线。游戏时逻辑全部由前端执行，没有服务端，也没有运营方裁判。

**钱包已接 Monad 测试网**：首页的注册先让你给通行密钥取个名字（默认 `ponygogogo`），确认后用 Mera 建密钥、派生出地址并自动领一次测试币；登录唤起同一把通行密钥回到同一个地址。钱包牌子上能看到地址摘要、链上余额和退出登录，点开是完整地址、重新领币和导出助记词。比赛的入场与结算仍由本地 mock 代替，接链时沿用两笔交易：入场交易存入下注并派生本场 seed，结算交易提交浏览器算出的名次。

比赛结果不在开局确定：seed 只固定发到玩家手里的一副 14 张牌堆（互不重复），电脑马用橡皮筋 AI 实时追赶玩家位置，名次在冲线那一刻才产生。当前不设计任何防作弊机制；将来合约也不复算比赛过程，名次以浏览器的运行结果为准。

## 运行

```bash
bash scripts/dev.sh          # 环境自检 → 素材与清单 → 端口释放 → 启动 Vite → 健康检查
```

首次运行会自动补齐占位素材（`scripts/process-assets.py` 从 `assrt/` 的渲染图切片、`scripts/fetch-audio.sh` 拉取 CC0 音频）。

用 **http://localhost:5173** 打开，不要用 `http://127.0.0.1:5173`：通行密钥的 rpId 不接受 IP 字面量，浏览器会直接拒绝创建。桌面版 Chrome 还要求把通行密钥存进 Google 密码管理器才带 PRF 扩展，存在本地 profile 的用不了；1Password、iCloud 钥匙串、Windows 密码管理器与 YubiKey 均可。手动领测试币用 `bash scripts/get_faucet.sh <address>`，它和游戏内领币打的是同一个水龙头端点。

调试参数：`?seed=0x…` 固定发牌、`?mockDelay=0|5000` 调 mock 出块延迟、`?mockFail=enter|settle` 注入失败、`?mockAssetFail=<key片段>` 注入资源加载失败、`?raceSpeed=1..40` 加速模拟时钟（只改每 tick 对应的现实毫秒，结果逐字段不变）。

## 验证

```bash
bun run typecheck                    # bun tsc -b
bun test src                         # L1 规则内核与效果模块
bun test tests/api                   # L2 ChainPort 契约、记录编码与通行密钥钱包契约
bun run sweep -- --seeds 500         # 批量交互回归
bun run test:e2e                     # L3 完整动线、钱包动线、失败路径、动效与确定性
```

React 相关体检由使用者自行执行 `npx -y react-doctor@latest`。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [玩法设计](docs/game-design.md) | 八马竞速、抽卡与卡牌构筑、快跑、电脑马橡皮筋 AI 与金额难度 |
| [卡牌设计](docs/card-design.md) | 卡牌清单、效果原语、状态与装备词条、发牌规则修正与美术需求 |
| [总体架构](docs/architecture/overall.md) | 纯前端模块与合约边界、技术选型 |
| [效果系统架构](docs/architecture/effect-system.md) | 比赛骨架与可插拔效果模块的边界、扩展点与写权限 |
| [链上与经济](docs/chain-and-economy.md) | 一次性比赛、Vault、0 下注和结算记录 |
| [最小 Demo 计划](docs/plan/demo.md) | **当前正在执行的计划**：把游戏做完整做好玩，并接上通行密钥钱包 |
| [交付计划](docs/plan/delivery.md) | 含链的完整阶段划分与验收 |
| [无服务端方案探索](docs/_reaserch/serverless.md) | demo 阶段的信任边界，以及将来怎么加验证 |

## 原则

- 先在浏览器内交付可玩的最小 demo，按完整场景逐层加入链上能力。
- 多巴胺反馈优先于平衡与收益模型；开局就能算出结局的比赛没有游戏性。
- 不做防作弊是当前版本的明确取舍，不是待补的漏洞；文案不得把任何链上校验说成防作弊手段。
- 比赛不保存中途进度；退出视为放弃，下注留在 Vault。
- seed 在入场交易内派生并存储，运营方无法指定；它的唯一职责是让发牌可被事后验证为随机，不决定比赛结果。
- 名次由浏览器实时模拟产生并提交，合约只管钱和记录。
- 未完成的验证使用 `//TODO -` 与具体测试方法标注，不把研究方向写成已实现能力。
