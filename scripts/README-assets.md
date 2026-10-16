# Ponygogogo — 素材管线

## 1. 母版与运行时产物

```text
art-src/renders/                  整屏参考稿，不上线
art-src/art/、placeholder/        作者定稿素材、切片、字体与音频母版
        ↓ scripts/build-web-assets.py
public/assets/                   WebP、PNG 二维码、双编码音频、woff2、JSON、许可和 manifest
```

`art-src/` 是作者本地保存的母版，Git 忽略；`public/assets/` 是已提交的运行时产物，正常开发和部署直接使用，不重新出图。重新生成必须有对应母版及工具，不能用缺少母版的新检出来替代美术源。

依赖按脚本实际调用准备：Python 3、Pillow、NumPy，WebP 编码使用 cwebp，音频使用 ffmpeg，字体转换使用 uvx/fonttools，二维码脚本使用 Bun。`scripts/process-assets.py`、`postprocess-assets.py` 处理参考稿和占位切片；`prepare-art.py` 只处理 HUD/UI 切片及赛道背景，不生成首页或结算页的独立木牌/奖章。

## 2. 当前素材入口

| 素材 | 母版 / 处理入口 | 当前产物与使用者 |
| --- | --- | --- |
| 40 张卡图 | 生成源 `art-src/art/cards/_generated/card-N.png` → `scripts/prepare-card-art.py` → 母版 `art-src/art/cards/card-N.png`（512×512） | `public/assets/art/cards/card-N.webp`（320×320），manifest 键 `art.cards.card-N`，race 级；Card、HUD、图鉴、结算与海报共用 |
| 九角色待机与跑步 | pony 母版，`prepare-pony-roster.py` 与 `prepare-pony-running.py` | `art/ponies/N-idle.webp`、`N-running.webp`；八帧 256×192，整图 2048×192 |
| 角色静态图 | `prepare-pony-roster.py`、`prepare-plaque-portraits.py` 等 | 头像、选马名牌、结算 hero 与海报 horse 各有专用图，按 ponyCatalog 的锚点注册 |
| 六张特效分镜 | `art/effects/*-sheet.png`；旋转突进由 prepare-spin-thrust.py/render-spin-thrust.ts 烘焙 | rocket、rainbow-trail、blackhole、fire-wheel、wind、spin-thrust；4×4、16 帧，race 级 |
| 头饰 | `prepare-head-cosmetics.py` | `art/cosmetics/blonde-hair.webp`、`green-hair.webp`，race 级 |
| 分享海报 | `prepare-share-art.py` | `art/share/` 背景、标题、奖项组、九角色立绘和二维码，result 级 |
| 二维码 | `art-src/QR code.png` → `prepare-share-qr.ts` | `art/share/qr.png` 去白底后保留 PNG，不转 WebP |
| 图鉴与获得窗口 | `art/collection/`、`art/collectibles/` | 图鉴底板/标签与获得卡片、按钮/纸屑；可按类别增量编码 |
| 音频 | `fetch-audio.sh`；来源见[音频说明](README-audio.md) | `placeholder/audio/`，按 source.ts 的 canPlayType 选择编码 |

`prepare-card-art.py` 要求 40 张来源均存在，透明 PNG 母版为 512×512，输出为 320×320 WebP；标记 preserveCanvas 的来源保持画布和像素，其他来源按 alpha 包围盒统一缩放注册。图标路径由 `src/race/cards/metadata.ts` 与 `iconUrl.ts` 定义。

全量 `build-web-assets.py` 不认识卡图的 320 目标：`display-sizes.json` 没有卡图键、卡图也不在 NO_DOWNSCALE 中，会按 512×512 母版重新编码，而 `shipped-assets.test.ts` 不校验尺寸。全量构建后须再运行 `prepare-card-art.py`。

//TODO - 让全量构建产出 320×320 卡图：把卡图目标尺寸纳入 `build-web-assets.py`（或尺寸表），并在 `src/assets/shipped-assets.test.ts` 断言 40 张卡图 WebP 均为 320×320。

跑步打包和动作验收见[跑步参考研究](../docs/_reaserch/pony-running-reference-validation.md)。技术尺寸和哈希通过不代表动作观感已经验收。

## 3. 出片与尺寸

`build-web-assets.py/ships()` 先排除 DEAD、下划线或点开头的路径，再执行类别白名单和中间产物过滤。整屏 renders 不出片；提示词、参考图、分镜母图、逐帧拆图与制作元数据不作为运行时素材。逐帧图仅 `-idle-0` 保留，供旋转突进制作输入与 shipped-assets 存在性检查；运行时头像使用独立头像或八帧分镜，海报使用专用立绘。

`art/effects/` 只出 `*-sheet.png`；`art/cosmetics/` 只出金色与绿色头饰。UI 仅出 UI_KEEP 匹配项。DEAD 中的旧背景、起跑整图等虽然可能保存在本地母版中，不进入部署。

普通图片目标为 `min(源图尺寸, 实测显示尺寸 × 2)`，只降不升。测量入口是 `scripts/measure-display-sizes.ts`，结果保存在 `scripts/display-sizes.json`，键不带扩展名，使 PNG 母版与 WebP 产物匹配。测量使用元素未经过舞台 transform 的盒子和背景尺寸；全量构建检查尺寸表至少 80% 的组与出片清单匹配。

以下素材属于 NO_DOWNSCALE：赛道循环贴图、八帧待机/跑步、idle-0、特效分镜及指定 border-image 木牌/羊皮纸。它们的切片或平铺规则依赖原始像素，改变尺寸必须同时修改消费者。

## 4. 编码与 manifest

- 位图使用 WebP，参数为 `-q 84 -m 6 -alpha_q 100 -sharp_yuv`；二维码例外保留 PNG。
- 字体转 woff2，OFL 许可随产物复制。
- 音频达到 200 KiB 时重编码：Ogg/Opus 80k、MP3 96k；更小的文件直接复制，不能由扩展名推定原始 Ogg 的编解码器。
- manifest 保存 kind、path、bytes、sha256 摘要、tier 与 deferred 标记；音频主条目可带 alt 编码。所有键与文件必须同步更新。

加载层级为 boot/home/race/result，按首次使用页面映射或 FALLBACK_TIER 分配；`art/collectibles/` 固定归入 result 级。应用先加载 boot，再阻塞加载 home，其余后台预取；选马、比赛、图鉴等通过资源门等 race，结算等 result。角色的 idle、running、idle-0、portrait、plaque-portrait 以及 `result/hero-N`、`share/horse-N` 标为 deferred，不随分级加载：比赛分镜由开赛前按本场名单 `loadKeys` 加载，其余由 img/CSS 直接请求。

## 5. 构建与验证

`measure-display-sizes.ts` 需要先在 5177 端口启动 Vite。

```bash
bun scripts/measure-display-sizes.ts
python3 scripts/build-web-assets.py
python3 scripts/check-asset-quality.py
bun test src/assets/shipped-assets.test.ts src/game/pony-assets.test.ts
```

只改一类时使用现有增量入口：

```bash
python3 scripts/prepare-card-art.py
python3 scripts/build-web-assets.py --pony 0 1 2 3 4 --running-only
python3 scripts/build-web-assets.py --collectibles
python3 scripts/build-web-assets.py --collection-ui
```

`--pony` 可选择 0–8；不加 running-only 时更新该角色的 idle/running/idle-0/portrait、result hero 和 share horse。增量构建要求完整旧 manifest 已存在且所选母版齐全，仅更新选中的产物。全量构建会清空并重建 `public/assets/`，执行前须确保本地母版完整。

`check-asset-quality.py` 对显示尺寸表中同时存在 PNG 母版和 WebP 的图片，在白底与深底合成后测 PSNR，取更差的一项，阈值 35 dB；缺少全部可比对素材时失败，缺少单项时跳过。因此它不能证明未进入尺寸表的图片质量，也不能替代动作/布局验收。

`shipped-assets.test.ts` 检查 40 张独立卡图、角色与特效资源、manifest 路径/字节/摘要/层级、源码引用及 boot+home 小于 2 MiB。部分需要本地母版的断言可能跳过，应单独报告。体积从本次 manifest 和目录计算，不固化旧母版或旧产物的大小。
