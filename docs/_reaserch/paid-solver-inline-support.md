# 250 ms 求时器：Support 编入 Solver 的部署与 gas 对照

## 探索原因

研究基线的 Solver 已把 Engine、Motion、监听触发和门控修正编入同一热核心；独立部署的 Support 只提供开场派生、规则表、卡牌快照计划、发牌状态转移与最终排序。部署目标的 runtime/initcode 门槛为 131,072/262,144 B，主合约不再需要为了 EIP-170 将这些低频函数放到另一个地址。

取消 Support 地址会减少一次构造部署及外部 ABI 边界，但也让冷路径临时分配进入 Solver 的同一内存帧。此前 50 ms 的单体研究不能直接作为当前 250 ms 版本的依据；本轮以当前工作区为基线，比较保持冷路径源码模块、将其改为内部库的单体。

## 探索目标

- 保留 Engine/Motion/watch/gated 与冷路径的源码职责，唯一比赛状态与事件顺序仍由 Engine 持有。
- Support 不再独立部署，不保留占位地址、组件注册表或外部链接库。
- 相同 80 个生产输入的完整 RaceResult 哈希一致；355 个跨语言向量、已有 Foundry 测试与真实 Game 会话测试通过。
- 比较 runtime/initcode、构造成功性、Monad 创建 gas 估算，以及同一批输入在 Foundry 和 Monad 的平均/最大 solve gas。
- 不修改正式实现，不广播交易；探索后删除原型，保留结果与核心改法。

## 探索结果

### 源码与部署边界

| 部分 | 当前独立 Support | 编入 Solver 的原型 |
| --- | --- | --- |
| 热核心 | Engine/Motion/watch/gated 编入 Solver | 相同源码职责与算法 |
| 冷路径 | PaidRaceSupport 合约，七个 external pure 入口 | libraries/PaidRaceCold.sol，七个 internal pure 函数 |
| 比赛状态 | Engine 唯一拥有 | Engine 唯一拥有 |
| Solver 构造 | 创建 Support，immutable 绑定 | 无 Support 构造与地址字段 |
| 业务部署地址 | Solver、Support、Game、Vault | Solver、Game、Vault |
| 组件升级 | Solver/Support 整体不可变 | 整个 Solver 不可变 |

内部库保持属性/牌堆、规则表、快照计划、发牌与结算的领域文件；只取消外部 ABI 与地址边界，不合并成一个大源文件。创建码与运行码的 `linkReferences` 均为空，没有隐式链接库或 DELEGATECALL。

### 体积与部署可行性

| 指标 | 独立 Support | 冷路径编入 Solver |
| --- | ---: | ---: |
| Solver runtime | 25,728 B | 35,144 B |
| Support runtime | 15,708 B | 无独立部署 |
| 求时器合计 runtime | 41,436 B | 35,144 B |
| Solver initcode，含其构造中创建 Support 的代码 | 41,579 B | 35,172 B |
| Solver 与 EIP-170 的差额 | 超出 1,152 B | 超出 10,568 B |
| Solver 距 Monad runtime 上限余量 | 105,344 B | 95,928 B |
| Monad Solver 创建 gas 估算 | 9,091,427 | 7,684,715 |
| Solver/Game/Vault 完整部署、绑定、注资和开放入场的本地模拟 | 通过 | 通过 |

两种方案均满足 [Monad 体积上限](https://docs.monad.xyz/developer-essentials/differences)。单体的主合约增长 9,416 B，但全部求时器代码合计减少 6,292 B（15.18%），Solver 创建 gas 估算减少 15.47%。Game/Vault 本身的代码不变。

创建估算使用 Monad 测试网 eth_estimateGas，发送方为公开测试地址，只通过 state override 提供模拟余额；没有签名或广播。完整部署流程另在本地 anvil 上运行 DeployPony.s.sol，没有 --broadcast：两份脚本都完成构造、Game/Vault 绑定、100 MON 庄家模拟注资及开放入场，随后本地发送方 nonce 仍为 0。成功估算与模拟证明该代码能完成构造；它们不是已上链部署或支付费用的证据。

### 执行 gas

配置：Solc 0.8.28、optimizer runs=200、legacy 管线、EVM target=prague、重力井基步 250 ms，规则哈希为 `0xbb2c9df7e6a29f0c6c54510063905c4652e08e0e987b262484cc77eb46dae876`。两份隔离副本来自同一工作区快照，使用相同 80 个 derived-0..79 生产输入。

| 计价与范围 | 指标 | 独立 Support | 编入 Solver | 变化 |
| --- | --- | ---: | ---: | ---: |
| Monad，80 场生产 solve | 平均 | 2,512,423.30 | 2,419,787.11 | −3.69% |
| Monad，80 场生产 solve | 最大 | 3,955,438 | 3,853,531 | −2.58% |
| Foundry，以太坊计价，80 场生产 solve | 平均 | 2,779,973.55 | 2,931,600.85 | +5.45% |
| Foundry，以太坊计价，80 场生产 solve | 最大 | 4,431,947 | 4,701,015 | +6.07% |
| Monad，对抗向量的诊断内核 | worst-gas-adversarial-climb | 3,647,290 | 3,598,543 | −1.34% |

80 个生产样本在 Monad 下全部降低 gas，单场降幅为 2.58%～4.80%；两种计价下最大生产样本均为 derived-58。统计的是探针围绕 solver.solve 的调用开销，含调用与返回处理，不含 Game/Vault 结算、开场、Alchemy 账户或用户操作包装成本。对抗向量走显式 CoreInput 的诊断入口，不能与生产 solve 混作同一平均值。

Foundry 与 Monad 的排序相反。内部调用取消 ABI 编解码，但冷路径分配也进入同一个内存帧；Monad 的内存扩展采用线性计价，Foundry 1.5.0 使用以太坊计价，不能用其单体回归数字替代目标网络实测。本轮没有逐 opcode 分解，因此不把差额全部归因于某一项成本。[Monad 与以太坊差异](https://docs.monad.xyz/developer-essentials/differences)。

### 验证与判断

- 两份隔离副本分别通过全部 115 项 Foundry 测试。测试适配只删除 Support 地址字段、构造和传参，未删除用例或放宽断言。
- 355 个 TS/Solidity 向量逐字段、逐事件、逐 digest 对照通过，覆盖诊断面板、停止选项与所有卡牌。
- 80 场生产输入的完整 RaceResult 编码哈希在两份本地实现之间逐一一致；Monad state override 的结果哈希也分别与本地一致，并在两方案间 80/80 相等。
- 对抗诊断结果在两方案与两种执行环境中哈希一致；存储选择 fuzz 与真实 Game 会话测试保持通过。
- 两种方案全部部署组件通过 runtime/initcode 门禁，且没有创建码或运行码的库链接。

**在当前只面向 Monad 的要求下，建议取消 Support 的独立部署，保留冷路径内部库。** 它减少一个部署地址、构造估算成本和全部求时器代码，当前 80 场平均/最大 solve gas 同时下降。源码层仍可维护 Engine、Motion、规则与发牌的职责边界，Support 地址不提供独立升级能力。

上述数据来自实施前的隔离 dry-run，研究阶段未改正式实现或广播交易。方案已按用户决定落实，当前职责与验收以[链上架构](../architecture/onchain.md)和[交付记录](../plan/onchain-services.md)为准；固定的 paid-solver-contract-split.md 与其既有数据未修改。

## 复现说明

1. 将当前 contracts、scripts、src、tests、foundry.toml 与 package.json 复制为两份隔离目录，链接当前 node_modules，不复制 out/cache/broadcast 或密钥。配置保持上表不变。
2. 基线不改。原型将 Support 移为 libraries/PaidRaceCold.sol 内部库；删除 Solver 的 Support 构造与 immutable 字段、Engine 的 Options/State 中 Support 字段与相关传参，将冷路径调用改为 PaidRaceCold.*。七个库函数必须全部为 internal pure，calldata 参数改为 memory。
3. 对 PaidRaceSolverVectors.t.sol、PaidRaceNewCards.t.sol、PaidRaceHotCore.t.sol 做同样的地址/传参适配。保留所有向量、测试和 gas 断言。运行 forge test -vv：testColdProductionWorkload 会对每次调用前的组件地址执行 vm.cool，以新 self-call 的内存帧测量并输出 80 场 gas 与完整结果哈希。
4. 原型的 testExportMonadProbe 不再输出 Support 地址/运行码；measure-paid-solver.ts 的 state override 组件列表去除 Support。对两个目录运行 bun --no-env-file scripts/measure-paid-solver.ts，比较所有哈希、平均/最大与对抗诊断 gas。遵守公开 RPC 的 15 次/秒限制，批次之间至少留 450 ms；两方案顺序运行。
5. 从各自 out 读取 runtime/initcode，断言 Monad 上限及两种 linkReferences 为空。用 Solver 原始创建码进行 eth_estimateGas，不添加交易签名或广播。
6. 完整部署流程使用独立本地 anvil 与其公开开发账户，在各自隔离目录运行下面的模拟命令，将 PORT 替换为本地空闲端口。密钥只放在临时目录中，结束后删除；不要添加 --broadcast。检查两份输出的 SIMULATION COMPLETE 和发送方 nonce=0。

```bash
NO_PROXY=localhost,127.0.0.1 FOUNDRY_OFFLINE=true \
DEPLOYER_PRIVATE_KEY_PATH=keys/study.private \
HOUSE_FUND_WEI=100000000000000000000 UNPAUSE=1 \
forge script scripts/DeployPony.s.sol --rpc-url http://127.0.0.1:PORT \
  --code-size-limit 131072 --non-interactive
```

逐样本 gas、结果哈希、组件体积、编译配置与基线源码指纹保存在[测量数据](paid-solver-inline-support-results.json)。原型已清理，下面保留核心改法。

## 注意事项与补充

- 表中的最大值是 80 场样本最大值；对抗诊断输入也不是最坏合法生产输入证明。最坏可达场次的认证仍按项目决策在规则平衡后验收。
- Monad 按 gas limit 计费。降低测得的执行 gas 为降低 gas limit 提供依据，不自动保证既有交易请求的费用降低；最终结算与账户包装仍须整体估算。[Monad gas 计费](https://docs.monad.xyz/developer-essentials/gas-pricing)。
- 每事件运动推进、监听与门控不能重新穿越外部合约边界；库仍直接操作 Engine 持有的内存。
- 首次加载的规则缓存必须常驻。内部调用不自动产生独立内存帧，不能为了降 gas 在会返回持久指针的冷路径外任意复位空闲内存指针。
- 若正式采用，Game 的求时器绑定仍不可变，须按既定规则部署新的 Solver/Game/Vault 并切换入口；旧会话由旧 Game 完成。本研究不修改绑定或引入升级注册表。

## 附录：核心代码与思路

### 冷路径只改执行边界

```solidity
library PaidRaceCold {
    function derive(bytes32 seed, bytes32 anchor, uint8 tier, uint8 player)
        internal pure
        returns (PaidProfiles.Profile[5] memory profiles, uint8[14] memory deck, uint8[3][5] memory cpuDecks)
    {
        profiles = PaidProfiles.derive(seed, anchor, tier, player);
        deck = PaidDeck.derive(seed, anchor);
        for (uint8 h; h < 5; ++h) {
            if (h != player) cpuDecks[h] = PaidCpuDeck.derive(seed, anchor, h);
        }
    }
    // raceParams/cardRuleWords/newCardPlan/classifyChoice/closePanel/settle
    // 保留原函数体；全部改为 internal pure，参数改为 memory。
}
```

### Solver 与 Engine 不再传组件地址

```solidity
function solve(RaceInput calldata input) external pure returns (RaceResult memory) {
    return PaidRaceEngine.solveRace(coreInput(input));
}

function _rule(State memory st, uint8 id) private pure returns (PaidCardRules.Rule memory) {
    PaidCardRules.Rule memory r = st.rules[id - 1];
    if (r.id == 0) {
        (uint256 hi, uint256 lo) = PaidRaceCold.cardRuleWords(id);
        r = PaidCardRules.decode(hi, lo);
        st.rules[id - 1] = r;
    }
    return r;
}
```

coreInput 改调 PaidRaceCold.derive；solveRace 与 _createState 删除 Support 参数；Options/State 删除 Support 成员。其他六处冷调用同样改为库调用。Engine 的调度、Motion 的解析/RK2、watch/gated 与共享 250 ms 参数不改；生产与诊断入口继续共用这份内核。

### 只读创建估算

```typescript
const gas = await client.estimateGas({
  account: '0x000000000000000000000000000000000000bEEF',
  data: artifact.bytecode.object,
  gas: 30_000_000n,
  stateOverride: [{
    address: '0x000000000000000000000000000000000000bEEF',
    balance: parseEther('1000'),
  }],
})
```

运行码探针与创建估算都由只读 RPC 执行，返回 gas 与结果哈希；没有真实账户密钥、sendTransaction 或 broadcast。
