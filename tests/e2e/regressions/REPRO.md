# 回归复现记录

本目录每个脚本对应下面一节，`bunx playwright test --config tests/e2e/playwright.config.ts regressions/` 全量跑。

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

同一份 journey 在 `b38b35d`（接入钱包之前）上以完全相同的方式失败，可排除钱包改动的嫌疑。

### 复现说明

```bash
cd /path/to/Ponygogogo
bunx playwright test --config tests/e2e/playwright.config.ts regressions/countdown-overlay.spec.ts
```

`countdown-overlay.spec.ts` 里 `MISSED_WINDOW` 那条用例把缺陷本身钉住：它以 `raceSpeed=16` 复刻「点完再查」的顺序，断言这样确实抓不到遮罩；`OBSERVED` 那条给出正确写法——**在点击之前就挂上 `waitFor`**——断言同样的 187ms 窗口能被稳定抓到。

修复方式是把等待前移，不是放慢产品的倒计时，也不是给断言加更长的超时（超时再长也救不了已经错过的窗口）。

### 关联模块

- L1：`src/race/driver.ts` 的倒计时相位与 `raceSpeed` 时钟缩放——逻辑本身有 L1 覆盖，未改动。
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
2. `src/ui/CollectionScreen.tsx` 对访客未拥有的稀有卡只渲染带 `data-card` 的锁定占位，不渲染卡面——这是 `docs/plan/card-collection-unlock.md` §2 规定的「稀有卡显示锁定占位，不显示详情」；
3. 数字严格对上：`PAID_CARD_POOL` 共 26 格，其中稀有卡 12 张，`26 − 12 = 14`；
4. `tests/e2e/specs/journey.spec.ts` 早已以 `[data-card]` 作为图鉴格子的计数契约（26 格），只有排版检查还停在「每格都是卡面」的旧假设上。

即：**检查器把「卡面」当成了「格子」**，锁定格按设计没有卡面，于是整格不计数也不做任何排版断言。

### 复现说明

```bash
bunx playwright test --config tests/e2e/playwright.config.ts regressions/collection-locked-slots.spec.ts
```

`FACES_ONLY` 把缺陷机制钉住：`[data-card]` 26 格、`.card-root` 14 张、`[data-card]:not(.card-root)` 恰为稀有卡数，说明漏掉的正是锁定格，且锁定格确实不带卡面。`EVERY_SLOT` 断言修正后的检查器按格子覆盖全部 26 格，并分别报告卡面数与锁定格数。

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

修法在底层 `openModal`：`close` 事件到达时若 `dialog.open` 已为真，说明窗口已经重新打开，事件过期，直接忽略。L1 `src/ui/StageDialog.test.tsx` 用会翻转 `open` 的假 dialog 复刻了 mount → cleanup → mount 的顺序，修复前两条用例失败、修复后通过。

### 关联模块

- L1：`src/ui/StageDialog.test.tsx` 的 `openModal` 用例——「过期的 close 事件被忽略」「StrictMode 重挂后排队的 close 不关窗」。
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
