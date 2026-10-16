# 通行密钥图鉴与收藏奖励

## 当前范围

正常有奖结算独立抽取收藏奖励：获得概率 20%，未拥有稀有卡权重 1、非默认角色权重 3。`PonyRewards` 记录链上位图，`CollectibleGranted` 回执是获得事实；试玩与判负不抽取。图鉴同时保存稀有卡与角色，角色解锁用于选马，私有图鉴不筛选有奖牌池。

`src/ui/collection/useCollectionProgress.ts` 接入读取、链上位图对账、赛后写入与冲突并集合并；结算获得窗口和海报复用 `src/result/collectibleView.ts`。所有中文说明位于 `src/ui/i18n.ts`，规则数值从规范表插值。

## 数据边界

- Mera 通行密钥以独立用途域派生 AES-256-GCM 密钥与 Ed25519 同步身份；`src/chain/collectionIdentity.ts` 负责用途域与凭据核验，钱包管理身份生命周期和敏感材料清零。
- 明文 `schemaVersion: "0.1"` 保存 `rareCardIds`、`unlockedPonyIds`。密文 envelope 为 0.1；AES 附加认证、签名及两种 PRF 用途域统一为 v0.1。不读取旧格式、旧数组或旧测试密文。
- 浏览器加密；D1 只保存密文、IV、公钥及其哈希、公开格式和并发计数，另存一次性挑战及按 IP 哈希的限流计数。明文和解密材料只在浏览器内存。
- 签名绑定来源、方法、路由、挑战 ID、载荷；`expectedVersion` 是条件写计数，冲突返回 409，客户端解密最新数据后求并集。它不表示产品版本。
- D1 不证明链上所有权或奖励合法性。解密失败、未知格式与网络错误不能报告未确认奖励为已获得；新基线切换时由迁移清空测试记录。

## 服务与验收

`POST /api/collection/challenge` 创建一次性挑战；`POST /api/collection/read` 验签读取；`PUT /api/collection` 验签条件写。入口为 `scripts/Wrangler/worker/collection.ts`。迁移 0003 清空测试记录，0004 创建 Keeper 状态表。

正式域名固定 `ponygo.kiruno.cc`，保持 WebAuthn rpId；正式 Worker 为 `ponygo`，preview 为 `ponygogogo-preview`。

正式部署按[部署文档](deploy.md)配置 D1、迁移和 Worker。上线验收须验证正式域名通行密钥首次写入、重新登录读取与解密、冲突恢复、双设备恢复、跨身份隔离。仓库内协议测试通过不能替代这项实际验收。
