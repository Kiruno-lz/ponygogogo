# Ponygogogo 黑客松视频制作方案

Oct 12, 2026 · @kiruno

**Monad Metropolis 今天（10 月 13 日）截止提交**，官方页只写了日期没写具体时刻：先在提交平台确认截止时间，以及提交后能否修改视频链接。下一节是你今天要做的录制清单（约 2 小时），你录素材时我同步做图形素材，素材到齐后我负责全部剪辑。视频 1 用一场真实有奖比赛证明合约复算并付款；视频 2 由你出镜讲为什么做、怎么做，并点名 Mera、Alchemy、Envio 三个专项奖。

## 你的录制任务清单（今天）

按顺序做，全部素材放进仓库里的 `output/hackathon-video/`（已建好，已被 git 忽略），全程约 2 小时；做完在对话里告诉我，我开始剪。

```text
/Users/kiruno/Documents/_code/vibe/Ponygogogo/output/hackathon-video/
├── raw/    录屏：OpenScreen 导出的 MP4
├── cam/    视频 2 出镜：手机视频 + 同步录的声音
├── vo/     视频 1 旁白
├── music/  配乐（可选）
└── final/  我的成片输出，你不用动
```

### 录制规格

| 素材 | 格式 | 设置 |
| --- | --- | --- |
| 录屏 | MP4（H.264），OpenScreen 导出 | 录整块内建屏幕而不是单个窗口，系统的通行密钥弹窗才会在画面里。导出选最高画质、原始分辨率 3024×1964（不要降到 1080p，放大镜头靠这份余量）、60 fps。关闭自动缩放、背景、边距、圆角、阴影、动态模糊、点击特效；保留正常大小的光标。能录系统声音就开，关麦克风和摄像头。导出前保留 OpenScreen 工程文件 |
| 旁白 | WAV 48 kHz，或 QuickTime「新建音频录制」的 .m4a（质量选最高） | 安静房间，关空调风扇；MacBook 自带麦距嘴约 30 cm；不加降噪、均衡、压缩；每个文件开头和结尾各留 1 秒安静 |
| 出镜视频 | iPhone 后置摄像头，横屏，4K 或 1080p，30 fps，.mov | 关闭 HDR 视频（设置 → 相机 → 录制视频）；与眼睛齐平，距离 1–1.5 m，胸口以上，脸在画面上三分之一；看镜头；光从正前或侧前方，不要背光 |
| 出镜声音 | 同旁白 | MacBook 在画外同时录音；每条开拍先在画面里拍一下手，停 1 秒再说话，我靠这一声对齐音画 |

### 开录前准备（约 10 分钟）

- [ ] 确认截止时刻，以及提交后能否改视频链接。
- [ ] 游戏 SETTINGS 里 Language 切到 English；音量默认；Reduce motion 保持关闭。
- [ ] Chrome 进入全屏（⌃⌘F），取消勾选「视图 → 全屏模式下始终显示工具栏」；网页缩放 100%；第二个标签页预先打开 [PaidRaceSolver 合约页](https://testnet.monadvision.com/address/0xEAb3720908E36584b88f85c85b5Cb91c3ba798f0?tab=Contract)。
- [ ] 打开专注模式挡通知，退出无关应用；磁盘至少留 20 GB（现在剩约 41 GB，录屏每分钟约 0.3–0.5 GB）。
- [ ] 先跑一场免费试玩预热（不用录），消掉首次 RACE 时的资源加载框。
- [ ] 测试币：每场有奖赛 1 MON，录 3–5 场至少要 5 MON。录完 R1 后从你自己的测试网账户向 demo 账户的智能账户地址转 5 MON，用同一个账户录完全程，前后镜头的地址才一致。

### 录屏清单

- [ ] **R1 注册** · `raw/v1-signup.mp4` · 1–2 分钟
  - 操作：首页（未登录）→ Sign up → 名字填 demo → Create passkey → Touch ID → 等木牌出现地址和余额 → 点开木牌（钱包面板）停 3 秒 → 关闭。
  - 要点：系统的通行密钥 / Touch ID 弹窗必须在画面里；等余额真的到账再停录。不要点「导出助记词」。
  - 不重要：等待时长、输入名字的过程，剪辑时都会剪掉。
- [ ] **R2 有奖比赛** · `raw/v1-race-A.mp4`、`-B`、`-C`（可到 `-E`）· 每场 3–4 分钟
  - 操作：每场一个文件，从首页一直录到浏览器取证结束，中途不停。START → 用上下箭头翻一遍小马队列 → 选 Shadow（特性提示会出现，且只有它开局带 1 次 Refresh）→ 下注 1 MON → RACE → 直道上分 2–3 次连点 GOGO，每次约 3 秒 → 每个检查点在三张卡上各停约 1 秒，第一个检查点先点一次 Refresh 再选 → 冲线后停在结算页，直到印章变成 Settled、出现 On-chain rank，再停 3 秒 → 点 Tx → 区块浏览器：交易概览停 3 秒 → 内部交易里 PonyVault 转给你的那一行停 3 秒 → 日志里的 SessionSettled 停 3 秒。
  - 只在 A 场额外录：切到第二个标签页，停在「Contract Source Code Verified (Full Match)」3 秒；切回游戏结算页 → Make a poster → 等出图后在复制、保存、X 按钮上各停 1 秒 → 关闭。
  - 要点：优先选画面上看得见效果的卡——Rocket Booster、Bombs Away、Boogie Woogie、Gravity Well、Wind Fire Wheels、Nyan Cat、Chinese Horses Can Fly、Sticky Fingers，纯数值卡尽量不选。至少一场跑进前三（第 1–3 名才有返还转账可拍）。若掉落稀有卡或新角色，继续录：点击翻牌 → 等彩带 → Keep it；接着出现 Syncing collection 时若弹 Touch ID，就在镜头里确认——那是同一把通行密钥派生收藏密钥，正好是 Mera「One Passkey, Many Keys」的画面。鼠标放慢，点击前悬停半秒；不操作时把光标停在左下角。
  - 不重要：B 场以后选哪匹马、具体名次、交易等待时长、尾场、等待时的小失误。
- [ ] **R3 钱包历史与图鉴** · `raw/v1-extras.mp4` · 约 1 分钟
  - 操作：所有有奖赛录完后，点开木牌 → Recent races 列表里在一行的 Tx 链接上停 2 秒 → 关闭 → 首页 COLLECTION → 卡牌页慢慢滚动 5 秒 → 小马页停 5 秒 → 返回。
  - 要点：滚动慢而匀；有新解锁的卡或马，在它上面停 2 秒。
  - 不重要：滚到哪里。
- [ ] **R4 免费试玩 B-roll** · `raw/v2-broll-1.mp4`、`-2`（可到 `-3`）· 每场约 1.5 分钟
  - 操作：下注 0（免费试玩），每场换一匹马，照常比赛。
  - 要点：专门为特效而录，选卡规则同 R2；每场至少一次 GOGO 连点；几场合起来尽量覆盖炸弹、换道、黑洞、火箭、风火轮、彩虹猫。
  - 不重要：名次、结算页。
- [ ] **R5 Envio 排名查询** · `raw/v2-envio.mp4` · 约 30 秒（Envio 专项奖用，建议录）
  - 游戏里没有排行榜界面，排名数据只在 Envio 索引器里；这段录屏就是它的证据。
  - 操作：打开 Envio 控制台里当前部署（提交 893763f）的 GraphQL Playground，粘贴下面的查询并运行，停在结果上 5 秒。
  - 要点：结果里能看到玩家按净盈亏排序、小马按胜场排序。
  - 不重要：编辑器配色、窗口大小。
- [ ] **R6 首页空镜** · `raw/v1-home.mp4` · 15 秒
  - 操作：登录状态停在首页，光标移出画面，什么都不点。用作片尾卡背景。

R5 用的查询：

```graphql
query Rankings {
  Player(order_by: {net: desc}, limit: 5) { id sessionsSettled net settlementRankCounts }
  HorseStat(order_by: {settlementWins: desc}) { ponyId raced settlementWins }
}
```

### 视频 1 旁白

- [ ] 按「视频 1 英文旁白」逐段录，一段一个文件：`vo/v1-s1-t1.m4a` … `vo/v1-s9-t1.m4a`；同一段重录就递增 t2、t3，告诉我哪条最好（不说我自己挑）。
- [ ] 语速每分钟 150–160 词，明快、带笑意；超出下表目标 15% 以上就重录，或告诉我删字。

| 段 | s1 | s2 | s3 | s4 | s5 | s6 | s7 | s8 | s9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 目标秒数 | 9 | 14 | 13 | 5 | 30 | 3 | 27 | 14 | 7 |

### 视频 2 出镜

- [ ] 6 段全部出镜录（第 3–5 段画面会换成动画和游戏画面，但同一场景录的声音才连贯）：`cam/v2-s1-t1.mov` 配同名声音 `cam/v2-s1-t1.m4a`，依此类推到 s6；每段 2–3 条。
- [ ] 语速：英文每分钟 140–150 词，聊天口吻；中文每分钟约 250 字。第 1、6 段很短，尽量背下来直视镜头；其余段把脚本放在手机后方的 Mac 屏幕上，字号调大。
- [ ] 中文备份：英文某段三次都不满意，就整条视频改用中文（不要中英混搭），文件名加 `-zh`，如 `cam/v2-s1-zh-t1.mov`；我配英文字幕。

| 段 | s1 | s2 | s3 | s4 | s5 | s6 |
| --- | --- | --- | --- | --- | --- | --- |
| 英文目标秒数 | 7 | 21 | 15 | 33 | 13 | 20 |
| 中文目标秒数 | 7 | 22 | 16 | 33 | 14 | 20 |

### 配乐与交付

- [ ] 配乐：游戏自带 `bgm_home` 和 `bgm_race` 两段 BGM。如果你有它们的使用授权，告诉我一声，我直接拿来做配乐；否则把有授权的曲子放进 `music/`，附一个写明来源和授权的 txt。
- [ ] 做完在对话里回复：① 截止时刻 ② 最好的一场是 A–E 哪个 ③ 有无掉落（哪个文件、大约第几分钟）④ 视频 2 用英文还是中文 ⑤ BGM 能否使用。

## 总体策略

两条视频不重复：视频 1 只回答「它真能玩、真在链上结算吗」，视频 2 只回答「谁做的、解决什么、为什么」。

|  | 视频 1：产品演示 | 视频 2：团队与动机 |
| --- | --- | --- |
| 时长 | 目标 2:50（上限 3:00） | 目标 1:55（上限 2:00） |
| 要证明的事 | 一场真实有奖比赛：注册 → 下注 → 选牌 → 合约复算 → 付款，全流程可用 | 问题真实存在；方案在 Monad 上才划算；做的人可信 |
| 画面 | 100% 产品录屏 + 区块浏览器，不用幻灯片 | 你出镜约一半，其余为游戏 B-roll 和两张动画图示 |
| 旁白 | 英文画外音，约 300 词 | 英文出镜讲，约 230 词；备中文稿 |
| 结尾 | ponygo.kiruno.cc + GitHub 链接静帧 2 秒 | 同左 |

贯穿两条视频的一句话：**Fun like a game, verifiable like a contract.**（玩起来像游戏，算账像合约。）

- **语言**：英文旁白 + 烧录英文字幕。评委常在静音或倍速下浏览，字幕保证不听声音也能看懂。视频 2 备有中文稿：英文不顺就整条改中文讲 + 英文字幕。
- **游戏界面**：在「游戏设置」切到 English 再录。英文卡名本身是全球通用的梗（Nyan Cat、Sticky Fingers、The Last Hamon），笑点不丢。
- **规格**：1920×1080、60 fps、H.264；响度按 YouTube 标准归一到 −14 LUFS。
- **上传**：YouTube「不公开（Unlisted）」即可提交；标题、简介和章节时间戳由我来写。

## 视频 1：产品演示脚本（2:50）

主线是你在 Monad 测试网上真实打的一场 1 MON 有奖比赛，第 7 段的链上取证是全片高潮，其余镜头都为它铺垫。

### 分镜表

| # | 时间 | 段落 | 画面与操作 | 屏幕字幕 |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:10 | 开场钩子 | 从主线比赛里截最热闹的 6 秒：选牌慢放、炸弹炸停对手或交换赛道；末尾 1 秒硬切结算页「Settled」印章特写 | Ponygogogo · live on Monad testnet |
| 2 | 0:10–0:28 | 注册 | 首页 → Sign up → 取名 → Create passkey → 系统 Touch ID 弹窗（剪掉等待）→ 木牌显示地址和余额；点开钱包面板停 2 秒：智能账户地址、Monad Testnet、余额 | Mera passkey → wallet · Alchemy smart account · gas sponsored · no pop-ups |
| 3 | 0:28–0:45 | 选马与下注 | Start → 用上下箭头翻看小马队列，点选 Shadow 让特性提示「Start with 1 refresh」出现 → 选定你的马 → 下注 1 MON（面板显示最高可赢 3 MON）→ RACE → 画面出现 Entry submitted → Entry included 提示 | Entry tx: stake locked in PonyVault |
| 4 | 0:45–0:55 | 起跑 | 3-2-1 倒计时 → 起跑；连点 GOGO，镜头前推；右侧名次榜实时变化 | GOGO moves the camera, never the pony |
| 5 | 0:55–1:38 | 三次选牌 | 25%：慢放 + 三选一 + 20 秒倒计时，先用一次「刷新」再选牌，出现 Choice submitted → Checkpoint 1 is on chain；路段 2× 快进；50%：选跨马卡（Boogie Woogie 换道 / Gravity Well 黑洞 / Bombs Away 炸弹），让效果在画面里发生；插一个电脑马用卡的镜头（彩虹拖尾或炸弹打到你）；75%：快速选牌 | 40 meme cards · 3 picks per race / Each pick = 1 gasless tx, its block hash seeds the card |
| 6 | 1:38–1:46 | 冲线 | 你的马冲线 → 预览名次「Preview rank · awaiting chain」→ 尾场快放 | Browser result = preview only |
| 7 | 1:46–2:18 | 链上结算证明 | 结算页印章 Settling → Settled，链上名次与预览一致，显示返还金额 → 点结算页的「Tx」链接 → 区块浏览器：Success → Internal Txns 里 PonyVault 转给你账户的金额 → Logs 里 SessionSettled（五匹马的 finishTime）；两处各放大 150–200% → 合约页「Source Code Verified (Full Match)」2 秒 | PaidRaceSolver re-runs all 5 ponies on-chain / Solver 36 KB · Ethereum limit 24 KB · Monad limit 128 KB |
| 8 | 2:18–2:38 | 收藏与分享 | 当场掉落则用翻牌 + 彩带的获得动画和图鉴里的新解锁；未掉落则展示图鉴里锁住的稀有卡。随后钱包面板的比赛历史（带 tx 链接）→ 2 秒 Envio 排名查询 → 分享海报 | 20% of settled races drop a rare card or pony / Envio: history & rankings |
| 9 | 2:38–2:50 | 收尾 | 首页全景 → 片尾卡：Logo、ponygo.kiruno.cc、github.com/Kiruno-lz/ponygogogo、Built on Monad testnet，静帧 2 秒 | — |

### 英文旁白（按段录制，约 300 词）

每段单独录一遍，剩余时间留给游戏音效。斜体是中文意思，不念。

1. **\[0:00\]** Five ponies, three meme cards, and a smart contract that replays the whole race before it pays you. This is Ponygogogo on Monad testnet.
   - *五匹马、三张梗卡，还有一份在付钱前把整场比赛重跑一遍的合约。*
2. **\[0:10\]** Sign up with one Mera passkey — no extension, no seed phrase. It derives your wallet and an Alchemy smart account, topped up with test MON automatically. Gas is sponsored, and one sign-in covers every transaction — no pop-ups.
   - *一把 Mera 通行密钥派生钱包和 Alchemy 智能账户，自动到账测试币；Gas 被赞助，一次登录覆盖所有交易，不再弹窗。*
3. **\[0:28\]** Pick a pony — each has a trait, like a free card refresh. Choose your stake. One transaction locks it in the vault, and that block's hash fixes your deck and your rivals' top speed.
   - *每匹马有特性；一笔交易锁定下注，该区块哈希决定你的牌堆和对手极速。*
4. **\[0:45\]** Mash GOGO for hype — it only moves the camera, never your speed.
   - *GOGO 只动镜头，不改速度。*
5. **\[0:55\]** At a quarter, half, and three-quarters of the distance, time slows to a tenth and you draft one of three cards from a pool of forty. They stack and they combo — rockets, bombs, lane swaps, a black hole that drags the whole field toward you. The CPU ponies draw cards too, and they will hit you. Every pick is its own gasless transaction, and its block hash seeds that card's randomness — sealed on-chain, so no one can quietly change it later.
   - *三个里程点慢放到 0.1 倍三选一；卡牌可叠加、会打到别的马；电脑马也抽卡；每次选牌是一笔免 Gas 交易，其区块哈希封存在链上作为随机源。*
6. **\[1:38\]** Crossing the line only gets you a preview.
   - *冲线只得到预览。*
7. **\[1:46\]** Settlement hands the contract nothing but what's already on-chain: the seed, your picks, their timestamps and block hashes. PaidRaceSolver re-runs all five ponies — event-driven physics, every card effect, even the black hole's pull — and the vault pays you in that same transaction. The source is verified on the explorer, and the browser checks the chain's result field by field. No server, oracle, or signer decides who wins.
   - *结算只读链上已有输入；合约重跑五匹马并在同一笔交易里付款；源码已在区块浏览器验证，前端逐字段比对；没有服务器、预言机或签名者决定输赢。*
8. **\[2:18\]** Settled races can drop a rare card or a new pony, recorded on-chain. Envio indexes every race — your history here, plus player and pony rankings — and every finish becomes a poster to share.
   - *结算可能掉落稀有卡或新角色并记录上链；Envio 索引每场比赛，提供历史与玩家、小马排名；结果可生成海报。*
9. **\[2:38\]** Ponygogogo — fun like a game, verifiable like a contract. Play it now at ponygo dot kiruno dot cc.
   - *片尾口号与网址。*

## 视频 1：录制与剪辑要点

一场有奖赛真实时长约 1.5 分钟（今天实测一场试玩的比赛用时 51.8 秒，另加三次选牌、入场与结算交易），成片里只给它约 60 秒，所以必须分段录、多场采、剪辑提速。

- **录屏工具**：OpenScreen 录全屏原片，不加缩放和光标特效；放大镜头、点击强调和变速都在剪辑时由我加。
- **浏览器**：Chrome 全屏模式、缩放 100%，开专注模式挡住通知（细节见任务清单）。
- **分段录**：注册一段；选马到结算整场一段；区块浏览器取证一段；收藏、历史、海报一段。不要求一镜到底。
- **多场取最佳**：录 3–5 场有奖赛，每场从 RACE 录到印章 Settled。主线选名次 1–3（有返还）且卡牌效果最热闹的一场；每场 20% 掉落概率，5 场至少掉一次的概率约 67%。不要用开发版的特效验收入口伪造掉落。
- **选牌策略**：为画面而选。优先选有可见表现的卡：Rocket Booster、Bombs Away、Boogie Woogie、Gravity Well、Wind Fire Wheels、Nyan Cat；纯数值卡在画面上看不出变化。
- **提速与诚实**：起跑和中间路段 2× 快进，选牌、卡牌效果、冲线保持原速。所有快进片段左上角放「2×」角标——这条视频卖的是「可验证」，时间上不做手脚。等待交易、生成海报（约 8 秒）等空白直接剪掉即可。
- **光标**：动作放慢，悬停 0.5 秒再点击，让评委看清点了什么。
- **声音**：游戏音效保留，平时压在旁白下方；选牌慢放和冲线瞬间短暂抬起。背景音乐在旁白出现时自动闪避。
- **禁止入镜**：不要打开「导出助记词」。钱包地址是测试网地址，可以露出。
- **取证段可读性**：区块浏览器字小，剪辑时对金额行和 SessionSettled 事件做放大 + 高亮框。合约源码已验证（Full Match），事件字段会解码成可读名称。

## 视频 2：团队、问题与动机脚本（1:55）

这条从「我是 Kiruno，一个 builder」讲起：看到 Mera 的惊喜 → 赛马兴趣与策略、梗卡 → 游戏操作与链上验证的平衡 → agent 自主参赛。第 5 段简短说明 Mera、Alchemy、Envio 如何支持产品体验；结尾聚焦下一步的参赛 agent。

### 分镜表

| # | 时间 | 段落 | 画面 | 屏幕字幕 |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:08 | 自我介绍 | 你出镜；右下角小窗循环播放比赛画面 | Kiruno · builder / Ponygogogo · Monad |
| 2 | 0:08–0:31 | Mera 带来的灵感 | 前半出镜；说到指纹或扫脸时切注册画面：通行密钥弹窗 → 钱包到账 | Mera · fingerprint or face unlock / No private key or seed phrase to manage |
| 3 | 0:31–0:48 | 策略与梗 | 选牌慢放、卡牌效果快剪：炸弹、换道、黑洞、火箭、彩虹猫 | 40 meme cards · 3 picks per race |
| 4 | 0:48–1:23 | 操作与验证 | 结算流程动画（见下一节图示）：入场与选牌交易 → 封存区块哈希 → 合约重算 → 链上名次与付款；合约体积对比条突出 Monad 128 KB 上限 | Browser = preview · Contract = referee / Sealed block hashes → reproducible race |
| 5 | 1:23–1:37 | 产品体验 | 三个赞助商标签依次出现，各配真实画面：Mera 配图鉴同步；Alchemy 配选牌上链提示；Envio 配钱包历史与排名查询 | Mera · one passkey, many keys / Alchemy · gas sponsored / Envio · history & rankings |
| 6 | 1:37–1:55 | agent 参赛 + 收尾 | 你出镜 → 片尾卡静帧 2 秒；agent 接口是下一步计划，字幕标明 Next | Next: autonomous agents / Read race state · choose cards · compete for rewards |

### 英文旁白（约 230 词）

按每分钟 140–150 词录制；分镜时间包含换镜与停顿，片尾留 2 秒静帧。

1. **\[0:00 出镜\]** Hi, I'm Kiruno. I made Ponygogogo, a card-based horse-racing game on Monad.
2. **\[0:08 出镜 → 注册画面\]** Seeing Mera was a pleasant surprise. I love being able to manage a wallet with a passkey, using just a fingerprint or face unlock, without handling private keys or seed phrases. That felt perfect for a simple on-chain game.
3. **\[0:31 选牌画面\]** I've also been getting into horse racing, so I combined it with strategy and popular memes. At three checkpoints, you pick one of three cards from a pool of forty, reacting to the race as it unfolds.
4. **\[0:48 流程动画\]** The hardest part was balancing responsive gameplay with on-chain verification. Monad's 128-kilobyte contract limit let me put the full race rules into a solver contract. The browser shows a preview; only the on-chain ranking determines payouts. Block hashes from entry and card-choice transactions are sealed on-chain to fix the race's random inputs. So each race stays unpredictable and fun, while the contract can recompute the whole thing from recorded inputs before paying out.
5. **\[1:23 赞助商标签\]** Mera also derives separate keys for collection encryption and signing. Alchemy sponsors transaction gas, keeping play smooth. Envio indexes race events for history and rankings.
6. **\[1:37 出镜 → 片尾\]** My next priority is a complete interface for autonomous agents to enter races, read the race state, and choose cards. I want your smartest agent to keep playing for you and competing for rewards. Try Ponygogogo at ponygo dot kiruno dot cc.

### 中文备份稿（约 400 字）

按每分钟约 250 字录制，专有名词与停顿另留时间。专有名词（Mera、Alchemy、Envio、Monad、Ponygogogo）照英文念。

1. **\[0:00\]** 大家好，我是 Kiruno。基于 Monad 的卡牌赛马游戏Ponygogogo的开发者。
2. **\[0:08\]** 契机是看到 Mera 的时候，我觉得很惊喜。我很喜欢它只用指纹或者扫脸，通过 passkey 就能管理钱包，不用自己保管私钥和助记词。于是准备用它开发一个简单的链上小游戏。
3. **\[0:31\]** 最近我又对赛马很感兴趣，所以做了这么一款加入一点策略要素和流行 meme 的游戏。
4. **\[0:48\]** 最难的地方，是平衡游戏的可操作性和链上的验证。得益于 Monad 的 128 KB 合约上限，我把完整的比赛规则搬进了链上求时器，浏览器只负责即时预览。入场和选牌会作为交易封存在链上，比赛中所有的随机都由此刻的区块哈希产生。通过这样的方式，玩的时候保留随机和乐趣，赛后又能根据记录完整重算和验证，同时避免了链下的信任问题。
5. **\[1:23\]** Mera 还为图鉴派生独立的加密和签名密钥；Alchemy 代付交易 Gas，和智能账户；Envio 提供比赛历史和排名数据。
6. **\[1:37\]** 接下来的更新围绕补充技能特效的素材、对卡牌的数值进行平衡调整，以及最重要的更新，补齐多 agent 同台竞技、自主参赛的完整接口，能够让它自主参加比赛、判断情形并执行选择。用最聪明的 agent 互相对抗，争取奖金，把pve做成eve的赏金争夺比赛

## 视频 2：拍摄要点与图示

出镜段的质量主要取决于收音，其次是光线；画面分辨率反而最不重要。

- **机位、光线、收音、文件名**：见任务清单的「录制规格」和「视频 2 出镜」。
- **画面切换**：第 2 段说到 Mera 时切注册画面；第 3–5 段换成游戏 B-roll 和动画，声音仍用你出镜时录的；第 1、6 段保留你的脸。
- **B-roll**：全部取自 R1–R5 录屏，我负责挑选和剪辑。
- **图示**：三张文字卡、下面这张结算流程图、合约体积对比条（24 / 36 / 128 KB）、三个赞助商标签，都由我做成 1080p 动画素材。

&#91;embedded content: 结算流程 · 视频 2 第 4 段动画的分步顺序\]

视频 2 第 4 段按这张图的顺序逐步点亮：先浏览器，再入场与选牌交易及其封存哈希，再结算时的三个合约（求时器高亮），最后事件回传浏览器。成片动画沿用游戏的木牌风格，不用这里的文档配色。

## 分工：我能做什么、必须你来做什么

凡是需要你的 Touch ID、你的声音、你的脸、你的账号或你的审美拍板的事必须你来；其余的脚本、图形、字幕、剪辑合成和提交文案我都能做到成品级。

| 工作 | 我负责 | 你负责 |
| --- | --- | --- |
| 脚本与旁白文本 | 本文档；按你的评论改到定稿 | 通读，标出念不顺的句子 |
| 产品与链上预检 | 开拍前只读检查 Vault 余额、入场开关、Envio 同步；录制中发现的问题按你的 L1/L2/L3 规范修 | 合约验证已完成 |
| 录屏与 B-roll | — | 按任务清单录 R1–R6（通行密钥和真实下注只能你操作） |
| 旁白与出镜 | — | 录视频 1 旁白、视频 2 出镜 |
| 图形素材 | 片头与片尾卡、字幕样式、2× 角标、取证高亮框、视频 2 文字卡、结算流程动画、体积对比条、赞助商标签、YouTube 封面；你录制时我同步制作 | 审美拍板 |
| 剪辑合成 | 全部：选段、放大镜头与点击强调、变速、字幕烧录、图形合成、配乐闪避、−14 LUFS 响度、导出 1080p60 H.264 | 审片 |
| 配乐 | 用游戏 BGM（需你确认授权）或你提供的曲子 | 确认授权 |
| 上传与提交 | YouTube 标题、简介、章节，提交文案，英文 README | 上传、提交 |

## 旁白说法的事实依据

两条视频里的每个关键说法都能在公开仓库或链上查到，评委追问时可以直接给链接。

| 说法 | 依据 |
| --- | --- |
| 一把 Mera 通行密钥派生钱包，钱包拥有 Alchemy 智能账户并自动领测试币 | [wallet.ts](https://github.com/Kiruno-lz/ponygogogo/blob/main/src/chain/wallet.ts)、[derive.ts](https://github.com/Kiruno-lz/ponygogogo/blob/main/src/chain/derive.ts)：PRF → 助记词 → 根 EOA → 智能账户 → 领币 |
| 一把通行密钥派生多把钥匙：钱包 + 收藏加密密钥 + 收藏签名密钥 | [collectionIdentity.ts](https://github.com/Kiruno-lz/ponygogogo/blob/main/src/chain/collectionIdentity.ts)：用 Mera 的 getPasskeyPrfOutput 以两个独立 salt 派生 encryption 与 identity；生产环境收藏同步接口今天实测在线 |
| Gas 被赞助，一次登录后整场交易零弹窗 | [alchemy.ts](https://github.com/Kiruno-lz/ponygogogo/blob/main/src/chain/alchemy.ts)：每笔调用携带 paymaster policyId；交易由登录时派生的本地密钥签名。代码里每笔交易只装一个调用，没有批量打包 |
| 入场区块哈希决定牌堆与对手极速 | [链上架构 §4](https://github.com/Kiruno-lz/ponygogogo/blob/main/docs/architecture/onchain.md) |
| 40 张卡、三个里程点选牌、选牌时 0.1 倍慢放 | [玩法设计 §3–§4](https://github.com/Kiruno-lz/ponygogogo/blob/main/docs/game-design.md) |
| 每次选牌一笔交易，其区块哈希封存上链作为随机源 | [PonyGame.sol](https://github.com/Kiruno-lz/ponygogogo/blob/main/contracts/PonyGame.sol)：chooseCard 与 RandomAnchorSealed 事件 |
| 结算只读链上输入，合约重跑五匹马并同笔付款 | PonyGame.settleSession 只接收 sessionId；PonyVault.settleStake 在同一交易内转账 |
| 合约源码已验证 | [PaidRaceSolver](https://testnet.monadvision.com/address/0xEAb3720908E36584b88f85c85b5Cb91c3ba798f0?tab=Contract) 显示 Contract Source Code Verified (Full Match) |
| 浏览器逐字段比对链上结果 | 结算页不一致时显示「链上结算与浏览器预览不一致，以链上为准」 |
| 求时器 36 KB，超以太坊 24 KB、低于 Monad 128 KB | eth\_getCode：37,188 B；EIP-170 上限 24,576 B；Monad 上限 131,072 B |
| 返还倍率 1–5 名为 3× / 1.5× / 1× / 0 / 0（含本金） | PonyGame.payoutMultipliers() |
| 结算 20% 概率掉落稀有卡或新角色，记在 PonyRewards | [链上架构 §6](https://github.com/Kiruno-lz/ponygogogo/blob/main/docs/architecture/onchain.md) |
| Envio 提供历史与排名 | 应用只查询历史（[history.ts](https://github.com/Kiruno-lz/ponygogogo/blob/main/src/chain/history.ts)）；排名数据在索引器的 Player、HorseStat、CardStat（[schema.graphql](https://github.com/Kiruno-lz/ponygogogo/blob/main/envio/schema.graphql)），今天公开端点返回 8 场已结算比赛 |
| 下一步补齐 agent 自主参赛接口 | [PonyGame.sol](https://github.com/Kiruno-lz/ponygogogo/blob/main/contracts/PonyGame.sol) 已有 openAgentSession、configureAgentBudget、revokeAgentBudget；[AgentBudget.sol](https://github.com/Kiruno-lz/ponygogogo/blob/main/contracts/abstracts/AgentBudget.sol) 限制累计下注与期限。[alchemy.ts](https://github.com/Kiruno-lz/ponygogogo/blob/main/src/chain/alchemy.ts) 的 grantAgentSession 当前只授权 openAgentSession，未覆盖 chooseCard；读取赛况、策略决策与自动选牌的完整参赛流程仍需补齐 |
| 单人开发、美术由 OpenAI 图像模型生成 | git 历史：唯一作者 Kiruno-lz，首个提交 2026-09-14 即原型；美术来源由你提供 |

旁白里的「不用管理私钥和助记词」指用户体验；实现仍会从 passkey PRF 输出派生助记词与签名密钥。区块哈希封存保证比赛随机输入可追溯、可重算，不等于随机数无偏，不要说「绝对公平」。Monad 的 [128 KB 合约代码上限](https://docs.monad.xyz/developer-essentials/differences) 支持完整规则部署；视频 2 不再依赖具体求时器体积来讲这个设计。Agent 段讲下一步计划与争取奖金，不承诺持续盈利。

## 还需要你确认的事

录制中的事项都在任务清单末尾的「做完告诉我」里；下面是剩下的一项。

- [ ] 参赛赛道：Consumer Products & Payments（通行密钥上手、免 Gas、下注付款）或 Social, Attention & Culture（梗卡、海报分享）。选定后我微调两条视频的侧重和提交文案。
