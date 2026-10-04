# 回归复现记录

第一至四节对应本目录的 `countdown-overlay`、`wallet-busy`、`collection-locked-slots`、`modal-strictmode-close` 四个脚本，第五节的复现脚本在 `tests/e2e/specs/paid-race.spec.ts`，第六节对应 `gogo-exhausted`，第七节对应 `practice-spin-thrust`，第八节对应 `practice-gravity-trace`，第九节对应 `practice-lineup-seed`，`bunx playwright test --config tests/e2e/playwright.config.ts regressions/` 全量跑本目录。

//TODO - 为 `anonymous-card-webkit`、`cosmetics-wind`、`equipment-card-selection`、`gogo-button-layout`、`gogo-camera`、`horse-selection`、`practice-rules-audio` 七个回归脚本补写缺陷现象、根因假设与关联 L1/L2 模块；判据是 `regressions/*.spec.ts` 每个文件在本文都有对应小节。

---

## 一、起跑倒计时遮罩被 raceSpeed 压成查不到的瞬态

### 缺陷现象

`tests/e2e/specs/journey.spec.ts` 的「起跑倒计时」节点稳定失败：

```
Error: expect(locator).toBeVisible() failed
Locator: getByTestId('countdown')
Timeout: 20000ms   Error: element(s) not found
```

失败截图里比赛已经跑到第一个检查点的选牌面板，说明不是遮罩没出现，而是 20 秒里一次都没查到过。

### 根因假设

**异步时序，缺陷在测试而不在产品。** 三点对上了：

1. 遮罩的存活条件是 `driver.phase === 'countdown'`，起跑倒计时固定 3 秒**模拟时间**；
2. 这条动线用 `?raceSpeed=16` 把模拟时钟整体加速 16 倍（`src/race/driver.ts`），于是遮罩的现实存活时间只有 `3000 / 16 ≈ 187ms`；
3. 原断言在点下 RACE **之后**才开始建立等待。Playwright 的可见性轮询间隔是递增的（100ms → 250ms → 500ms …），从点击到第一次真正查询往往已经越过那 187ms，此后遮罩永远不会再出现，只能等满 20 秒超时。

即：**测试自己把要断言的那段时间压掉了 16 倍，再去断言它**。产品行为正确——倒计时确实渲染过，只是没人在窗口内看。

同一份 journey 在接入钱包之前的提交上以完全相同的方式失败（该提交已不在仓库内），可排除钱包改动的嫌疑。

### 复现说明

```bash
cd /path/to/Ponygogogo
bunx playwright test --config tests/e2e/playwright.config.ts regressions/countdown-overlay.spec.ts
```

`countdown-overlay.spec.ts` 里 `MISSED_WINDOW` 那条用例把缺陷本身钉住：它以 `raceSpeed=16` 复刻「点完再查」的顺序，断言这样确实抓不到遮罩；`OBSERVED` 那条给出正确写法——**在点击之前就挂上 `waitFor`**——断言同样的 187ms 窗口能被稳定抓到。

修复方式是把等待前移，不是放慢产品的倒计时，也不是给断言加更长的超时（超时再长也救不了已经错过的窗口）。

### 关联模块

- L1：`src/race/driver.ts` 的倒计时相位与 `raceSpeed` 时钟缩放目前没有直接的 L1 覆盖（`driver.test.ts` 以 `countdownMs: 0` 运行），由本脚本守护。
- L2：不涉及，倒计时不跨任何契约。
- L3：`tests/e2e/specs/journey.spec.ts` 的「起跑倒计时」与紧随其后的 HUD 节点已按正确写法改写——两组等待都在点下 RACE 之前并发挂好。

### 注意事项与补充

任何以 `?raceSpeed=N` 运行、又要断言**瞬态状态**的用例都有同一个陷阱：可观测窗口被除以 N。写法上一律「先挂等待，后触发」，不要靠放大 timeout——超时再长也救不了已经错过的窗口。

**同一条动线里还有第二处同类问题**，根因相同但形态不同：倒计时结束后，journey 用八次顺序断言逐个检查 HUD（`stamina-bar`、`leaderboard`、`gogo`、五行 `board-row-*`）。`gogo` 的挂载条件是 `!counting && st.pending === null && !st.playerFinished`（`src/ui/RaceScreen.tsx`），而 16 倍速下玩家跑到 25% 里程、弹出第一个检查点选牌面板只要一秒上下——八次往返还没走完，`st.pending` 就已经非空，`gogo` 被卸载，断言报 `element(s) not found`。失败截图里停在选牌面板，正是这个状态。

已按后一条修好：八条等待和倒计时的等待一起，在点下 RACE 之前就并发挂上，元素一出现就各自命中，不再有八次往返的累计延迟。产品侧一行未动。

---

## 二、注册的领水轮询没结束时退出，首页按钮卡在灰色

脚本：`wallet-busy.spec.ts`

### 缺陷现象

注册成功后钱包正常出现（注册即自动登录）。此时立刻点首页木牌上的退出，回到未登录界面，**登录与注册两个木牌都是灰的、点不动**，要等十几秒才恢复。

### 根因假设

**状态管理。** `src/ui/HomeScreen.tsx` 的两个入口都写着 `disabled={busy !== null}`，而 `busy` 是 `src/App.tsx` 里的 `walletBusy`。原来的 `register` 把 `walletBusy` 一直占到 `wallet.register()` 整个 promise 落地为止，而这个 promise 里除了通行密钥仪式，还包含**领水后的余额轮询**——最坏 15 次 × 1 秒。轮询期间账户早已通过 `onAccount` 回调画到界面上，玩家完全可以退出；退出只清了账户，没清 `walletBusy`，于是按钮继续灰着，直到轮询自己跑完。

同一个根因还带出第二个隐患：轮询结果回来时若玩家已经退出（或又注册了另一把），旧的 `setWalletBalance` / `setNotice` 会盖到新状态上。

### 复现说明

```bash
bunx playwright test --config tests/e2e/playwright.config.ts regressions/wallet-busy.spec.ts
```

用例让假水龙头照常受理却永不入账，把轮询拉满全程，于是「钱包已出现、注册调用还没落地」这段窗口稳定存在十几秒。第一条断言退出后两个按钮可点且注册能再次弹出取名窗口；第二条等轮询跑满，断言界面仍是未登录，没有被在途结果拉回钱包态。

### 关联模块

- L1：无。这不是规则问题。
- L2：`tests/api/ts/wallet.test.ts` 覆盖 `wallet.register()` 自身的返回契约；忙碌态是界面状态，不属于钱包端口的契约。
- L3：`src/App.tsx`。修法是两条：通行密钥仪式一结束（`onAccount` 回调里）就放开 `walletBusy`，领水轮询不再锁按钮；同时给钱包操作加一个世代号，退出与再次注册都会让它自增，过期的异步返回一律丢弃。

### 注意事项与补充

界面的「忙碌」必须对应**玩家在等的那件事**，不能图省事对应「整个异步调用」。注册这件事里，玩家等的是通行密钥仪式；领水是之后的后台补齐，它的等待属于余额那一栏（显示占位符「—」），不属于按钮。

---

## 三、图鉴排版检查只数卡面，锁定的稀有卡格整格漏检

脚本：`collection-locked-slots.spec.ts`

### 缺陷现象

`tests/e2e/specs/art-layout.spec.ts` 的图鉴用例稳定失败：

```
- "cards": 26,
+ "cards": 14,
```

失败截图里图鉴完整显示「共 26 张」，稀有卡格都是写着「稀有卡尚未收藏」的锁定占位，文字居中、无截断、无重叠。

### 根因假设

**测试契约过期，缺陷在测试而不在产品。** 证据：

1. `tests/art/card-layout.js` 用 `.card-root` 选卡，而 `.card-root` 只由 `src/cards/Card.tsx` 的卡面组件输出；
2. `src/ui/CollectionScreen.tsx` 对访客未拥有的稀有卡只渲染带 `data-card` 的锁定占位，不渲染卡面——这是 `docs/plan/card-collection-unlock.md` 所述稀有卡收藏尚未成为比赛输入的体现；
3. 数字严格对上：当时 `PAID_CARD_POOL` 共 26 格，其中稀有卡 12 张，`26 − 12 = 14`（现为 40 格、稀有 23、普通 17）；
4. `tests/e2e/specs/journey.spec.ts` 早已以 `[data-card]` 作为图鉴格子的计数契约（26 格），只有排版检查还停在「每格都是卡面」的旧假设上。

即：**检查器把「卡面」当成了「格子」**，锁定格按设计没有卡面，于是整格不计数也不做任何排版断言。

### 复现说明

```bash
bunx playwright test --config tests/e2e/playwright.config.ts regressions/collection-locked-slots.spec.ts
```

`FACES_ONLY` 把缺陷机制钉住：`[data-card]` 恰为 `PAID_CARD_POOL.length`（当前 40），`.card-root` 为其减去稀有卡数（当前 17），`[data-card]:not(.card-root)` 恰为稀有卡数（当前 23），说明漏掉的正是锁定格，且锁定格确实不带卡面。`EVERY_SLOT` 断言修正后的检查器按格子覆盖全部格子，并分别报告卡面数与锁定格数。

修法是检查器改为遍历 `[data-card]`：`.card-root` 卡面照旧断言描述留在缎带上方的羊皮纸区内；锁定格断言提示文字非空且留在边框内侧。**不给锁定占位补 `.card-root`**：该类名在 `helpers.ts` 的选牌点击、`theme.css` 的卡名字体里都表示「卡面组件」，检查器还会深入它的画面区与描述段落；占位补上类名只会被数进去，再因找不到描述段落被跳过，得到 26 格「全绿」而其中 12 格什么都没查。产品侧一行未动。

### 关联模块

- L1：无。锁定与否由 `ownedRareIds` 决定，属于界面状态，不是规则逻辑。
- L2：`tests/api/ts/collection-worker.test.ts` 覆盖图鉴同步接口的契约；本缺陷不跨契约。
- L3：`tests/art/card-layout.js`、`tests/e2e/specs/art-layout.spec.ts`。用例的期望从单一的 `cards` 拆成 `cards / faces / locked`，访客的卡面数与锁定格数都由 `PAID_CARD_POOL` 按品质派生，稀有卡锁定规则变化时这里会先红。

### 注意事项与补充

访客的图鉴不再以 `gallery` 尺寸渲染稀有卡卡面，这条检查因此不再覆盖 12 张稀有卡在图鉴尺寸下的描述长度——此前它们靠旧图鉴的全量渲染顺带被查（稀有卡仍会以 `choice` 尺寸出现在比赛选牌面板里，但那是另一种字号与折行）。补回这部分覆盖需要走通「登录 → 解锁图鉴 → 远端返回含稀有卡的密文」的端到端动线，属于图鉴解锁的验收范围，不在本修复内。

---

## 四、模态窗口在开发模式下一打开就自己关掉

脚本：`modal-strictmode-close.spec.ts`

### 缺陷现象

三个模态窗口改用原生 `<dialog>`（`src/ui/StageDialog.tsx`）后，`tests/e2e/specs/keyboard.spec.ts` 在第一步稳定失败：点首页「注册」，`getByTestId('register-modal')` 20 秒内 `element(s) not found`。控制台无报错，焦点停在「注册」按钮上，键盘触发同样不弹窗。

### 根因假设

**异步时序。** `src/main.tsx` 用 `<StrictMode>` 渲染，开发模式下 React 对同一个 `<dialog>` 节点把布局 effect 跑成 mount → cleanup → mount：

1. 第一次 mount：`showModal()`，挂上 `close` 监听；
2. cleanup：先摘监听，再 `dialog.close()`——浏览器**排队**一个 `close` 事件，不是同步派发；
3. 第二次 mount：`showModal()`，重新挂上 `close` 监听；
4. 排队的 `close` 此时才派发，撞上新挂的监听。监听把它当成「浏览器强行关窗」（为 cancel 不可取消的情形准备的兜底），调用 `dismiss()` → 父组件 `setRegisterOpen(false)` → 窗口卸载。

即：**过期的 close 事件被当成了一次新的关闭请求**。生产构建没有 StrictMode 的双跑，但兜底里「进行中就重新打开」那条路径同样会让先前排队的 close 落在已重新打开的窗口上。

### 复现说明

```bash
npx playwright test --config tests/e2e/playwright.config.ts regressions/modal-strictmode-close.spec.ts
```

`STALE_CLOSE` 点「注册」后等过排队任务的派发时机，再一次性断言窗口仍在、仍是 `:modal`。缺陷版本里窗口已从 DOM 中消失。

修法在底层 `src/ui/modalHost.ts` 的 `openModal`：`close` 事件到达时若 `dialog.open` 已为真，说明窗口已经重新打开，事件过期，直接忽略。L1 `src/ui/StageDialog.test.tsx` 用会翻转 `open` 的假 dialog 复刻了 mount → cleanup → mount 的顺序，修复前两条用例失败、修复后通过。

### 关联模块

- L1：`src/ui/StageDialog.test.tsx` 的 `openModal` 用例——「a close event that arrives after the dialog is open again is stale and ignored」「StrictMode remount: the close queued by the first cleanup does not dismiss the reopened dialog」。
- L2：不涉及，窗口开关不跨任何契约。
- L3：`tests/e2e/specs/keyboard.spec.ts`（Escape、焦点回位、Tab 困在窗口内、点遮罩）、`tests/e2e/specs/wallet.spec.ts`（Escape 关钱包面板）。

### 注意事项与补充

`<dialog>` 的 `close` 事件是排队派发的任务，不要假设它与触发它的 `close()` 同步。凡是在 `close` 里做「重新打开」或「通知父组件」的逻辑，都要先确认窗口此刻确实是关着的。

## 五、结算失败的说明框加了结算期限后超出画板底边

### 缺陷现象

会话协议 v2 取消退款后，结算页在结算前要写明期限（「请在约 N 分钟内结算，否则视为放弃」）。期限作为第二行放进按钮行下方的 `settle-detail` 框里，`paid-race.spec.ts` 动线三（结算失败 → 重试）在 1280×720 视口下断言 `settle-detail inside viewport` 失败：框底 721.48 px，超出视口 0.48 px，截图里说明框压在舞台底边上。

### 根因假设

**前端渲染。** 说明框顶边固定在 878（须在按钮行 866 之下），画板高 971，只余 93 px。第一行沿用全局 `.chip`（上下内边距各 12 px）的「重试结算」按钮，行高约 52 px，再叠 22 px 的期限行与上下内边距，总高约 95 px，越过画板底边。与数据、时序无关：期限文案本身长度正常。

### 复现说明

```bash
PORT=5178 DEV_CHAIN=anvil DEV_DETACH=1 bash scripts/dev.sh
npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/specs/paid-race.spec.ts -g 结算失败
bash scripts/dev.sh stop
```

动线三本身就是最小路径（注册 → 开 0.3 档 → 快进过冲线 → 拦下 settleSession 的估 gas → 结算失败），且只能在 anvil 全栈上到达，所以不另写一份重复脚本；它的 `checkScreen` 覆盖说明框、重试按钮与期限行（可见、在视口内、文字不截断、期限行与重试不重叠）。

修法：说明框内的重试改用紧凑筹码（`.result-settle-detail .chip`，内边距 3 px、行高 26 px），框的上下内边距 5 px，两行合计约 70 px。

### 关联模块

- L1：`src/ui/paidText.test.ts`（期限文案）、`src/chain/settleDeadline.test.ts`（期限计算）——文案与数值正确，问题只在排版。
- L2：不涉及。
- L3：`tests/e2e/specs/paid-race.spec.ts` 动线三。

### 注意事项与补充

结算页是 1620×971 的绝对坐标画板，按钮行下方的空间固定不变；往 `settle-detail` 里再加任何一行，都要重新核算高度，不能依赖自动撑高。

## 六、力竭状态禁用了只控制镜头的 GOGOGO 按钮

脚本：`gogo-exhausted.spec.ts`

### 缺陷现象与根因

玩家马力竭时，HUD 的 GOGOGO 按钮带 `disabled`，无法点击移动镜头；空格输入仍能产生镜头反馈。`Hud.tsx` 的 `disabled={exhausted}` 从最初的 UI 提交 `b8e76e8` 沿用至今，当时逐 tick 引擎会拒绝力竭时的 gogo。当前免费与有奖驱动器只产生镜头反馈，gogo 不进入体力、速度或结算输入（`docs/game-design.md` §5），该限制已失去规则依据。

### 复现说明

```bash
./node_modules/.bin/playwright test --config tests/e2e/playwright.config.ts regressions/gogo-exhausted.spec.ts
```

用固定 seed `0x0000000a` 进入免费试玩，在浏览器内推进实际驱动器经过合法选牌超时，直到求时器产生玩家力竭、无选牌面板且未冲线的快照，再冻结规则时钟。断言力竭提示与体力视觉保留、按钮可用，并用实际鼠标点击验证玩家构图右移、规则快照与求解输入不变。修复前在 `toBeEnabled` 处失败；修复只移除 GogoButton 的禁用属性及传参。

### 关联模块与注意事项

- L1：`src/ui/Hud.test.tsx` 覆盖免费与有奖状态的力竭快照，断言 GOGO 无 `disabled` 且保留力竭提示与体力视觉；修复前失败。
- L2：不涉及端口契约。
- L3-R：本脚本使用生产 HUD、输入与 Phaser 镜头，冻结规则时钟以隔离点击效果；不手工注入力竭状态。

倒计时、选牌面板和玩家冲线时仍按 `RaceScreen` 的挂载条件隐藏 GOGO。

---

## 七、真实比赛取得 C-02 后马体不翻面、螺旋分镜不显示

脚本：`practice-spin-thrust.spec.ts`

### 缺陷现象与根因

免费试玩取得 C-02 后，HUD 有卡牌徽章，但玩家马体不翻面、`spinThrust.visible` 为假；开发「特效验收」入口却显示正常。`RaceDriver` 与 `PaidRaceDriver` 共享的 `paidSnapshot.ts` 把 `speedDeath` 映射成空 payload 的 `Modifier`，未满足 `isSpinVisualActive` 所需的 `Status`、`luckE` 与 `spin: true`；演示卡池有这些字段，因而验收入口无法发现真实比赛的缺陷。

### 复现说明

```bash
./node_modules/.bin/playwright test --config tests/e2e/playwright.config.ts regressions/practice-spin-thrust.spec.ts
```

使用 `seed=0x00000033`、玩家马 0，真实练习赛派生的第一候选为 C-02。通过选牌 UI 取得它，读取正在运行的 `RaceScene`，断言玩家分镜可见、16 帧、帧号变化、马体曾翻面、原实例与 HUD 徽章各一个；保存截图，跳过后续选牌，断言期限结束后分镜与徽章消失。脚本不注入效果、不改比赛时钟。修复前在分镜可见性断言处失败。

修法仅把原 `speedDeath` 实例映射成 `Status` 与 `{ statusId: 'luckE', spin: true }`，保留原实例 ID、期限与 `['buff', 'debuff']`，不新增实例或事件。

### 关联模块与注意事项

- L1：`src/race/paidSnapshot.test.ts` 用真实求时器轨迹检查取得前、30 秒内、到期及到期后，验证归属、单实例、单次 `cardPicked` 和其余 39 张卡不激活旋转。
- L2：不涉及端口契约，修改只发生在轨迹到表现层快照的转换。
- L3-R：本脚本覆盖真实免费试玩；`tests/e2e/specs/spin-thrust.spec.ts` 覆盖验收入口的挂点、起飞、减弱动效与到期。

HUD 按来源卡去重，沿用原期限与 debuff 标签；飘字和音频消费比赛事件，视觉 payload 不产生事件。有奖比赛复用同一快照转换，本脚本不进行付费交易。

---

## 八、重力井 250 ms 规则与表现轨迹一致性

脚本：`practice-gravity-trace.spec.ts`

### 规则变更与回归风险

重力井 RK2 基步由 50 ms 改为 250 ms，遇已知事件或首次越过时仍截断。若链上积分、前端预览或表现层独立保留旧步长，同一输入会得到不同位置、冲线时间与 digest。步长在 `PAID_CARD_GLOBALS.rkStepMs` 中定义，生成 Solidity 常量并参与规则哈希；练习与有奖驱动都采样共享求时器的轨迹。

### 复现说明

```bash
PLAYWRIGHT_PORT=5186 bunx playwright test --config tests/e2e/playwright.config.ts regressions/practice-gravity-trace.spec.ts
```

固定 `seed=0x00000003`、玩家马 0，真实练习牌堆在第一面板槽位 2 提供 C-10。通过 UI 选择，逐帧读取正在运行的 RaceScene：五马位置、速度与体力须等于同刻规范轨迹的采样；井期出现完整 250 ms 步，装备贴图播放多帧，并在实例到期后消失。保存实际比赛截图，不注入效果或修改规则时钟。

### 关联模块与证据边界

- L1：`solver.gravity.test.ts` 独立重算 RK2 中点步骤、重叠井与事件截断；`paidSnapshot.test.ts` 核对步中间与到期快照；`paidDriver.test.ts` 核对付费展示的重叠井生产输入。
- L2：`PaidRaceMotion.t.sol` 验证 1001 ms 为四个完整步加 1 ms 尾步，修改前失败；355 场 TS/Solidity 向量逐字段、事件和 digest 对照；`paid-session-anvil.test.ts` 在本地真实 Solver 核对单井与重叠井。
- L3-R：本脚本覆盖真实练习展示，使用两种驱动共用的快照与 Phaser 装备渲染。测试网只读 state override 探针核对 80 场生产结果；不作为部署或真实智能账户付款证据。

---

## 九、固定 seed 不再固定练习赛：出场名单取自未播种的 Math.random

脚本：`practice-lineup-seed.spec.ts`

### 缺陷现象

同一条 `?seed=` 的免费试玩每次刷新给出不同结果。`practice-rules-audio` 的「第一名」一档连跑三轮分别得到名次 3、1、4（期望 1，第二轮侥幸通过），「第四名」一档三轮都是 5（期望 4）；`practice-gravity-trace` 四轮全部在 `__gravityScene.ponies[0].blackhole.visible` 处轮询超时。三者共同的前提——玩家固定在 0 号车道、五匹马能力分布固定——已不成立。

### 根因假设

状态管理层。`src/ui/ponySelection.ts` 的 `createPonySelection(ids, rng = Math.random)` 用未播种的 `Math.random` 洗 `orderedPonyIds`；`selectionEntry` 由此给出 `playerHorseId = 4 - 可见位次` 与 `roster = [...可见].reverse()`；`src/App.tsx:414` 把两者原样交给练习 `RaceDriver`，`derivePaidCoreInput` 再按名单套用小马能力。seed 固定时，玩家车道与五匹马的能力分布仍每次挂载重抽。`SelectScreen` 已留出 `rng?: () => number` 入参，`App` 没有传。

穷举 120 种名单排列（全程跳过选牌）可量化影响：`0x1392a0…` 得第一名的名单只有 3/120，`0x4fdb69…` 得第四名的只有 24/120。而第一面板候选牌与名单无关——C-17、C-02、C-10 在 120/120 种排列下不变——所以 `motion` 的 badge-pop 与 `practice-spin-thrust` 仍稳定通过。因此这不是换种子能解决的问题：任何 seed 都钉不住名次。

### 复现说明

```bash
./node_modules/.bin/playwright test --config tests/e2e/playwright.config.ts regressions/practice-lineup-seed.spec.ts
```

第一例用同一条 `?seed=0x00000003` 的 URL 连开六次选马页，读 `horse-<ponyId>` 上的 `data-lane`，要求六次名单一致，修复前即在此失败。第二例截图并按清单核对选马页，再经选马、档位、开赛按钮进入比赛，读正在运行的 `RaceScene`，断言 `driver.state.playerHorseId` 等于选马页上 `horse-0` 的车道、`replayInput.roster[playerHorseId] === 0`，证明驱动直接采用这份名单。脚本只走 UI，不注入效果、不改规则时钟。

### 关联模块与证据边界

- L1：`src/ui/ponySelection.test.ts` 以注入的 rng 覆盖洗牌与 `selectionEntry`，因而捕捉不到生产默认值；修复应在该层补「同一 seed 得同一名单」的断言。`src/race/driver.test.ts` 固定传入 roster，同样不覆盖来源。
- L2：不涉及端口契约。名单只在前端产生，`openSession` 的 `uint8[5] roster` 由 `src/chain/paidCalls.test.ts` 钉住。
- L3-R：本脚本只证明名单不稳定以及它进入驱动的路径，不替 `practice-rules-audio`、`practice-gravity-trace` 的断言背书；在底层修复前，这两个脚本不应改写断言去迁就随机名单。

修法应落在生产代码：由练习 seed（或一个显式 URL 入参）派生 `SelectScreen` 的 `rng`，使 `?seed=` 同时钉住名单。修复后还需按实际 `playerHorseId` 重述 `practice-gravity-trace` 里写死的 `ponies[0]`、`i.horse === 0`，以及本文第八节「玩家马 0」的表述。
