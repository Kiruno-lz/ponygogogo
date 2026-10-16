# 角色名单与初始能力

## 1. 当前规则

九名角色使用稳定 ponyId。比赛中的 raceHorseId 是五个参赛槽位，不能当作角色身份；角色名称、能力与素材按 `roster[raceHorseId]` 查询。名单包含五个不同且启用的 ponyId，开场冻结，不随交换赛道或位置变化。

角色定义与能力数值以 `src/race/paid/ponyRules.ts` 为唯一来源，生成 `contracts/libraries/PonyRules.sol`；名单与能力共同进入 v0.1 规则哈希。中文和英文名称、能力标题与描述模板统一在 `src/ui/i18n.ts`，数值由规则表插值。美术字使用图片素材。

默认开放 ponyId 0–4；其余角色由链上奖励与加密图鉴进度解锁。正常选马队列将已开放角色洗牌，通过箭头移动五名可见角色窗口；显式试玩 `?seed=` 同时固定队列随机数；正常入口只允许已开放角色。特效验收入口复用同一选马、比赛与结果组件，开放完整角色目录用于预览。

## 2. 模块边界

- `src/game/ponyCatalog.ts` 聚合稳定身份、素材与显示信息；规则内核不读取美术资源。
- `src/race/core/roster.ts` 校验名单；生产链输入及历史响应必须携带有效名单，不接受旧 ABI 或缺少名单的读模型降级。
- `PaidRaceSolver` 与 TS 求时器按槽位派生比赛参数，再应用该角色的初始能力。免费试玩与有奖比赛共用规则；gogo 只影响镜头表现。
- `PonyRewards` 独立记录奖励；结算与判负均以独立熵抽取，仅试玩不抽取新的角色和卡牌。获得物不参与本场名次或返奖计算。
- `src/ui/collection/useCollectionProgress.ts` 合并链上位图和解密收藏，赛后写入并展示获得窗口；收藏的当前格式与服务验收见[图鉴与收藏奖励](card-collection-unlock.md)。
- `src/ui/race/useRaceScene.ts` 只预载本场五名角色，管理 Phaser 创建、销毁与重试；HUD、战绩、结算与海报沿用名单身份。

## 3. 验证

`gen-pony-rules.ts --check` 和 `gen-reward-rules.ts --check` 防止规则生成物漂移。`tests/vectors/pony-race-v0.1.json` 的 288 组向量覆盖角色能力与 TS/Solidity 一致性；生产输入另由本地链 API 验证。浏览器用例覆盖九角色队列、卡牌特效、结算获得窗口与海报。

服务配置与验收入口见[链上服务](onchain-services.md)、[部署](deploy.md)。仓库测试与配置文件不能证明正式域名已经完成部署验收。
