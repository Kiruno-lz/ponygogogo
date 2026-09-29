# Ponygogogo

Monad 上的五马赛马游戏。玩家选一匹马，其余四匹由电脑控制；gogo 只调整镜头。0 MON 为免费本地试玩；测试网有奖档位使用 Vault 托管的原生 MON，名次由 PonyGame 按冻结规则独立复算。现行产品、玩法与技术边界见[项目决策](docs/decision.md)。

## 运行

```bash
bash scripts/dev.sh
```

使用 `http://localhost:5173` 打开本地开发站点。通行密钥的 WebAuthn PRF 使用正式域名作为 `rpId`；本地账户与正式站点账户不同。测试网充值入口只用于开发验收。

运行时素材已生成到 `public/assets/` 并随项目管理。`art-src/` 保存作者本地的美术母版，不纳入 Git；改动或重新生成素材需要本地保留母版。素材生成说明见[素材管线](scripts/README-assets.md)。

## 验证

```bash
bun run build
bun test src
bun --no-env-file test tests/api
forge test
cd envio && bun test
```

需要运行浏览器回归时：

```bash
bun run test:e2e
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [项目决策](docs/decision.md) | 当前有效的产品、玩法、经济、账户、规则与部署决策 |
| [玩法设计](docs/game-design.md) | 比赛流程、五马规则、检查点、求时与结算展示 |
| [卡牌设计](docs/card-design.md) | 卡牌规则、效果模块、发牌与素材需求 |
| [链上架构](docs/architecture/onchain.md) | 账户边界、MON Vault、随机输入、链上结算与 Envio |
| [效果系统架构](docs/architecture/effect-system.md) | 规则骨架、模块边界与写权限 |
| [链上与经济](docs/chain-and-economy.md) | 会话、赔率、Vault 偿付与交易状态 |
| [部署](docs/plan/deploy.md) | Cloudflare Worker、D1、静态资源构建与部署 |
| [链上服务交付](docs/plan/onchain-services.md) | 测试网状态、验收证据与剩余上线门槛 |
