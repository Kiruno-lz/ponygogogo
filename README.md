# Ponygogogo

Monad 上的横向赛马社交游戏。每场五匹马，玩家挑一匹作为自己的马，与其余四匹电脑马竞速，目标玩法用至多三次选牌改变成绩；gogo 点击只调整镜头构图。免费本地 Demo 允许 0 下注；有奖场次由 ERC-20 Vault 处理下注，既有金额难度档位不在本轮调整。

当前的[最小 Demo](docs/plan/demo.md) 已经可玩：加载页、首页、选马下注、起跑倒计时、竞速与 gogo 镜头输入、三次检查点选牌、冲线结算、分享出图、再来一局构成一条完整动线。当前游戏逻辑全部由前端执行，属于本地 Demo，不具备可付款的排名证明。

**钱包已接 Monad 测试网**：首页的注册先让你给通行密钥取个名字（默认 `ponygogogo`），确认后用 Mera 建密钥、派生出地址并自动领一次测试币；登录唤起同一把通行密钥回到同一个地址。钱包牌子上能看到地址摘要、链上余额和退出登录，点开是完整地址、重新领币和导出助记词。比赛的入场与结算仍由本地 mock 代替，目标有奖版本需要入场、各次选牌/随机锚确认及结算交易；合约独立复算名次。

比赛结果不在开局确定：目标规则以 seed 和可验证选择区块哈希固定随机效果；五匹马消耗体力获取固定加速度，性格决定基础速度上限，百分比卡乘当前基础速度且彼此加算，固定值卡加在百分比之外，体力见底进入【力竭】、回满后退出。电脑马不按玩家身位追赶；gogo 只动镜头。C-09 每 2 秒向其他四赛道之一自动交换，C-11 常态起飞并在火焰满层后爆发加速，重力井随实时距离连续变化。选牌慢动作按真实经过时间运行；合约直接求五马冲线时间与物理排序，再链上检测【版本答案】得到派奖排序，不按浏览器名次结算。当前代码仍是旧规则的本地 Demo，这些目标尚未实现。

## 运行

```bash
bash scripts/dev.sh          # 环境自检 → 素材与清单 → 端口释放 → 启动 Vite → 健康检查
```

首次运行会自动补齐素材：缺母版时 `scripts/process-assets.py` 从 `art-src/renders/` 的渲染图切片、`scripts/fetch-audio.sh` 拉取 CC0 音频，再由 `scripts/build-web-assets.py` 生成 `public/assets/` 下的部署产物。产物已提交进仓库，正常情况下这一步会整段跳过（见[素材管线说明](scripts/README-assets.md)）。

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
| [玩法设计](docs/game-design.md) | 五马体力—加速度竞速、真实时间慢动作、gogo 镜头与可验证随机 |
| [卡牌设计](docs/card-design.md) | 卡牌清单、效果原语、状态与装备词条、发牌规则修正与美术需求 |
| [总体架构](docs/architecture/overall.md) | 纯前端模块与合约边界、技术选型 |
| [效果系统架构](docs/architecture/effect-system.md) | 比赛骨架与可插拔效果模块的边界、扩展点与写权限 |
| [链上与经济](docs/chain-and-economy.md) | 链上五马验证、Vault 与结算不变量 |
| [最小 Demo 计划](docs/plan/demo.md) | 当前本地 Demo 说明；有奖规则以最新玩法与链上架构为准 |
| [交付计划](docs/plan/delivery.md) | 含链的完整阶段划分与验收 |
| [无服务端方案探索](docs/_reaserch/serverless.md) | 历史探索；不作为当前有奖规则依据 |

## 原则

- 先在浏览器内交付可玩的最小 demo，按完整场景逐层加入链上能力。
- 多巴胺反馈优先于平衡与收益模型；开局就能算出结局的比赛没有游戏性。
- 本地 Demo 不具备防伪造排名能力；有奖版本必须先完成合约独立复算。
- 有奖会话的超时、退款和结算由冻结链上规则管理；浏览器退出不能直接决定 Vault 资金。
- seed、选择交易的可验证区块哈希和规则版本共同决定随机效果；公平性仍须评估重试与排序偏差。
- 浏览器实时预览名次，合约独立复算并决定奖金。
- 未完成的验证使用 `//TODO -` 与具体测试方法标注，不把研究方向写成已实现能力。
