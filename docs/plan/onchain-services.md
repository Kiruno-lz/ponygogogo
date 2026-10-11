# 链上服务交付

## 1. 当前基线

当前产品、会话协议、收藏格式和规则为 v0.1；包版本为 0.1.0。正式范围仅 Monad 测试网（chainId 10143），不包含主网。代码只保留当前 ABI、规则、名单与部署记录。

| 合约 | 当前地址 | 部署块 |
| --- | --- | --- |
| PaidRaceSolver | `0xEAb3720908E36584b88f85c85b5Cb91c3ba798f0` | 69477580 |
| PonyRewards | `0xaa4181704974A86D4964f6e6f34Ed8Af570882b7` | 69477585 |
| PonyGame | `0x84a319aa7dAdE1fBD49FE135bb70feeD937eCe82` | 69477594 |
| PonyVault | `0xDe96ccC9874894Bf0004845407585cC192e2fa8d` | 69477607 |

规则哈希：`0x879f0d8d0cd93a3dc8bd9ceb80d2a692c239613042b55a43c0b6473a0c950f69`。

2026-10-09 实际部署四份合约，注册 Rewards 权限、绑定 Vault、注资 30 MON；七笔回执均成功。RPC 核对 owner、solver、rewards、双向 Game/Vault 绑定与规则哈希一致；入场已开放。旧 Game/Vault 已暂停，庄家测试资金取回，项目不留旧地址、资金恢复入口或兼容测试。

## 2. 服务边界

Mera 通行密钥 PRF 恢复根 EOA，根账户只签名并拥有 Alchemy Modular Account 的 sma-b。领水、下注和返还均使用智能账户；不保留根账户历史余额迁入流程。

Game 开场直接收取原生 MON 并同笔转给 Vault；Vault 维护锁定下注 L、庄家流动性 H、净赔付预留 R，满足 `balance >= H + L`、`H >= R`。没有玩家存取款账本或退款入口。返还倍数按结算名次为 3/2/1/0.5/0，下注档位为 0.3/1/5/10 MON。

Solver 单体部署，Engine/Motion/Cold 是内部源码边界；无外部 Support、状态搬运 ABI 或 DELEGATECALL。TS 与 Solidity 共用生成规则和向量，详见[链上架构](../architecture/onchain.md)、[卡牌设计](../card-design.md)。

正常结算独立抽取收藏奖励，由 PonyRewards 记录位图。获得窗口、图鉴同步与海报读取回执事实，不把预览当成获得事实。名单按 `roster[raceHorseId]` 映射，历史查询要求有效名单。

Envio 只提供可回滚历史与统计。当前 Game 的 RewardsBound 注册当前奖励账本；VaultBound 注册当前 Vault。配置与 ABI 位于 envio，起始块 69477594；当前提交 `893763f` 已 Active，公开查询端点为 `https://indexer.dev.hyperindex.xyz/10ba62e/v1/graphql`，名单、结算与奖励表已实测，旧测试索引器已删除，控制台只剩当前部署。资金和会话终态始终从 RPC/合约读取。

## 3. 结算与 Keeper

`openSession` 冻结名单、下注、seed 与开场块；`chooseCard` 记录规范交易秒及区块，选择有效性由结算求时判断；`settleSession` 封锚并复算五马结果后付款，不接收客户端名次。

随机锚保留窗口为 8191 块。未封存的必要锚过窗允许任何人判负；求时器故障的会话开场满一天后仅 owner 可判负。Keeper 只扫描、模拟和回收可判负会话，不代玩家结算或封锚。

- `src/chain/keeper.ts` 是共享核心，`scripts/keeper.ts` 为默认 dry run 的 CLI；`--send` 才发送。
- Cloudflare scheduled 入口复用核心，每两分钟执行。D1 保存扫描游标和开放会话，租约阻止并发发送；每次最多扫描 1000 块，重启接续扫描。
- RPC、当前 Game、起始块是 Worker vars；密钥仅放 `KEEPER_PRIVATE_KEY` secret。只能连接 chainId 10143；preview 不启用 cron。

## 4. 验收与未完成

源码/API/Foundry/浏览器及真实会话、索引器发布的最终结果统一记在[测试开发收尾](testnet-closeout.md)。合约大小与 Monad 计算成本例行检查按本次要求不重复执行。

**Cloudflare 实际配置、D1 迁移、Worker/cron 发布及正式域名通行密钥和收藏往返未完成，已获准留到主分支。** 仓库配置和迁移文件不等同于线上服务已经交付，执行顺序见[部署文档](deploy.md)。
