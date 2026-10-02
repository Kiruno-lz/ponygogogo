#!/usr/bin/env python3
"""
素材母版 → 可部署产物。

art-src/ 是唯一真源，public/assets/ 全部由本脚本生成，不要手改。
母版是作者出图与切片的完整产物（约 195MB，含参考图、分镜中间帧、废弃版本）；
上线只需要其中被代码引用的那一部分，且分辨率按实测显示尺寸重采样。

三条规则，每条都有必须成立的理由：

1. 出片清单（SHIP / DEAD）——母版里大半是中间产物，不进产物目录。
   DEAD 列的每一项都核对过零引用，理由逐条写在常量旁边。

2. 目标分辨率 = min(原图, 实测显示尺寸 × 2)，只降不升。
   显示尺寸由 scripts/measure-display-sizes.ts 在真实渲染里量出，不是估的。
   NO_DOWNSCALE 里的素材禁止降采样，缩小它们不是画质取舍而是功能回归。

3. 编码：位图 → WebP，字体 → woff2，音频原样。
   WebP 带 -sharp_yuv：这套美术是高饱和平涂 + 硬描边，默认的 YUV 下采样会让
   描边出现彩色毛边，sharp_yuv 按亮度加权算色度，正好治这个。

跑法（需要 cwebp 与 uv）：
    python3 scripts/build-web-assets.py
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art-src"
OUT = ROOT / "public" / "assets"
SIZES_FILE = ROOT / "scripts" / "display-sizes.json"

WEBP_QUALITY = 84
DISPLAY_MULTIPLIER = 2

# 音频母版是 141 kbps Vorbis，两条 BGM 各占一兆多，比全部首页美术加起来还大。
# 超过这个门槛的重编码，以下的原样拷贝——音效都是几 KB，重编码省不下容器开销。
AUDIO_REENCODE_MIN = 200 * 1024
OPUS_BITRATE = "80k"    # 游戏 BGM 压在音效之下，80k Opus 听感等同原始 141k Vorbis
MP3_BITRATE = "96k"     # 只给不支持 ogg 的旧 Safari 兜底，不必与 ogg 等质

# ---------------------------------------------------------------- 出片清单

# 母版里不进产物的目录与文件。每一项都实际核对过引用，括号里是判据。
DEAD: list[tuple[str, str]] = [
    ("placeholder/bg/", "整层背景已被 art/track/ 的原画切片取代，src 与 tests 里零引用"),
    ("placeholder/ui/start_gate.png", "起跑线改由 RaceScene 的 graphics 画，零引用"),
    ("placeholder/ui/btn_star.png", "theme.css:110 的 background 被 331 行同特异性规则覆盖，从不绘制"),
    ("placeholder/ui/card_frame.json", "矩形已内联进 src/cards/Card.tsx，文件只作为出处留在母版"),
    ("placeholder/audio/manifest.json", "fetch-audio.sh 的下载记录，不是运行时资源"),
    ("art/ponies/running-v3/", "未采用的跑步循环重做版，零引用"),
    ("art/ui/avatar-blank-trimmed.png", "被 avatar-reference-blank.png 取代，零引用"),
    ("art/ui/star-trimmed.png", "被 star-reference.png 取代，零引用"),
    ("art/ui/stamina-trimmed.png", "被 stamina-reference.png 取代，零引用"),
    ("art/ui/avatar-reference.png", "被 avatar-reference-blank.png 与 avatar-source.png 取代，零引用"),
]

# 母版里的中间产物：切片过程的产物、参考图、逐帧拆分，不上线。
INTERMEDIATE = re.compile(
    r"""
      storyboard                      # 角色分镜参考
    | /fidelity/                      # 保真度对照
    | -animated\.png$                 # APNG 预览，运行时用的是八帧横排
    | generation-prompts              # 出图提示词记录
    | animation-metadata              # 帧序元数据
    | -frameprep-metadata\.json$
    | -meta\.json$
    | wallet-reference                # 版位参考图
    | scene-(loop|bridge)             # 未采用的赛道构图
    | /ui-kit\.png$                   # 控件总图，实际用的是切片
    | /OFL-                           # 字体许可，单独拷
    """,
    re.VERBOSE,
)

# 逐帧拆分图只有 -idle-0 要上线：src/export/poster.ts:92 直接按这个名字取静帧画海报。
FRAME_SPLIT = re.compile(r"-(running|idle)-(\d+)\.png$")

# art/ui/ 是切片总目录，只有下面这些命名进产物，其余是切片中间态。
UI_KEEP = re.compile(
    r"""
      -trimmed\.png$
    | /bg-title\.png$
    | /(flag|leaderboard-avatar)-\d\.png$
    | /(star|avatar|stamina)-reference(-blank|-empty)?\.png$
    | /(avatar|star-race)-source\.png$
    | /star-gogo-face\.png$
    """,
    re.VERBOSE,
)

KIND_BY_EXT = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
    ".ogg": "audio", ".mp3": "audio",
    ".json": "json",
}
FONT_EXT = {".ttf", ".otf"}

# ------------------------------------------------------- 禁止降采样的素材

# 缩小这些图不是画质取舍，而是功能回归。逐条写明后果与出处。
NO_DOWNSCALE: list[tuple[str, str]] = [
    ("art/effects/", "4×4 特效分镜按 effects.ts 的帧尺寸切片，整图降采样会串帧"),
    ("art/track/far.png", "RaceScene.ts:75 tileSprite + setTileScale(1)，贴图宽度就是滚动循环周期，缩小会让远景重复频率翻倍"),
    ("art/track/track.png", "RaceScene.ts:86 同上，且五条白线的间距按原画像素注册"),
    ("art/track/front.png", "RaceScene.ts:119 同上"),
    ("-idle.png", "八帧横排分镜，pony.ts:7 硬编码 FRAME_W=256/FRAME_H=192，改尺寸即错帧"),
    ("-running.png", "同上"),
    ("-idle-0.png", "海报静帧，与分镜同源，保持一致"),
    ("placeholder/ui/btn_wood_1.png", "border-image 切片数值按源图像素计（theme.css:85 92/185/71/196），缩放源图必须同步改切片；当前采样率已是 2.4×"),
    ("placeholder/ui/btn_wood_2.png", "同上，theme.css:89"),
    ("placeholder/ui/btn_wood_3.png", "同上，theme.css:93"),
    ("placeholder/ui/panel_parchment.png", "同上，theme.css:129，当前采样率 1.8×，本就低于目标"),
]

# ----------------------------------------------------------------- 分级

# 加载分级：进首页只等 boot + home，其余在首页背景预取。
# 分界不是"按页面"而是"按阻塞点"：boot 是加载页自身，home 是首页，
# race 是首页之后到结算之前的一切（选马、比赛、选牌、图鉴、设置），result 是结算页。
# 图鉴和设置归到 race 而不是 home，是因为它们都在一次点击之外——
# 首页渲染完就开始预取，等玩家点进去时早已就绪，App 侧的 ensureTier 兜住极端情况。
# 归属由 scripts/measure-display-sizes.ts 实测的首次出现页面决定，下表只管兜底。
TIER_ORDER = ["boot", "home", "race", "result"]
SCREEN_TIER = {
    "loading": "boot",
    "home": "home",
    "collection": "race", "settings": "race",
    "select": "race", "select-bet": "race", "race": "race", "card-choice": "race",
    "canvas": "race",
    "result": "result",
}
FALLBACK_TIER = [
    ("art/result/", "result"),
    ("audio/jingle_", "result"),
    ("audio/sfx_result", "result"),
    ("audio/bgm_home", "home"),
    ("audio/sfx_ui_", "home"),
    ("placeholder/icons/", "race"),   # 卡面图标只在图鉴与选牌里出现
    ("placeholder/ui/", "home"),
    ("art/home/", "home"),
    ("audio/", "race"),
]


@dataclass
class Item:
    src: Path          # art-src 下的母版
    rel: str           # 产物相对 public/assets 的路径（已换扩展名）
    kind: str          # image / audio / json / font / license
    tier: str


def human(n: int) -> str:
    return f"{n / 1048576:.2f} MB" if n >= 1048576 else f"{n / 1024:.0f} KB"


def is_dead(rel: str) -> str | None:
    for pat, why in DEAD:
        if rel.startswith(pat) or rel == pat or (pat.endswith("/") and pat in rel):
            return why
    return None


def ships(rel: str) -> bool:
    """rel 是相对 art-src 的路径，如 art/ui/coin-trimmed.png"""
    if is_dead(rel):
        return False
    if any(part.startswith(("_", ".")) for part in Path(rel).parts):
        return False
    if rel.startswith("art/effects/"):
        return rel.endswith("-sheet.png")
    if rel.startswith("art/cosmetics/"):
        return rel in {"art/cosmetics/blonde-hair.png", "art/cosmetics/green-hair.png"}
    ext = Path(rel).suffix.lower()
    if ext in FONT_EXT:
        return True
    if rel.endswith("OFL-Knewave.txt") or rel.endswith("OFL-Kalam.txt"):
        return True   # 字体许可随字体分发是 OFL 的要求
    if ext not in KIND_BY_EXT:
        return False
    # 先排中间产物再谈逐帧：fidelity/ 下也有 -idle-0，顺序反了就会把对照图放上线
    if INTERMEDIATE.search(rel):
        return False
    m = FRAME_SPLIT.search(rel)
    if m:
        return m.group(2) == "0" and m.group(1) == "idle"
    if "/ui/" in rel and rel.startswith("art/"):
        return bool(UI_KEEP.search("/" + rel))
    return True


def no_downscale(rel: str) -> str | None:
    for pat, why in NO_DOWNSCALE:
        if rel.endswith(pat) or rel.startswith(pat):
            return why
    return None


def stem(rel: str) -> str:
    """去掉扩展名。显示尺寸是在已转码的应用上量的，母版却是 PNG；
    键里留着扩展名，两边永远对不上，而且对不上时表现是「悄悄不降采样」，不报错。"""
    return rel.rsplit(".", 1)[0]


def group_key(rel: str) -> str:
    """把同角色的一组素材归一：medal-4 与 medal-1、0-portrait 与 3-portrait 用同一个显示尺寸。
    结算页一次只画一枚奖牌，实测量不到兄弟项，但它们占同一个版位。"""
    p = Path(rel)
    return str(p.parent / re.sub(r"\d+", "#", p.name))


def main() -> int:
    if not SRC.is_dir():
        print(f"找不到素材母版目录 {SRC}", file=sys.stderr)
        return 1
    for tool, hint in (("cwebp", "brew install webp"), ("ffmpeg", "brew install ffmpeg"), ("uvx", "见 https://docs.astral.sh/uv/")):
        if shutil.which(tool) is None:
            print(f"缺少 {tool}：{hint}", file=sys.stderr)
            return 1

    raw = json.loads(SIZES_FILE.read_text())
    # 实测表的 key 是不带扩展名的运行时路径 /assets/art/...，换算成相对母版根的路径。
    # 不带扩展名是刻意的：测量跑在 WebP 产物上，这里查的却是 PNG 母版。
    measured: dict[str, tuple[int, int]] = {}
    seen_at: dict[str, list[str]] = {}
    for url, wh in raw["sizes"].items():
        rel = url.removeprefix("/assets/")
        measured[rel] = tuple(wh)
        seen_at[rel] = raw["seenAt"].get(url, [])

    # 同组共享显示尺寸，取组内最大
    by_group: dict[str, tuple[int, int]] = {}
    for rel, (w, h) in measured.items():
        if w == 0:
            continue
        g = group_key(stem(rel))
        prev = by_group.get(g, (0, 0))
        by_group[g] = (max(prev[0], w), max(prev[1], h))

    group_tier: dict[str, str] = {}
    for rel, screens in seen_at.items():
        tiers = [SCREEN_TIER[s] for s in screens if s in SCREEN_TIER]
        if not tiers:
            continue
        t = min(tiers, key=TIER_ORDER.index)
        g = group_key(stem(rel))
        cur = group_tier.get(g)
        group_tier[g] = t if cur is None else min([cur, t], key=TIER_ORDER.index)

    def tier_of(rel: str) -> str:
        g = group_key(stem(rel))
        if g in group_tier:
            return group_tier[g]
        for pat, t in FALLBACK_TIER:
            if pat in rel:
                return t
        return "race"

    items: list[Item] = []
    skipped_dead: list[tuple[str, str]] = []
    for path in sorted(SRC.rglob("*")):
        if not path.is_file():
            continue
        rel = str(path.relative_to(SRC))
        if rel.startswith("renders/"):
            continue   # 作者整屏出图，只作参考，永不上线
        why = is_dead(rel)
        if why:
            skipped_dead.append((rel, why))
            continue
        if not ships(rel):
            continue
        ext = path.suffix.lower()
        if ext in FONT_EXT:
            items.append(Item(path, rel.replace(ext, ".woff2"), "font", "home"))
        elif ext == ".txt":
            items.append(Item(path, rel, "license", "home"))
        elif KIND_BY_EXT[ext] == "image":
            items.append(Item(path, str(Path(rel).with_suffix(".webp")), "image", tier_of(rel)))
        else:
            items.append(Item(path, rel, KIND_BY_EXT[ext], tier_of(rel)))

    # 显示尺寸表与出片清单必须真的对得上。对不上时管线不会报错，只会安静地
    # 一张都不降采样、产物悄悄变大——所以在这里把它变成一次响亮的失败。
    shipped_groups = {group_key(stem(str(it.src.relative_to(SRC)))) for it in items if it.kind == "image"}
    both = shipped_groups & set(by_group)
    if by_group and len(both) < len(by_group) * 0.8:
        print(
            f"显示尺寸表里只有 {len(both)}/{len(by_group)} 组能对上出片清单。"
            f"多半是键的格式变了（扩展名、目录层级），或者 display-sizes.json 过期。\n"
            f"跑 bun scripts/measure-display-sizes.ts 重新测量。",
            file=sys.stderr,
        )
        return 1

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    manifest: dict[str, dict] = {}
    src_bytes = out_bytes = 0
    resized = 0
    for it in items:
        dst = OUT / it.rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        src_bytes += it.src.stat().st_size

        if it.kind == "image":
            target = target_size(it.src, str(it.src.relative_to(SRC)), by_group)
            if target is not None:
                resized += 1
            encode_webp(it.src, dst, target)
        elif it.kind == "font":
            encode_woff2(it.src, dst)
        elif it.kind == "audio" and it.src.stat().st_size >= AUDIO_REENCODE_MIN:
            encode_audio(it.src, dst)
        else:
            shutil.copy2(it.src, dst)
        out_bytes += dst.stat().st_size

        if it.kind in ("image", "audio", "json"):
            key = str(Path(it.rel).with_suffix("")).replace("/", ".")
            if it.rel.startswith("placeholder/"):
                key = key[len("placeholder."):]
            data = dst.read_bytes()
            entry = {
                "kind": it.kind,
                "path": "assets/" + it.rel,
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest()[:16],
                "tier": it.tier,
            }
            if it.rel.endswith(".mp3"):
                ogg_key = key
                if ogg_key in manifest:
                    manifest[ogg_key]["alt"] = "assets/" + it.rel
                    continue
            manifest[key] = {**manifest.get(key, {}), **entry}
            if it.rel.endswith(".ogg"):
                mp3 = it.src.with_suffix(".mp3")
                if mp3.exists():
                    manifest[key]["alt"] = "assets/" + it.rel[:-4] + ".mp3"

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    by_tier: dict[str, int] = {}
    for e in manifest.values():
        by_tier[e["tier"]] = by_tier.get(e["tier"], 0) + e["bytes"]
    total = OUT.stat().st_size + sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())

    print(f"出片的 {len(shipped_groups)} 组图里，{len(both)} 组有实测显示尺寸")
    print(f"母版 {len(items)} 项 {human(src_bytes)} → 产物 {human(out_bytes)}"
          f"（{src_bytes / max(out_bytes, 1):.1f}×，其中 {resized} 张降采样）")
    print(f"剔除中间产物与死素材 {len(skipped_dead)} 项")
    print(f"manifest {len(manifest)} 项，分级体积：")
    for t in TIER_ORDER:
        if t in by_tier:
            print(f"  {t:<7} {human(by_tier[t])}")
    print(f"进首页需要 {human(by_tier.get('boot', 0) + by_tier.get('home', 0))}，"
          f"其余 {human(sum(v for k, v in by_tier.items() if k in ('race', 'result')))} 后台预取")
    return 0


def target_size(src: Path, rel: str, by_group: dict[str, tuple[int, int]]) -> tuple[int, int] | None:
    """返回重采样目标；None 表示按原分辨率编码"""
    if no_downscale(rel):
        return None
    disp = by_group.get(group_key(stem(rel)))
    if not disp:
        return None     # 没量到就不降，宁可多几十 KB 也不赌一张糊图
    with Image.open(src) as im:
        ow, oh = im.size
    scale = min(1.0, max(disp[0] * DISPLAY_MULTIPLIER / ow, disp[1] * DISPLAY_MULTIPLIER / oh))
    if scale >= 0.999:
        return None
    return max(1, round(ow * scale)), max(1, round(oh * scale))


def encode_webp(src: Path, dst: Path, target: tuple[int, int] | None) -> None:
    tmp = None
    source = src
    if target is not None:
        # PIL 的 LANCZOS 比 cwebp 内置的降采样锐利，代价是多一次落盘
        with Image.open(src) as im:
            im = im.convert("RGBA") if im.mode in ("P", "LA") else im
            tmp = dst.with_suffix(".tmp.png")
            im.resize(target, Image.Resampling.LANCZOS).save(tmp)
        source = tmp
    cmd = ["cwebp", "-quiet", "-q", str(WEBP_QUALITY), "-m", "6", "-sharp_yuv", "-mt",
           "-alpha_q", "100", str(source), "-o", str(dst)]
    subprocess.run(cmd, check=True)
    if tmp is not None:
        tmp.unlink()


def encode_audio(src: Path, dst: Path) -> None:
    if src.suffix.lower() == ".ogg":
        codec = ["-c:a", "libopus", "-b:a", OPUS_BITRATE, "-vbr", "on", "-application", "audio"]
    else:
        codec = ["-c:a", "libmp3lame", "-b:a", MP3_BITRATE]
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), *codec, str(dst)],
        check=True,
    )


def encode_woff2(src: Path, dst: Path) -> None:
    subprocess.run(
        ["uvx", "--quiet", "--from", "fonttools[woff]", "fonttools", "ttLib.woff2",
         "compress", "-o", str(dst), str(src)],
        check=True, stdout=subprocess.DEVNULL,
    )


if __name__ == "__main__":
    raise SystemExit(main())
