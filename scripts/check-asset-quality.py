#!/usr/bin/env python3
"""
产物画质核验：把产物与母版各自缩到实测显示尺寸，合成到实底后比 PSNR。

为什么要合成到实底：全透明像素的 RGB 是无意义值，WebP 会把它们清零，
直接比 RGBA 裸通道会得到 9 dB 这种吓人但毫无意义的数字。玩家看到的是合成结果，
所以比的也应该是合成结果。白底与深底各算一次取更差的那个，避免某种底色掩盖描边问题。

判据：没有一张低于 35 dB。低于即说明 WEBP_QUALITY 调过头或某张图降采样过度，
回查 scripts/build-web-assets.py 的常量，不要放宽这里的阈值。

跑法：python3 scripts/check-asset-quality.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FLOOR_DB = 35.0
BACKDROPS = ((255, 255, 255, 255), (24, 18, 12, 255))


def composited(path: Path, size: tuple[int, int], bg: tuple[int, int, int, int]) -> np.ndarray:
    im = Image.open(path).convert("RGBA").resize(size, Image.Resampling.LANCZOS)
    return np.asarray(Image.alpha_composite(Image.new("RGBA", size, bg), im).convert("RGB"), dtype=np.float64)


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = ((a - b) ** 2).mean()
    return 99.0 if mse < 1e-9 else 10 * math.log10(255 * 255 / mse)


def main() -> int:
    sizes = json.loads((ROOT / "scripts" / "display-sizes.json").read_text())["sizes"]
    rows: list[tuple[float, str]] = []
    for url, (w, h) in sizes.items():
        # 尺寸表的键不带扩展名（它要同时对上 PNG 母版与 WebP 产物）
        rel = url[len("/assets/"):]
        src = ROOT / "art-src" / (rel + ".png")
        out = ROOT / "public" / "assets" / (rel + ".webp")
        if not src.exists() or not out.exists():
            continue
        if w == 0:
            with Image.open(src) as im:
                w, h = im.size
        worst = min(psnr(composited(src, (w, h), bg), composited(out, (w, h), bg)) for bg in BACKDROPS)
        rows.append((worst, rel))

    if not rows:
        print("没有可比对的素材：母版或产物缺失", file=sys.stderr)
        return 1

    rows.sort()
    median = rows[len(rows) // 2][0]
    print(f"{len(rows)} 张，中位 {median:.1f} dB，最低 {rows[0][0]:.1f} dB")
    print("最差的五张：")
    for p, rel in rows[:5]:
        print(f"  {p:5.1f} dB  {rel}")

    below = [(p, rel) for p, rel in rows if p < FLOOR_DB]
    if below:
        print(f"\n{len(below)} 张低于 {FLOOR_DB} dB：", file=sys.stderr)
        for p, rel in below:
            print(f"  {p:5.1f} dB  {rel}", file=sys.stderr)
        return 1
    print(f"\n全部高于 {FLOOR_DB} dB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
