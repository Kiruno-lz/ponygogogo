# Ponygogogo — 素材管线

素材分两段，中间隔着 `art-src/`：

```
art-src/renders/     作者出的整屏渲染图（参考稿，永不上线）
        ↓  scripts/process-assets.py · postprocess-assets.py · prepare-art.py
art-src/art/         作者定稿素材与切片
art-src/placeholder/ 占位素材（图标、木牌、音频）
        ↓  scripts/build-web-assets.py
public/assets/       部署产物：WebP + Opus + woff2 + manifest.json
```

**`art-src/` 是唯一真源，`public/assets/` 全部由脚本生成，不要手改。** 产物已提交进仓库，
日常开发不需要重跑管线（一次约五分钟）；改了母版或改了版位之后手动跑
`python3 scripts/build-web-assets.py`。

本文 Product 1–6 描述前一段（怎么从渲染图切出母版），第 7 节描述后一段（母版怎么变成产物）。
前一段的脚本是幂等的，要求 Python 3、Pillow ≥ 11、NumPy。

---

## Product 1 — Card Icons

| File | Size | Source region |
|------|------|---------------|
| `icons/icon_01.png` … `icon_19.png` | 256×256 px each | `art-src/renders/card_icon.png` (1254×1254) |
| `icons/_contact_sheet.png` | 1316×1126 px | composed from the 19 icons |

**Extraction method:**  
Row-band + column-blob projection (NOT a fixed grid).  
The source sheet has 5 horizontal bands detected by alpha-column projection, then per-band column blobs split on gaps ≥ 20 px.  
This correctly handles the last row where 3 icons (17–19) are spaced wider than the uniform 4-column grid would place them.

**Actual source bboxes (x0, y0, x1, y1):**

| # | bbox |
|---|------|
| 01 | (54, 33, 305, 257) |
| 02 | (360, 33, 595, 257) |
| 03 | (650, 33, 895, 257) |
| 04 | (946, 35, 1205, 257) |
| 05 | (58, 284, 300, 498) |
| 06 | (351, 284, 605, 498) |
| 07 | (660, 284, 885, 498) |
| 08 | (951, 284, 1208, 498) |
| 09 | (59, 526, 295, 746) |
| 10 | (356, 526, 589, 746) |
| 11 | (651, 526, 900, 743) |
| 12 | (946, 526, 1212, 746) |
| 13 | (52, 774, 309, 990) |
| 14 | (358, 775, 589, 998) |
| 15 | (649, 774, 897, 998) |
| 16 | (940, 774, 1205, 998) |
| 17 | (62, 1018, 340, 1230) |
| 18 | (414, 1018, 690, 1230) |
| 19 | (757, 1018, 1097, 1230) |

---

## Product 2 — Card Frames

| File | Size | Source |
|------|------|--------|
| `ui/card_frame_common.png` | 798×900 px | `art-src/renders/card_normal.png` |
| `ui/card_frame_rare.png` | 757×900 px | `art-src/renders/card_rare.png` |
| `ui/card_frame.json` | — | measured from outputs |

Both source files are RGBA with pre-existing transparent backgrounds.  
The script crops to the alpha content bbox, then resizes to height = 900 px preserving aspect ratio.

**card_frame.json** (all coordinates in output-image pixels):

```json
{
  "common": {
    "w": 798, "h": 900,
    "artRect":    [100, 111, 589, 546],
    "ribbonRect": [72,  661, 698, 150]
  },
  "rare": {
    "w": 757, "h": 900,
    "artRect":    [87, 142, 572, 528],
    "ribbonRect": [62, 674, 631, 146]
  }
}
```

`artRect` — inner parchment usable area [x, y, w, h].  
`ribbonRect` — scroll banner at bottom for card name [x, y, w, h].

**Measurement basis:**  
- artRect top (y): first row at center-x with R>205, G>170, B>125, A>80.  
- artRect left/right: column extent of parchment at 40% image height.  
- artRect bottom / ribbonRect top: first row where parchment column-width  
  exceeds art-area width + 80 px (ribbon protrudes beyond the frame).  
- ribbonRect bottom: last row at center-x with parchment colour.  
- ribbonRect left/right: column extent at mid-ribbon height.

---

## Product 3 — Background Layers

> 这一节的产物**已不再上线**：整层背景被 `art/track/` 的原画切片取代，留在 `art-src/` 作为制作记录。

All layers are RGB (no alpha), cropped from `art-src/renders/race_gaming.png` (1619×971).

| File | Size | Crop (y0..y1) | Notes |
|------|------|---------------|-------|
| `bg/layer_far.png` | 1619×268 | y 0–268 | Sky, castle, mountains, pines, stands |
| `bg/layer_fence.png` | 1619×98 | y 250–348 | Mid fence + signboards |
| `bg/layer_fence_tile.png` | 3238×98 | y 250–348 | `[orig ∣ flipped]` for seamless scroll |
| `bg/layer_front.png` | 1619×223 | y 748–971 | Foreground fence + audience silhouettes |
| `bg/layer_front_tile.png` | 3238×223 | y 748–971 | `[orig ∣ flipped]` for seamless scroll |
| `bg/track_dirt.png` | 512×64 | y 680–744, x 950–1206 | Clean dirt patch → mirrored to 512×64 |

**track_dirt** source region: track-5 right side, x=950–1206, y=680–744.  
Chosen to avoid horses (clustered at x=400–900), lane markers (visible around y=460), and the scoreboard (x>1275).

---

## Product 4 — UI Assets

### `ui/start_gate.png` — 990×615 *（已不再上线：起跑线改由 `RaceScene` 的 graphics 画）*

Cropped from `art-src/renders/race_start.png` (1619×971) at y=175..790, x=150..1140.  
Contains: wooden arch gate, RACE crown sign, numbered flags 1–5, five starter ponies.  
RGB (no transparency needed — rendered as a full background element).

### `ui/logo_title.png` — 1349×465

From `art-src/renders/tittle.png` (1611×976), top content band y=0..465.  
White background removed (threshold: all channels > 244 → transparent).  
Cropped to non-transparent bbox. Contains: Ponygogogo text, horse, cards, gold coins.  
Note: includes the "登录 / 注册" wooden signs at top-right of the same composition.

### `ui/btn_wood.png` — 628×147

From `art-src/renders/tittle.png`, START button at y=482..633, x=488..1128.  
White background removed. Centre text erased (x 20–80%, y 10–90%) and  
replaced with median wood colour (#d89f6c), sampled from left/right end-caps.

**btn_wood.json** (nine-slice margins in output pixels):
```json
{ "left": 81, "right": 81, "top": 20, "bottom": 20 }
```
The left/right margins preserve the angled decorative end-caps (~13% each side).  
The top/bottom margins preserve the dark border edge (~14% each).

### `ui/btn_star.png` — 339×281 *（已不再上线：`theme.css` 里被同特异性的后置规则覆盖，从不绘制）*

From `art-src/renders/race_start.png`, bottom-right region x≥1155, y≥575.  
Gold isolation: R>190, B<90, R−B>130, G>120 (plus dark outline R<85).  
Background removed via BFS connected-component from the gold centroid.  
Centre text zone (x 18–82%, y 15–80%) uniformly filled with median gold (#fdb84a).

**btn_star.json** (nine-slice margins in output pixels):
```json
{ "left": 67, "right": 67, "top": 56, "bottom": 56 }
```

### `ui/panel_parchment.png` — 354×445

From `art-src/renders/race_gaming.png`, right panel x=1265..1619, y=75..520.  
Panel isolated via colour mask (parchment + wood + dark pixels) + BFS  
connected-component from centre. Interior (x 7–93%, y 6–94%) uniformly  
filled with median parchment colour (#f2cdaf) to erase leaderboard content.

**panel_parchment.json** (nine-slice margins in output pixels):
```json
{ "left": 63, "right": 63, "top": 53, "bottom": 53 }
```

---

## Product 5 — Palette

`bg/palette.json` — median pixel colours sampled from `art-src/renders/race_gaming.png`:

| Key | Hex | Sampled from |
|-----|-----|--------------|
| `dirt` | `#b77249` | Track surface x=1000, y=490, r=12 |
| `dirtDark` | `#b16c43` | Darker track patch x=1000, y=440, r=4 |
| `laneLine` | `#ebbe9c` | Inter-lane divider strip x=600, y=452, r=3 |
| `grass` | `#58924e` | Pine tree / grass zone x=400, y=150, r=10 |
| `sky` | `#6f9efa` | Open sky x=550, y=5, r=15 |
| `wood` | `#b28168` | Fence rail x=300, y=285, r=10 |
| `woodDark` | `#a17865` | Fence post shadow x=180, y=283, r=5 |
| `parchment` | `#f1cdb0` | Scoreboard interior x=1440, y=300, r=20 |
| `gold` | `#f4a22a` | Lightning bolt icon x=135, y=63, r=6 |
| `ink` | `#57250c` | Dark text on parchment x=1360, y=210, r=4 |

---

## Product 6 — `prepare-art.py` outputs (manual, run on source-art changes)

Not part of `scripts/dev.sh`; `process-assets.py` and `postprocess-assets.py` regenerate automatically on a missing-directory check, but `prepare-art.py` is a one-off you run by hand whenever the underlying render changes:

```bash
python3 scripts/prepare-art.py
```

**首页不再由这个脚本切。** 早期版本从 `art-src/renders/tittle.png` 抠白底、裁六个矩形得到 `home/{logo,start,collection,settings,login,register}.png`；这段已删除。首页素材现在由作者直接出成无字、透明、非原生尺寸的 PNG，版位靠把素材的实体包围盒对到 `art-src/renders/tittle.png` 里同一块牌的包围盒得出（算法与横纵独立缩放见 `docs/architecture/overall.md` 第 9 节），不再走脚本裁切。

**结算页的奖章与名牌也不再由这个脚本切。** 早期版本把 `result/placement.png`（奖章+木牌+名次条焊成一张）拆成 `medal-1.png` 与 `nameplate.png`；这段连同 `placement.png` 一起删除了。五档奖章与名牌现在都是作者直接出的独立素材：`medal-1..5.png`（金/银/铜/铁/木，名次数字画在牌面上，所以 DOM 里不再叠数字）、`nameplate.png`（木牌+名次条）。渲染顺序仍是先名牌、后奖章，与原画里奖章压在木牌之上的叠放一致；版位见 `src/ui/theme.css` 的 `.result-nameplate` / `.result-medal-art`。

脚本现在只做两件事：

### 6.1 UI 元件二次抠图

- `avatar-source.png` / `star-race-source.png`：从 `art-src/renders/race_start.png` 裁出后套用已有的 `avatar-reference.png` / `star-reference.png` 蒙版做二次抠图。
- `avatar` `avatar-blank` `stamina` `star` `wallet` `bet-panel` `bet-chip` `bet-chip-selected` `coin` `win-strip` `horseshoe` `dust` `gold-ring` `buff-frame` `buff-wing` `buff-leaf` `buff-fire` `buff-eye`：裁到各自 alpha 包围盒存为 `*-trimmed.png`；`dust` 额外缩到 128px 宽；`buff-eye` 的源文件是 `buff-eye-v2.png`。
- `lane-flags.png` 横向切成 5 张 `flag-{0..4}.png`。

### 6.2 赛道背景分层

从 `track/scene.png`（缩放到 1619×971）按 y 区间裁出 `track/far.png`（天空/看台）、`track/front.png`（前景围栏）、`track/track.png`（赛道本体）；远景与前景用 `track/scene-loop.png` 同区间拼接成可循环贴图，赛道层改用左右镜像拼接（`[原图 ∣ 翻转]`）得到 3238px 宽的无缝循环图。

---

## 7. Web 产物管线（`scripts/build-web-assets.py`）

母版约 195 MB，其中大半是参考图、抠图蒙版、逐帧拆分和废弃版本。产物只取被代码引用的那一部分，
并按实测显示尺寸重采样。三条规则各自有必须成立的理由，改动前先读脚本里对应常量旁的注释。

### 7.1 出片清单

脚本里 `DEAD` 与 `INTERMEDIATE` 两张表决定什么不上线。`DEAD` 的每一项都核对过零引用，
理由写在常量旁：整层背景 `placeholder/bg/`（已被 `art/track/` 的原画切片取代）、
`start_gate.png`（起跑线改由 `RaceScene` 画）、`btn_star.png`（`theme.css` 里被同特异性的后置规则覆盖，从不绘制）、
`running-v3/`（未采用的跑步循环重做版）、以及三张被 `-reference` 版本取代的切片。
`INTERMEDIATE` 挡掉制作期资料：AI 生成提示词、抠图蒙版、拼版留档、逐帧拆分。

逐帧拆分里只有 `-idle-0` 上线——`src/export/poster.ts` 画海报用的是静帧，不是八帧横排。
注意 `ships()` 里 `INTERMEDIATE` 必须先判、`FRAME_SPLIT` 后判：`fidelity/` 下也有 `-idle-0`，
顺序反过来会让十张保真度对照图跟着上线。

### 7.2 目标分辨率

**目标 = min(原图, 实测显示尺寸 × 2)，只降不升。** 显示尺寸不是估的：
`scripts/measure-display-sizes.ts` 驱动真实页面走完加载页、首页、图鉴、设置、选马、比赛、选牌、结算，
逐个元素量 `offsetWidth/offsetHeight`（不是 `getBoundingClientRect`——舞台是 `transform: scale`，
后者混进了屏幕缩放），并按 `background-size` 换算贴图实际被画成多大，结果落在 `scripts/display-sizes.json`。
改了版位之后跑 `bun scripts/measure-display-sizes.ts` 重量一次。

有些素材只在走不到的状态里出现：钱包面板要先有账户，增益图标要恰好抽到那几张卡，
`star-reference` 是 `.btn-star` 在文案既不是 `RACE!` 也不是 `GOGOGO` 时的底图。
这些不写死数字——写死会随样式漂移且无人察觉。测量脚本把同样结构的空元素挂进真实页面，
让浏览器按同一份样式表算一次盒子再读回来（`DETACHED` 表，每条注明出处）。
量的是 CSS 级联的结果，不是谁对级联的理解。

**显示尺寸表的键不带扩展名**，这是这条接缝成立的前提：测量跑在已转成 WebP 的应用上，
而管线查的是母版 PNG。键里留着扩展名两边就永远对不上，而对不上时管线不报错，
只会安静地一张都不降采样、产物悄悄变大。管线在出片前核对覆盖率，对不上 80% 就停；
`src/assets/shipped-assets.test.ts` 另有两条断言守这个格式。

`NO_DOWNSCALE` 里的素材禁止降采样，缩小它们不是画质取舍而是功能回归：

| 素材 | 缩小的后果 |
|------|------------|
| `art/track/{far,track,front}.png` | `tileSprite` 按 1:1 平铺，贴图宽度就是滚动循环周期，缩一半等于景物重复频率翻倍 |
| `*-idle.png` / `*-running.png` | 八帧横排分镜，`src/game/pony.ts` 硬编码 `FRAME_W=256`/`FRAME_H=192`，改尺寸即错帧 |
| `placeholder/ui/btn_wood_*.png`、`panel_parchment.png` | `border-image` 的切片数值按源图像素计（`theme.css` 里的 `92 185 71 196` 一类），缩放源图必须同步改切片；这几张当前采样率本就在 1.8–2.4× |

### 7.3 编码

位图一律 WebP，`-q 84 -m 6 -alpha_q 100 -sharp_yuv`。`-sharp_yuv` 是针对这套美术选的：
高饱和平涂加硬描边，默认的色度下采样会在描边上留彩色毛边，sharp_yuv 按亮度加权算色度正好治这个。
`-alpha_q 100` 让 alpha 通道保持无损，切片素材的边缘不会发毛。

字体转 woff2（三个字重合计 920 KB → 308 KB），随字体分发的 OFL 许可原样拷贝——这是许可要求。

音频超过 200 KB 的重编码：`.ogg` 转 Opus 80k，`.mp3` 转 96k。两条 BGM 母版是 141 kbps Vorbis，
各占一兆多，比全部首页美术加起来还大；音效都只有几 KB，重编码省不下容器开销，原样拷贝。

画质由 `python3 scripts/check-asset-quality.py` 核验：把产物与母版各自缩到实测显示尺寸、
合成到白底与深底，取更差的一种比 PSNR，判据是没有一张低于 35 dB。当前中位 40.6 dB、最低 35.8 dB。
注意不要直接比 RGBA 裸通道——全透明像素的 RGB 是无意义值，WebP 会清零，比出来是 9 dB 这种
吓人但毫无意义的数字；玩家看到的是合成结果，比的就得是合成结果。

### 7.4 分级

`manifest.json` 每项带 `tier`，取值 `boot | home | race | result`，含义是「在哪个阻塞点之前必须就绪」。
分界按阻塞点划而不是按页面：`race` 覆盖首页之后到结算之前的一切（选马、比赛、选牌、图鉴、设置），
因为它们都在同一次点击之外。归属由实测的首次出现页面决定，脚本里的 `FALLBACK_TIER` 只管没量到的兜底。

### 7.5 当前体积

| | 母版 | 产物 |
|---|---|---|
| 磁盘占用（部署上传量） | 193 MB | **8.70 MB** |
| 玩家实际下载（全部四级） | — | 6.71 MB |
| 其中进首页要等（`boot` + `home`） | — | **1.83 MB** |
| 其中后台预取（`race` + `result`） | — | 4.88 MB |

磁盘 8.70 MB 与下载 6.71 MB 的差额是音频的 `.mp3` 备用编码：每条音频同时带 `.ogg` 与 `.mp3`，
运行时按 `canPlayType` 只取其一（`src/assets/source.ts`），两份都要上传但从不同时下载。

改动之前这里是 175 MB 部署产物、83.4 MB 首屏一次性预载。

`src/assets/shipped-assets.test.ts` 守住这张表的下限：源码里每一条资源引用都必须有对应产物，
manifest 每一项都要指向真实文件、字节数一致、分级合法，且进首页要等的两级不超过 2 MB。

---

## 8. 仍然缺的素材

| 路径 | 尺寸 | 说明 |
|------|------|------|
| `art-src/art/cards/icon-C-01.png` … `icon-C-21.png` | 128×128，透明 PNG（母版；产物自动转成 WebP） | 结算页三个卡槽现在复用 `art-src/placeholder/icons/icon_01.png` … `icon_19.png`（19 张服务 21 张卡；`icon_01`、`icon_19` 各复用了一次，见 `src/race/cards/pool.ts` 里每条卡定义的 `art.icon`）。补齐后把对应卡的 `art.icon` 改指到新路径。 |

卡面图标之外没有别的缺口：五档奖章、名牌、标题木牌、首页六块木牌与两张整屏背景都已定稿。
