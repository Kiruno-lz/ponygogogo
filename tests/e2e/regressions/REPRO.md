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
