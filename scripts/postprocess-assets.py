#!/usr/bin/env python3
"""
背景分层的二次裁切。

art-src/renders/race_gaming.png 是一张带 HUD 的完整界面渲染图：左上的玩家头像牌与体力条、
右侧的名次榜、右下的 GOGOGO 星形按钮都画在图里。直接按 y 切出来的背景层会把这些
UI 一起带进场景，形成"画面里有两套 HUD"。

因此每一层都只取一段**横向不含 UI** 的干净区间，再做镜像拼接得到可无缝平铺的贴图。
输出文件独立命名（*_clean），不覆盖 process-assets.py 的产物。
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art-src" / "renders" / "race_gaming.png"
OUT = ROOT / "public" / "assets" / "placeholder" / "bg"

# (输出名, y 区间, 干净的 x 区间)
# 干净区间的依据：
#   HUD 头像牌 + 体力条 + 状态图标   x 40..700,    y 20..200
#   名次榜面板                      x 1270..1600, y 88..512
#   GOGOGO 星形按钮                 x 1225..1600, y 600..880
LAYERS = [
    ("far_clean.png", (0, 268), (700, 1265)),
    ("fence_clean.png", (250, 348), (0, 1265)),
    # 起点 762 而不是 748：原图里玩家小马脚下的金色光环顶端正好压在 748 上
    ("front_clean.png", (762, 953), (0, 1215)),
]


def mirror_tile(img: Image.Image) -> Image.Image:
    """[原图 | 水平翻转] 拼接，左右边界天然对齐，可无缝循环"""
    w, h = img.size
    out = Image.new(img.mode, (w * 2, h))
    out.paste(img, (0, 0))
    out.paste(img.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    return out


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"缺少源渲染图：{SRC}")
    OUT.mkdir(parents=True, exist_ok=True)
    src = Image.open(SRC).convert("RGB")
    for name, (y0, y1), (x0, x1) in LAYERS:
        band = src.crop((x0, y0, x1, y1))
        tile = mirror_tile(band)
        tile.save(OUT / name)
        print(f"{name}: {tile.size}  <- x[{x0},{x1}) y[{y0},{y1})")


if __name__ == "__main__":
    main()
