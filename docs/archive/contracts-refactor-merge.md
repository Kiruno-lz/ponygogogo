# contracts-refactor 并入 more_pony：合并重建记录

`contracts-refactor` 已以 `--no-ff` 并入 `main`。它改变了合约的目录、部署形态、资金协议与重力步长；`more_pony` 的角色与能力合约改动必须在新结构上重建，而不是在旧结构上打补丁。合并重建已经完成，本文归档保留重建依据；当前角色与链上规则以[小马角色计划](../plan/pony-roster-and-traits.md)及[链上架构](../architecture/onchain.md)为准。

## 1. 红线

1. 不得恢复 `PaidRaceSupport` 或任何外部辅助合约。库函数一律 `internal`；任何 `linkReferences` 都会使 `scripts/check-contract-sizes.ts` 失败，这是唯一的机械护栏。
2. `contracts/` 根目录只放可部署合约（`PonyGame`、`PonyVault`、`PonyRewards`、`PaidRaceSolver`）。纯库进 `libraries/`，抽象继承进 `abstracts/`，接口进 `interfaces/`。
3. 生成物不手合，只从合并后的 TS 源重新生成（顺序见 §6）。涉及 `PaidCardRules.sol`、`PonyRules.sol`、`RewardRules.sol` 与三份 `tests/vectors/*.json`。
4. `PonyGame.openSession` 与 `openAgentSession` 的签名固定为 `(uint8 horseId, uint256 stake, uint8[5] roster) payable`，调用时 `value == stake`；TS 侧唯一入口是 `openSessionCall(game, horseId, stake, roster)`。
5. `PonyVault` 不再有玩家可用余额：不得恢复 `deposit`、`withdraw`、`available`、`totalAvailable`、`InsufficientAvailable`，也不得恢复 `PaidChainDeps.vault`。
6. 重力井积分步长为 250 ms（`PAID_CARD_GLOBALS.rkStepMs`），TS 与 Solidity 共用该常量。
7. `_syncNew` 不得保留 `mstore(0x40, scratch)` 式的空闲指针回退：`_gatedModifiers` 已把 `Rule memory` 写入 `st.rules[]`，回退会让这块内存被重新分配。

## 2. 两条线的改动

| | contracts-refactor（已入 main） | more_pony |
| --- | --- | --- |
| 目录 | 14 个库迁入 `libraries/`，`AgentBudget` 入 `abstracts/`，`IPaidRaceSolver` 入 `interfaces/` | 新增 `PonyRules`、`RewardRules`（库）、`PonyRewards`（合约），仍在旧平铺路径 |
| 部署形态 | `PaidRaceSupport` 删除，冷路径变为 `libraries/PaidRaceCold.sol`；`Engine` 直接调用 `PaidRaceMotion.advance/refresh`，`_watchTrigger`、`_gatedModifiers` 内联；Solver 单合约 35,144 B | `Engine` 经 `support.*` 调用 5 个新增外部函数；`RaceInput.roster`，`CoreInput.{ponyAbilities,roster}` |
| 资金 | `openSession` payable，`PonyVault` 直付玩家，移除 `available` | 无 |
| 规则 | `rkStepMs` 50→250，`TABLE_HASH`/`RULESET_HASH` 重算 | `mainFunction` 字段、`coatRgb` 收窄为 24 位、`PONY_RULES_HASH` 进入 `PAID_RULESET_HASH`（`v5/…`）、`LEGACY_RULESET_HASH` |
| 前端/链 | `funds`、`vault`、`wallet`、`txStatus` 去掉充值提款；`openSessionCall` 单笔 | roster 贯穿 `paidCalls`、`paidSession`、`usePaidRace`；`legacyPonyGameAbi`；奖励发放；多 Game 恢复 |

## 3. git 流程

1. `contracts-refactor`（6 个按 scope 拆分的提交）通过闸门后以 `--no-ff` 并入 `main`。
2. `more_pony` 工作区的全部内容做一个临时完整提交（含本文），再 `git merge main`。`main` 此时是 `more_pony` 基线的后代，没有临时提交就会因 35 个重叠文件拒绝合并。
3. 按 §4–§7 解决冲突与悬空引用，验证通过后完成合并提交。
4. 退回：`git reset --soft <main 末端>` 后 `git reset`，使 `more_pony` 指向 `main` 末端、工作区保留重建结果、不留任何提交。结果等价于「未提交的 pony 工作叠在新 main 之上」，此后在 `more_pony` 上的提交是普通线性提交，不会再出现这批冲突。

## 4. 冲突与解法

行号取自在快照上做的干跑合并，真实合并的输入相同，结果一致；以冲突标记为准。

### 4.1 合约

| 文件 | 形态 | 处理 |
| --- | --- | --- |
| `contracts/PaidRaceSupport.sol` | modify/delete | `git rm`。只有 `ponyWords`（pony 版 L22-31）与 `ponyAcquisition`（L34-56）带语义，迁移见下。`swapTarget`、`stealTarget`、`openingPlan` 是对基线逻辑的纯重构，删除并恢复基线内联实现 |
| `contracts/libraries/PaidCardRules.sol` | 内容冲突 | 不手合，合并 TS 源后重新生成（§6）。形状取 pony（`MAIN_*`、`mainFunction`、24 位 `coatRgb`、`LEGACY_RULESET_HASH`）并保留 `RK_STEP_MS` |
| `contracts/libraries/PaidRaceEngine.sol` | 3 个冲突块 + 5 处悬空 `support` 引用 | 见下表 |
| `contracts/PonyGame.sol` | 3 个冲突块 | 见下 |
| `libraries/PaidRaceMotion.sol`、`PaidRaceSolver.sol`、`interfaces/IPaidRaceSolver.sol`、`scripts/DeployPony.s.sol`、`foundry.toml` | 自动合并正确 | 不改。`PaidRaceMotion` 对 `./PonyRules.sol` 的 import 要求 `PonyRules` 在 `libraries/` |
| `PonyRules.sol`、`RewardRules.sol` | pony 新增 | `git mv` 到 `contracts/libraries/` |
| `PonyRewards.sol` | pony 新增 | 留在 `contracts/` 根（有状态、可部署，应被体积闸门度量） |

**`PaidRaceCold`**：新增 `error InvalidRoster()`，`import {PonyRules}`，以及 `function ponyWords(uint8[5] memory roster) internal pure returns (uint256[5] memory)`。参数从 `calldata` 改为 `memory`，因为调用方 `CoreInput` 在内存里。

**`PaidRaceEngine`**（行号为合并后）：

| 位置 | 处理 |
| --- | --- |
| L10-16 imports | 取 main 的 `PaidRaceCold`、`PaidSwap`；删 `PaidRaceSupport`；保留 `PonyRules` |
| L465 | `support.ponyWords(input.roster)` → `PaidRaceCold.ponyWords(input.roster)` |
| L876 `_swapTick` | 恢复基线 `b1fb40b:contracts/PaidRaceEngine.sol:857-880` 的 `PaidSwap.swap` 与回写 `pos/laneIndex`，已验证与 pony 的手写交换位等价；保留 `arg = int256(attempt << 3 \| target)` |
| L1023 `_onPonyCard` | `st.support.ponyAcquisition(...)` → Engine 私有 `_ponyAcquisition(State memory st, uint256 word, uint8 card, uint256 context) private pure returns (uint256)`。常量 `kind = 7`、`kind = 4` 改为 `KIND_TRAIT`、`KIND_BONUS`，`PaidCardRules.get(card)` 改为缓存的 `_rule(st, card)` |
| L1050-1058 `_syncNew` | 取 main 的结构；把 `for (h) nextDist = 0` 换成 `PaidRaceMotion.syncPonyPassives(st.horses, st.ponyWords, st.ponyPassive)`；删 `scratch` 两行（红线 7） |
| L1286 `_steal` | 恢复基线内联 `candidates` 循环与 `RaceEntropy.derive(..., PURPOSE_STEAL, ...)`；保留 pony 的尾部：被偷装备继承受害者剩余时长（`loot.end - tau`）与 `lootId << 2 \| OFF_STOLEN` |
| L1359-1389 `_openPanel` | 取 main 一侧原样；随后修两处自动合并进来的 pony 行：`panel.hasSlot = hasSlot`，`rec.deadlineSec = openSec + (mode == MODE_AUTO ? st.params.autoPanelSec : CHOICE_WINDOW_SEC)`；删 `plan` 局部变量 |
| 其余 pony 增量 | `KIND_TRAIT`、`EV_PONY`、`CoreInput`、`State`、`_onPonyCard`、`_buff(..., kind)`、`_equip(..., duration)`、`_onForfeit`、`_ponyTrigger`、`_ponySpeed` 自动合并正确，保留 |

**`PonyGame`**：

- imports 取并集：`./libraries/RacePayout.sol`、`./libraries/RandomAnchor.sol`、`./libraries/RewardRules.sol`、`./libraries/PonyRules.sol`、`./PonyRewards.sol`。
- L211-225：`openSession`、`openAgentSession` 合并为 `external payable nonReentrant`，参数含 `uint8[5] calldata roster`。
- L293-312 结算尾部：取 pony 一侧，删去其中陈旧的 `vault.settleStake(sessionId, payout)`，main 已把它前移到 L281 并以返回值作为 `payout`。保留 gas 守卫、`_grantCollectible`、`CollectibleSkipped`。`_open` 内 `msg.value != stake` 与 `_validateRoster` 已同时就位，不动。
- 决策 D3（§5）。

**`PaidRaceMotion` 布局隐患**：`initHorses` 以裸偏移 `0x220`、`0x240` 写 `finishTime`、`finishWall`，没有 `H_*` 常量，`tests/contracts/PaidRaceMotion.t.sol` 也没有钉住。新增 `H_FINISH_TIME`、`H_FINISH_WALL` 并在该测试中断言，`Horse` 字段重排才会被发现。

**体积**：Solver 在 35,144 B 之上预计增加 2–4 KB（删除 `swapTarget`、`stealTarget`、`openingPlan` 后不新增代码），距 Monad 131,072 B 上限余量充足。该数是估算，合并后须用 `forge build --sizes` 与 `scripts/check-contract-sizes.ts` 实测 `PaidRaceSolver`、`PonyGame`、`PonyVault`、`PonyRewards`，并重测 80 个生产输入的 `solve` gas。

### 4.2 TS、前端、脚本

| 文件 | 处理 |
| --- | --- |
| `package.json` | 并集：pony 的 `check:pony-rules`、`check:reward-rules`、`check:pony-vectors` 与 main 的 `check:contracts`、`check:solver-monad` |
| `scripts/dev-chain.ts`、`tests/api/ts/keeper.test.ts`、`tests/api/ts/paid-session-anvil.test.ts` 的 `NO_PROXY` 块 | 取 pony（大小写两个变量，是 main 的超集），三处一致 |
| `src/race/paid/cardRules.ts` | 两个块都要：pony 的 `CARD_MAIN_FUNCTION`、`mainFunctions` 入哈希、`v5/…/${PONY_RULES_HASH}`、`LEGACY_PAID_RULESET_HASH`，加 main 的 `PAID_CARD_GLOBALS = { bonusDefaultMs: 20_000, minCostFactorBps: 1_000, rkStepMs: 250 }`。丢掉任一侧的 `PAID_CARD_GLOBALS` 字段，`constants.ts` 的 `RK_STEP_MS = BigInt(PAID_CARD_GLOBALS.rkStepMs)` 会在导入期抛错使整个套件失败 |
| `src/race/paid/cardRules.test.ts` | 删除两侧写死的哈希字面量，合并后由生成物重新钉住 |
| `src/chain/paidCalls.ts` | ABI 单条：`openSession(uint8,uint256,uint8[5]) payable`。保留 pony 的 `legacyPonyGameAbi`、`RewardsBound`，删 `ponyVaultSessionAbi`。`openSessionCall(game, horseId, stake, roster = DEFAULT_ROSTER)`：main 的校验加 `normalizeRoster(roster)`，`value: stake`，删 `requireContract(vault)` 与 `shortfall` |
| `src/chain/paidCalls.test.ts` | 重写而非二选一：保留 main 的两个测试并断言 `value` 与 `args: [2, STAKE, [0,1,2,3,4]]`，再加 pony 的 roster 用例（`[0,1,2,3,3]`、`[0,1,2,3,9]`、`[0,1,2,3]`、`[0,1,2,3,4,5]` 均抛错）。header 已自动合并为 main，pony 一侧引用的 `VAULT`、`parseAbi` 不存在 |
| `src/chain/paidSession.ts` | import 取 `openSessionCall` 与 `legacyPonyGameAbi`；`openPaidSession` 保留 pony 的两行 ruleset 哈希校验，接 main 的余额检查（余额对完整 `stake`），再 `calls = [openSessionCall(deps.game, horseId, stake, roster)]`；删 `readVaultAvailable`、`shortfall` 块。合并后确认无 `deps.vault` 残留 |
| `src/chain/paidSession.test.ts` | 只保留 pony 的 `rulesetHash` 行。`ChainState` 已是 main 形态（无 `available`），`s.available` 会类型错误 |
| `src/chain/paidRecovery.ts`、`src/ui/usePaidRace.ts` | 保留 pony 的多 Game 恢复结构，去掉 `vault`：`PaidSessionContext = { game; facts }`，`sessionChainDeps` 返回 `{ ...deps, game: context.game }`；`PONY_VAULT_ADDRESS` 不再导入。冲突标记之外的 L124 `locationRef.current = { game, vault }` 与 L142 `resumeInfo({ …, vault })` 也要去掉 `vault`，仅处理标记会漏掉 |
| `src/race/paidDriver.test.ts` | import 取并集 |
| `scripts/testnet-session.ts` | main 的单笔直付结构加 pony 的 roster：`openSessionCall(cfg.game, cfg.horse, stake, cfg.roster)`，`openPaidSession(deps, cfg.horse, stake, undefined, cfg.roster)`。自动合并留下了不存在的 `shortfall` 与 `cfg.vault`，须删除。`heavySolverInput()` 读 `pony-race-v5.json` 并带摘要断言，保留 |
| `tests/api/ts/keeper.test.ts`、`paid-session-anvil.test.ts` | import 取并集；`openSession` 调用为 `[horseId, TIER, [0,1,2,3,4]]` 且 `value = TIER` |
| `scripts/gen-pony-rules.ts` L6、`scripts/gen-reward-rules.ts` L4 | 目标路径改到 `../contracts/libraries/` |
| `scripts/gen-paid-vectors.ts` | 自动合并，但会把 `LEGACY_PAID_RULESET_HASH` 写入 `meta.rulesetHash`；随 D1 处理 |
| `src/App.tsx`、`network.ts`、`i18n.ts`、`theme.css`、`scripts/keeper.ts` | 自动合并安全。仅需确认 `select.paidRulesMismatch` 在两个语种的 i18n 中都存在 |

链上接口变化：`RaceInput`、`SessionView`、`SessionOpened` 均增加 `uint8[5] roster`；新增 `rewards()` 与 `RewardsBound`；`PaidRaceSupport` 的移除不影响任何 TS。`scripts/keeper.ts` 的 `SOLVER_FAULT_GAS = 29_700_000n` 与测试网重负载批大小按 50 ms 步长标定，250 ms 下步数约降为 1/5，数值偏保守，合并后用 `bun --no-env-file scripts/measure-paid-solver.ts` 重测。

### 4.3 测试

**同形冲突，合并两侧**：`openSession{value: stake}(horse, stake, [uint8(0),1,2,3,4])`，`openAgentSession` 同理。涉及 `tests/contracts/PonyGame.t.sol`（10 块）、`PonyGameBase.sol` `_open`、`PonyGameInvariant.t.sol`（取 main 的 `{value: stake}` 与 `stakesPaid += stake`，守恒不变量 `balance == HOUSE + stakesPaid() - payouts()` 依赖它，再加 roster 参数）、`PaidRaceSolverSession.t.sol`、`tests/api/ts/keeper.test.ts`、`tests/api/ts/paid-session-anvil.test.ts`（`[horseId, STAKES[tier], [0,1,2,3,4]]`，`value = STAKES[tier]`）。这些文件里其余已自动合并的部分（main 的余额模型改写、pony 的 `PonyRewards` 构造与 9 字段 `SessionOpened`）都正确，不要回退任何一侧。

**其他冲突**：

| 文件 | 处理 |
| --- | --- |
| `PaidCardRules.t.sol`、`src/race/paid/cardRules.test.ts` | 两侧各钉了不同的哈希，都不对；按 §6 生成后重新钉住。文件其余的 pony 内容（`mainFunction` 断言等）保留 |
| `PaidRaceSolverSession.t.sol` L4-19 | import 取 main 的路径加 pony 的集合；删 `PaidRaceSolver`（`setUp` 用 `LegacyCoreSolverProbe`） |
| `PaidRaceSolverVectors.t.sol` L11-15 | 保留 `LegacyCoreSolverProbe`，删 `PaidRaceSupport`；`SOLVE_GAS_CAP = 23_500_000` 在 250 ms 与名单能力下不再是测得上界，重测后重新钉住 |
| `tests/api/ts/paid-session-anvil.test.ts` L32-43 | 假冲突，两侧只增 import，取并集 |

**静默破损**（git 不报冲突，合并后编译或运行失败）：

| 文件 | 问题 | 处理 |
| --- | --- | --- |
| `tests/contracts/LegacyCoreSolverProbe.sol` L3-6、`PaidRaceVectorAssertions.sol` L4-5、`PonyAbilityVectors.t.sol` L4-8、`PonyGameRoster.t.sol` L4、`legacy/ArchivedPonyGameV4.sol` L9/11/12/14/15、`legacy/LegacyV4Solver.sol` L4-5 | 沿用旧平铺 import | 改到 `interfaces/`、`libraries/`、`abstracts/`；`PaidRaceSupport` 的引用见 D2 |
| `PonyRules.t.sol` L3、`PonyRewards.t.sol` L5、`PonyGameRewards.t.sol` L6 | import `PonyRules`/`RewardRules` 的旧平铺路径，两个库迁入 `libraries/` 后失效 | 改为 `../../contracts/libraries/…` |
| `PonyAbilityVectors.t.sol` L13/14/17 | `PaidRaceSupport support` 与 5 字段 `PaidRaceEngine.Options(0,false,0,true,support)` | `Options(0,false,0,true)` |
| `PonyGameRoster.t.sol` L46/53、L21 | `vault.available(ALICE)` 已删；低级 `openSession` 调用不带 value | `ALICE.balance`；调用加 `{value: TIER1}` |
| `PaidRaceVectorBase.sol` L83-84 | 写 `input.ponyAbilities`、`input.roster`，main 的 `CoreInput` 没有这两个字段，所有向量套件都会编译失败 | Engine 按 §4.1 重建后字段回来，无需改本文件 |
| `scripts/check-contract-sizes.ts` L34 | 遍历 `contracts/*.sol` 且假定都是可部署合约，`PonyRules`/`RewardRules` 在根目录会因空运行码报 `invalid runtime bytecode` | 二者迁入 `libraries/` 后自然通过；`PonyRewards` 在根目录，自动被度量 |
| `tests/vectors/pony-race-v5.json` | 在 50 ms 下生成，250 ms 与默认名单下每个 `digest`、`stepCount`、`finishTime` 都变 | §6 重新生成；随后重钉 `PonyAbilityVectors.t.sol` L22-23（哈希、243 例）；`tests/api/ts/roster-tools.test.ts` 随之通过 |
| `tests/e2e/specs/motion.spec.ts` L91/105 与 `regressions/{practice-rules-audio,practice-spin-thrust,gogo-camera,gogo-exhausted,anonymous-card-webkit,practice-gravity-trace}.spec.ts` | 钉死的练习种子：牌堆派生不变，但 250 ms 改变完赛时刻与选牌窗口，且 `src/App.tsx` 现在把名单传给 `RaceDriver`，练习局带能力 | 逐个按提交 `f4d44ae` 的做法重选种子。`motion.spec.ts` 的 badge-pop 不可放宽 `sampleAnimations`，仍失败则按 L3-R 在 `tests/e2e/regressions/` 补复现脚本与 `REPRO.md` |

**legacy 夹具**：它们证明「已部署的无名单 v4 Game（`rulesetHash` 为 `LEGACY`、五字段 Solver ABI、充值式 Vault）在 v5 上线后仍能恢复并结算」，消费者是 `paid-session-anvil.test.ts` L386-453、`PaidRaceSolverSession.t.sol`、`PaidRaceSolverVectors.t.sol`。

| 夹具 | 处理 |
| --- | --- |
| `ILegacyPaidRaceSolver.sol` | 自包含，保持 |
| `LegacyV4Solver.sol` | 只依赖当前 `IPaidRaceSolver` 结构与 `LEGACY_RULESET_HASH`，已逐字段拷贝，名单字段不影响；只修两处 import |
| `LegacyCoreSolverProbe.sol` | 原地改写约 6 行，无需冻结副本：`PaidRaceCold.derive(seed, openAnchor, stakeTier, playerHorseId)` 与旧 `PaidRaceSupport.derive` 签名一致，`core.ponyAbilities = false` 即无名单模式，`return PaidRaceEngine.solveRace(core)`；合约随之变为 `pure`，删 `support` immutable |
| `ArchivedPonyGameV4.sol` | 它对旧 Vault 调用无 value 的 `lockStake`，而新 Vault 是 payable 且要求 `msg.value == stake`；anvil 测试还用 `vault.deposit()` 给它注资，该函数已不存在。新增冻结的 `tests/contracts/legacy/ArchivedPonyVaultV4.sol`（基线 `PonyVault` 的充值模型，OpenZeppelin 取自 node_modules，与生产代码零耦合），`paid-session-anvil.test.ts` L404/L408 改用它。理由：这是唯一能端到端证明 `recoverPaidSessions → sessionChainDeps → choosePaidCard → settlePaidSession` 按会话固定 Game 与 Vault 地址、且旧会话不发奖励的测试；删掉它只剩 `paidRecovery.test.ts`、`paidGate.test.ts` 的 mock，抓不到错误的 Vault 绑定 |

**必须新增**：

1. roster ABI 对等：`openSession(uint8,uint256,uint8[5])` 与 9 字段 `SessionOpened` 同时在 `src/chain/paidCalls.test.ts` 与 `PonyGameRoster.t.sol` 断言（目前只校验事件 topic）。
2. `ponyWords` 与能力解析（`_ponyAcquisition`）内联为库后，对 TS 参考实现逐位对等并复测 gas：`tests/contracts/PonyAbilityVectors.t.sol`。
3. `tests/contracts/PaidRaceMotion.t.sol` 钉住 `finishTime`、`finishWall` 偏移（§4.1）。
4. `DirectFunding.t.sol` 增加直付×名单交叉用例：合法名单配 `msg.value != stake`、非法名单配 `msg.value == stake`，两者都不得锁注或递增 nonce。
5. 恶意 `receive()` 耗尽 gas 时结算仍成功：`PonyGameRewards.t.sol`（D3）。
6. `scripts/check-contract-sizes.ts` 与 `src/chain/contractSizes.test.ts`：覆盖 `PonyRewards` 在度量集合内、纯库被排除。

**必须删除**：对已删除的外部 `PaidRaceSupport` ABI 与 5 字段 `Options` 的所有断言；`src/chain/paidCalls.test.ts`、`paidSession.test.ts` 中的 Vault 充值、shortfall 路径。保留 `PaidSwap.t.sol`，`PaidSwap` 库只是搬了家。

## 5. 决策点

| # | 问题 | 默认 | 依据 |
| --- | --- | --- | --- |
| D1 | `LEGACY_PAID_RULESET_HASH` 钉的是基线 v4 哈希（`0x57f1…`，50 ms）。合并后 TS 与 Solidity 各只有一个 `RK_STEP_MS`，50 ms 时代部署的会话无法逐位回放 | 常量保持冻结，仍用于识别旧部署并走旧 ABI。`paid-race-v4.json` 由 pony 的 `gen-paid-vectors.ts` 重新生成：以 `LEGACY` 标注，内容是当前引擎在无名单模式（250 ms）下的结果，`LegacyV4Solver` 以同一引擎应答，因此恢复与结算的整条链路在测试内自洽。代价：真实的 50 ms 旧部署的会话，轨迹回放不保证逐位一致 | 新部署（250 ms）尚未上线。**待用户确认**：测试网上是否确有 `rulesetHash == 0x57f1…` 的活跃 Game（`.env.example` L15 为空，仓库无部署清单）。无活跃部署则 `LEGACY` 只是一个标签，可以简化；有则以上取舍成立，完整回放需让 `RK_STEP_MS` 随规则集切换，应单独立项 |
| D2 | `ArchivedPonyGameV4` 依赖充值式旧 Vault，`LegacyCoreSolverProbe` 依赖旧 `PaidRaceSupport` | 冻结 `tests/contracts/legacy/ArchivedPonyVaultV4.sol`，Probe 改用 `PaidRaceCold.derive`（见 §4.3） | 保留端到端的旧会话恢复证明，且不让生产代码带任何旧形态 |
| D3 | `PonyGame` 结算先 `vault.settleStake` 直付玩家，再做 pony 的 `gasleft() < GAS_RESERVE` 检查与 `_grantCollectible`。玩家 `receive()` 可以耗 gas，使一次有效结算在检查处回滚 | 先写测试复现：`PonyGameRewards.t.sol` 增加「恶意 receive 耗尽 gas 时结算仍成功」。若复现，把第二个 gas 检查与 `_grantCollectible` 前移到 `settleStake` 之前 | 是否有害取决于 `try … {gas: …}` 守卫是否已兜底，需要测试而非推断 |
| D4 | `DEFAULT_ROSTER = [0,1,2,3,4]` 带五个真实能力，不是中性默认 | 保持；旧路径回放依赖 `roster === undefined`（`solver.ts` 以 `input.roster ? … : null` 分支），因此任何调用点都不得为「原本不传」的场景补默认值 | 否则 digest 静默改变 |

## 6. 生成物顺序

先手合源（`src/race/paid/cardRules.ts`、`ponyRules.ts`、`rewardRules.ts`），再依次重新生成。`PONY_RULES_HASH` 是 `PAID_RULESET_HASH` 的输入，所以 `gen-pony-rules` 必须在 `gen-paid-card-rules` 之前。`bun run` 在本环境不可用，直接调用：

1. `bun --no-env-file scripts/gen-pony-rules.ts`
2. `bun --no-env-file scripts/gen-reward-rules.ts`
3. `bun --no-env-file scripts/gen-paid-card-rules.ts`
4. `bun --no-env-file scripts/gen-paid-vectors.ts`
5. `bun --no-env-file scripts/gen-pony-vectors.ts`
6. `bun --no-env-file scripts/analyze-paid-card-builds.ts`
7. 用新生成的值重新钉住 `src/race/paid/cardRules.test.ts` 与 `tests/contracts/PaidCardRules.t.sol` 里的哈希

每一步完成后对应的 `--check` 必须通过。`gen-reward-rules.ts` 不像另外两个生成器那样经 `forge fmt --raw -` 输出，导致 `forge fmt --check contracts/libraries/RewardRules.sol` 失败（合并前即如此，无仓库闸门执行它）。
奖励规则生成器已接上 `forge fmt` 管道；重新生成后的格式检查与 `--check` 均通过。

三份 `tests/vectors/*.json` 与三个生成的 `.sol` 在两侧都已失效（`rkStepMs` 改变所有轨迹，pony 默认名单改变所有 digest），因此都是重生成，不是合并。

## 7. 验证与完成判据

合约先于 TS，TS 先于测试，生成物在二者之间：

1. `forge build --skip test --skip script`：规则库、`PaidRaceMotion`、`PaidRaceCold`、`PaidRaceEngine`、`PonyGame` 依次通过。
2. `./node_modules/.bin/tsc -b`：会抓住所有残留的 `deps.vault`、`shortfall`、`openSessionCalls`、`readVaultAvailable`。
3. §6 的生成链，随后各 `--check`。
4. L1：`forge test`；`bun --no-env-file test src`。逐项性能门禁：同步 ≤100 ms，异步 ≤500 ms。
5. 体积：`forge build --sizes`；`bun --no-env-file scripts/check-contract-sizes.ts`。
6. L2：`bun --no-env-file test tests/api`，需要 anvil。`openSession` 签名、Vault 接口与两份向量都变了，全量运行。
7. L3（影响标签 `[affects: src/ui/**, src/App.tsx, 共享规则哈希]`）：`specs/{paid-race,wallet,journey,pony-selection,pony-gallery,pony-journey,pony-visual,collectible-result}.spec.ts` 与 `regressions/{horse-selection,wallet-busy,practice-gravity-trace,practice-rules-audio,practice-spin-thrust}.spec.ts`。
   Playwright 配置经 `bun run` 启动 webServer，在本环境不可用，先手动起 vite：`./node_modules/.bin/vite --port 5177 --strictPort --host 127.0.0.1`，再 `npx playwright test --config tests/e2e/playwright.config.ts`。`motion.spec.ts` 的 badge-pop 处理见 §4.3。

完成判据：

- [x] 仓库中不存在 `PaidRaceSupport`、`support.`、`st.support`；`contracts/` 根只有四个可部署合约。
- [x] `forge build --sizes` 与 `check-contract-sizes` 通过，Solver 实测 runtime 记入 `docs/card-design.md`。
- [x] 所有生成物 `--check` 通过，且无手合文件。
- [x] L1、L2 全量 100%，L3 受影响旅程通过。
- [x] `docs/architecture/onchain.md`、`docs/decision.md`、`docs/card-design.md` 与代码一致（roster、能力、`PonyRewards` 的部署形态）。
- [x] 本文档按归档规则移入 `docs/archive/`。

## 重建验收

Solver runtime 36,768 B，无外部计算辅助合约或库链接；符合 Monad 体积上限。967 条源码测试、144 条 Foundry、85 条 API、Envio 30 条测试及类型/ABI/生成检查通过；有奖本地动线、钱包/试玩/动效和角色图鉴/分享动线均通过浏览器验证。80 场 Monad 只读探针结果全部匹配，平均/最大 solve gas 为 2.656M/4.446M。真实部署未执行。

D1 的配置检查只读到当前 Game 的 `0x5ff01a…` 规则哈希，不是 LegacyV4；没有配置 LegacyV4 地址。它不证明全网络不存在其他旧部署，也不把 250 ms 无名单夹具当成 50 ms 旧部署的逐位回放证据。具体覆盖边界见[策略验证记录](../_reaserch/pony-strategy-validation.md)。
