#!/usr/bin/env python3
"""
Ponygogogo — Asset Processing Script
Run: python3 scripts/process-assets.py
Idempotent: re-running produces identical output.

Inputs:  art-src/renders/card_icon.png, art-src/renders/card_normal.png, art-src/renders/card_rare.png
         art-src/renders/race_gaming.png, art-src/renders/race_start.png, art-src/renders/tittle.png
Outputs: art-src/placeholder/icons/**, bg/**, ui/**
"""

import json
import math
import os
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE   = Path(__file__).resolve().parent.parent
ASSRT  = BASE / "art-src" / "renders"
ICONS  = BASE / "art-src/placeholder/icons"
BG     = BASE / "art-src/placeholder/bg"
UI     = BASE / "art-src/placeholder/ui"

for d in (ICONS, BG, UI):
    d.mkdir(parents=True, exist_ok=True)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def alpha_bbox(arr, thr: int = 10):
    """Bounding box of non-transparent pixels. Returns (x0,y0,x1,y1) inclusive."""
    mask = arr[:, :, 3] > thr
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any():
        return 0, 0, arr.shape[1] - 1, arr.shape[0] - 1
    r0 = int(np.argmax(rows))
    r1 = int(arr.shape[0] - np.argmax(rows[::-1]) - 1)
    c0 = int(np.argmax(cols))
    c1 = int(arr.shape[1] - np.argmax(cols[::-1]) - 1)
    return c0, r0, c1, r1


def content_bbox(arr, thr: int = 10):
    """Return cropped array and (x0,y0,x1,y1) bbox."""
    x0, y0, x1, y1 = alpha_bbox(arr, thr)
    return arr[y0: y1 + 1, x0: x1 + 1], (x0, y0, x1, y1)


def sample_median(arr_rgb, x: int, y: int, r: int = 8) -> str:
    """Return '#rrggbb' median colour from a square neighbourhood."""
    h, w = arr_rgb.shape[:2]
    patch = arr_rgb[max(0, y - r): min(h, y + r + 1),
                    max(0, x - r): min(w, x + r + 1)]
    rgb = [int(np.median(patch[:, :, c])) for c in range(3)]
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def remove_white(arr_rgb, thr: int = 244) -> np.ndarray:
    """White → transparent; return RGBA uint8 array."""
    out = np.zeros((*arr_rgb.shape[:2], 4), dtype=np.uint8)
    out[:, :, :3] = arr_rgb[:, :, :3]
    out[:, :, 3]  = 255
    is_white = (
        (out[:, :, 0].astype(int) > thr) &
        (out[:, :, 1].astype(int) > thr) &
        (out[:, :, 2].astype(int) > thr)
    )
    out[is_white, 3] = 0
    return out


def median_color_of_mask(rgba: np.ndarray, mask: np.ndarray) -> tuple:
    """Return (r,g,b) median of pixels where mask is True."""
    pixels = rgba[mask, :3]
    if len(pixels) == 0:
        return (200, 160, 100)
    return tuple(int(np.median(pixels[:, c])) for c in range(3))


def fill_region(rgba: np.ndarray, y0: int, y1: int, x0: int, x1: int,
                color: tuple, only_opaque: bool = True) -> None:
    """Fill rectangle with solid color in-place."""
    zone = rgba[y0:y1, x0:x1]
    if only_opaque:
        has_alpha = zone[:, :, 3] > 50
        zone[has_alpha, 0] = color[0]
        zone[has_alpha, 1] = color[1]
        zone[has_alpha, 2] = color[2]
        zone[has_alpha, 3] = 255
    else:
        zone[:, :, 0] = color[0]
        zone[:, :, 1] = color[1]
        zone[:, :, 2] = color[2]
        zone[:, :, 3] = 255
    rgba[y0:y1, x0:x1] = zone


def make_mask_rgba(arr_rgb: np.ndarray, keep_mask: np.ndarray) -> np.ndarray:
    """Build RGBA array; keep_mask pixels = opaque, others = transparent."""
    out = np.zeros((*arr_rgb.shape[:2], 4), dtype=np.uint8)
    out[:, :, :3] = arr_rgb[:, :, :3]
    out[:, :, 3]  = np.where(keep_mask, 255, 0).astype(np.uint8)
    return out


def morph_close(mask: np.ndarray, radius: int = 3) -> np.ndarray:
    """Simple 2-D binary closing using rectangular kernel (no scipy needed)."""
    from PIL import Image as _I, ImageFilter as _IF
    pil = _I.fromarray(mask.astype(np.uint8) * 255, mode='L')
    dilated = pil.filter(_IF.MaxFilter(size=radius * 2 + 1))
    eroded  = dilated.filter(_IF.MinFilter(size=radius * 2 + 1))
    return np.array(eroded) > 127


# ─── PRODUCT 1 — Card Icons ───────────────────────────────────────────────────

def _detect_icon_bboxes(arr: np.ndarray) -> list:
    """
    Detect the 19 icon bounding boxes from card_icon.png using
    row-band + column-blob projection.  Returns list of (x0,y0,x1,y1) tuples
    in row-major order, length exactly 19.
    """
    H, W = arr.shape[:2]

    # Near-black → mark as transparent for projection
    max_rgb = np.maximum(
        np.maximum(arr[:, :, 0].astype(int), arr[:, :, 1].astype(int)),
        arr[:, :, 2].astype(int)
    )
    mask = (arr[:, :, 3] > 10) & (max_rgb >= 28)

    # --- Find horizontal row bands ---
    ROW_THR = 100         # min non-transparent cols to count as content row
    row_sums = mask.sum(axis=1)
    in_band, bands, bs = False, [], 0
    for y in range(H):
        if row_sums[y] > ROW_THR and not in_band:
            in_band, bs = True, y
        elif row_sums[y] <= ROW_THR and in_band:
            in_band = False
            bands.append((bs, y - 1))
    if in_band:
        bands.append((bs, H - 1))

    # --- Within each band find column blobs (gap ≥ 20 px to split) ---
    GAP_MIN = 20
    COL_THR = 5           # min non-transparent rows in column
    bboxes = []
    for by0, by1 in bands:
        band = mask[by0: by1 + 1, :]
        col_sums = band.sum(axis=0)
        col_has  = col_sums > COL_THR
        in_blob, blob_x0 = False, 0
        blobs = []
        x = 0
        while x < W:
            if col_has[x] and not in_blob:
                in_blob, blob_x0 = True, x
            elif not col_has[x] and in_blob:
                # Measure gap length
                gap_start = x
                while x < W and not col_has[x]:
                    x += 1
                if (x - gap_start) >= GAP_MIN:
                    blobs.append((blob_x0, gap_start - 1))
                    in_blob = False
                    continue         # x already advanced
            x += 1
        if in_blob:
            blobs.append((blob_x0, W - 1))

        for bx0, bx1 in blobs:
            sub   = mask[by0: by1 + 1, bx0: bx1 + 1]
            rows_w = np.any(sub, axis=1)
            ry0 = by0 + int(np.argmax(rows_w))
            ry1 = by0 + int(len(rows_w) - np.argmax(rows_w[::-1]) - 1)
            bboxes.append((bx0, ry0, bx1, ry1))

    if len(bboxes) != 19:
        raise RuntimeError(
            f"Expected 19 icon bboxes, detected {len(bboxes)}. "
            "Adjust GAP_MIN / COL_THR thresholds."
        )
    return bboxes


def process_icons():
    print("\n[icons] Processing card icons…")
    img  = Image.open(ASSRT / "card_icon.png").convert("RGBA")
    arr  = np.array(img)
    H, W = arr.shape[:2]

    # Detect actual icon bboxes (handles non-uniform last row)
    bboxes = _detect_icon_bboxes(arr)

    # Near-black → transparent globally
    max_rgb = np.maximum(
        np.maximum(arr[:, :, 0].astype(int), arr[:, :, 1].astype(int)),
        arr[:, :, 2].astype(int)
    )
    arr_clean = arr.copy()
    arr_clean[max_rgb < 28, 3] = 0

    icons = []
    for idx, (bx0, by0, bx1, by1) in enumerate(bboxes):
        cell = arr_clean[by0: by1 + 1, bx0: bx1 + 1].copy()

        # Crop to tight bbox of non-transparent pixels
        mask = cell[:, :, 3] > 10
        if not mask.any():
            continue
        rows_has = np.any(mask, axis=1)
        cols_has = np.any(mask, axis=0)
        r0 = int(np.argmax(rows_has));  r1 = int(cell.shape[0] - np.argmax(rows_has[::-1]) - 1)
        c0 = int(np.argmax(cols_has));  c1 = int(cell.shape[1] - np.argmax(cols_has[::-1]) - 1)
        content = cell[r0: r1 + 1, c0: c1 + 1]

        # Pad to square
        ch, cw = content.shape[:2]
        side   = max(ch, cw)
        padded = np.zeros((side, side, 4), dtype=np.uint8)
        py, px = (side - ch) // 2, (side - cw) // 2
        padded[py: py + ch, px: px + cw] = content

        # Resize to 256 × 256
        icon = Image.fromarray(padded).resize((256, 256), Image.LANCZOS)
        out_path = ICONS / f"icon_{idx + 1:02d}.png"
        icon.save(out_path)
        icons.append((idx + 1, icon))
        print(f"  icon_{idx + 1:02d}.png  bbox=({bx0},{by0},{bx1},{by1})  "
              f"content={cw}×{ch}→{side}px sq")

    # Contact sheet — 5 columns
    S, M, LH = 256, 6, 18
    NCOLS = 5
    NROWS = math.ceil(len(icons) / NCOLS)
    sw = NCOLS * (S + M) + M
    sh = NROWS * (S + LH + M) + M
    sheet = Image.new("RGBA", (sw, sh), (28, 25, 22, 255))
    draw  = ImageDraw.Draw(sheet)
    for i, (num, ic) in enumerate(icons):
        col, row = i % NCOLS, i // NCOLS
        x = M + col * (S + M)
        y = M + row * (S + LH + M)
        sheet.paste(ic, (x, y), ic)
        draw.text((x + 4, y + S + 2), f"{num:02d}", fill=(255, 240, 120, 255))
    sheet.save(ICONS / "_contact_sheet.png")
    print(f"  _contact_sheet.png  ({sw}×{sh})")
    print(f"[icons] Done — {len(icons)} icons")


# ─── PRODUCT 2 — Card Frames ─────────────────────────────────────────────────

def _measure_frame_rects(rarr: np.ndarray) -> tuple:
    """
    Given a resized (h=900) card frame RGBA array, return
    (artRect, ribbonRect) each as [x, y, w, h] in pixel coords.

    Strategy:
      artRect  = inner parchment usable area (under top frame, above ribbon)
      ribbonRect = the scroll banner at the bottom
    """
    rh, rw = rarr.shape[:2]
    mid_x  = rw // 2

    PARCH_THR = (205, 170, 125)  # R,G,B minimums for parchment (cream)

    def is_parch_row(y, x=mid_x, w=10):
        """True if at least half of a small window is parchment-coloured."""
        window = rarr[y, max(0, x - w): x + w + 1]
        p_count = np.sum(
            (window[:, 0] > PARCH_THR[0]) &
            (window[:, 1] > PARCH_THR[1]) &
            (window[:, 2] > PARCH_THR[2]) &
            (window[:, 3] > 80)
        )
        return p_count > w

    # --- artRect top: first parchment row at center x ---
    art_top = 0
    for y in range(rh):
        if is_parch_row(y):
            art_top = y
            break

    # --- Find typical parchment x-extents (at 40% height = well inside art area) ---
    mid_y    = int(0.40 * rh)
    row_mid  = rarr[mid_y, :]
    parch_x  = (
        (row_mid[:, 0] > PARCH_THR[0]) &
        (row_mid[:, 1] > PARCH_THR[1]) &
        (row_mid[:, 2] > PARCH_THR[2]) &
        (row_mid[:, 3] > 80)
    )
    if parch_x.any():
        art_x0 = int(np.argmax(parch_x))
        art_x1 = int(rw - np.argmax(parch_x[::-1]) - 1)
    else:
        art_x0, art_x1 = 0, rw
    art_width_ref = art_x1 - art_x0

    # --- Find where ribbon starts: parchment suddenly extends wider than art area ---
    ribbon_top = int(0.80 * rh)          # default fallback
    for y in range(int(0.65 * rh), rh):
        row = rarr[y, :]
        p   = (
            (row[:, 0] > PARCH_THR[0]) &
            (row[:, 1] > PARCH_THR[1]) &
            (row[:, 2] > PARCH_THR[2]) &
            (row[:, 3] > 50)
        )
        if not p.any():
            continue
        cols = np.where(p)[0]
        row_w = int(cols[-1]) - int(cols[0])
        if row_w > art_width_ref + 80:    # ribbon protrudes significantly
            ribbon_top = y
            break

    # artRect bottom = just before ribbon
    art_bot = ribbon_top - 4

    # --- ribbonRect bottom: last parchment row at center x ---
    ribbon_bot = ribbon_top
    for y in range(rh - 1, ribbon_top, -1):
        if is_parch_row(y):
            ribbon_bot = y
            break

    # --- ribbonRect x-extents (at mid-ribbon height) ---
    mid_rib = (ribbon_top + ribbon_bot) // 2
    if mid_rib >= rh:
        mid_rib = rh - 1
    row_rib = rarr[mid_rib, :]
    pr = (row_rib[:, 0] > PARCH_THR[0]) & (row_rib[:, 3] > 50)
    if pr.any():
        cols = np.where(pr)[0]
        rib_x0, rib_x1 = int(cols[0]), int(cols[-1])
    else:
        rib_x0, rib_x1 = art_x0, art_x1

    art_rect    = [art_x0,  art_top,  art_x1 - art_x0,  art_bot - art_top]
    ribbon_rect = [rib_x0, ribbon_top, rib_x1 - rib_x0, ribbon_bot - ribbon_top]
    return art_rect, ribbon_rect


def process_frames():
    print("\n[frames] Processing card frames…")
    frame_json = {}

    specs = [
        ("common", "card_normal.png", "card_frame_common.png"),
        ("rare",   "card_rare.png",   "card_frame_rare.png"),
    ]
    for key, src, dst in specs:
        img = Image.open(ASSRT / src).convert("RGBA")
        arr = np.array(img)

        # Crop to alpha content bbox (already transparent bg)
        x0, y0, x1, y1 = alpha_bbox(arr, thr=10)
        cropped = arr[y0: y1 + 1, x0: x1 + 1]
        ch, cw  = cropped.shape[:2]

        # Resize to height = 900 px
        target_h = 900
        scale    = target_h / ch
        new_w    = round(cw * scale)
        resized  = Image.fromarray(cropped).resize((new_w, target_h), Image.LANCZOS)
        resized.save(UI / dst)

        rarr = np.array(resized)
        art_rect, ribbon_rect = _measure_frame_rects(rarr)
        frame_json[key] = {
            "w": new_w, "h": target_h,
            "artRect":    art_rect,
            "ribbonRect": ribbon_rect,
        }
        print(f"  {dst}  {new_w}×{target_h}")
        print(f"    artRect    = {art_rect}")
        print(f"    ribbonRect = {ribbon_rect}")

    (UI / "card_frame.json").write_text(json.dumps(frame_json, indent=2))
    print(f"  card_frame.json saved")
    print("[frames] Done")
    return frame_json


# ─── PRODUCT 3 — Background Layers ───────────────────────────────────────────

def process_backgrounds():
    print("\n[bg] Processing background layers…")
    img  = Image.open(ASSRT / "race_gaming.png").convert("RGB")
    arr  = np.array(img)
    H, W = arr.shape[:2]   # 1619 × 971

    def save_crop(y0, y1, name, rgb=True):
        layer = Image.fromarray(arr[y0:y1, :])
        layer.save(BG / name)
        return layer

    def make_tile(layer, name):
        """Horizontal mirror tile: [original | flipped]."""
        flipped = layer.transpose(Image.FLIP_LEFT_RIGHT)
        w, h    = layer.size
        tiled   = Image.new(layer.mode, (w * 2, h))
        tiled.paste(layer,   (0, 0))
        tiled.paste(flipped, (w, 0))
        tiled.save(BG / name)
        return tiled

    # Layer 1: far background (sky / castle / mountains / pine / stands)
    far   = save_crop(0, 268, "layer_far.png")
    print(f"  layer_far.png       {W}×268")

    # Layer 2: mid fence + signboards
    fence = save_crop(250, 348, "layer_fence.png")
    make_tile(fence, "layer_fence_tile.png")
    print(f"  layer_fence.png     {W}×98   (tile: {W*2}×98)")

    # Layer 3: foreground fence + audience silhouettes
    front_h = H - 748
    front   = save_crop(748, H, "layer_front.png")
    make_tile(front, "layer_front_tile.png")
    print(f"  layer_front.png     {W}×{front_h}  (tile: {W*2}×{front_h})")

    # Track dirt: clean patch — track-5 right side, clear of horses and scoreboard.
    # Horses at x≈400–900; scoreboard x>1275; lane markers at y=460 area.
    # x=950–1206 (256 px), y=680–744 (64 px) — tested clean, no markers/horses.
    dx0, dy0 = 950, 680
    patch      = arr[dy0: dy0 + 64, dx0: dx0 + 256]
    dirt       = Image.fromarray(patch)
    dirt_flip  = dirt.transpose(Image.FLIP_LEFT_RIGHT)
    dirt_tile  = Image.new("RGB", (512, 64))
    dirt_tile.paste(dirt,      (0,   0))
    dirt_tile.paste(dirt_flip, (256, 0))
    dirt_tile.save(BG / "track_dirt.png")
    print(f"  track_dirt.png      512×64  (sampled from x={dx0}..{dx0+256}, y={dy0}..{dy0+64})")

    print("[bg] Done")
    return arr, H, W


# ─── PRODUCT 5 — Palette ─────────────────────────────────────────────────────

def process_palette(gaming_arr: np.ndarray) -> dict:
    print("\n[palette] Sampling colours…")
    g = gaming_arr
    H, W = g.shape[:2]

    palette = {
        # Dirt — main track surface, right side clear of horses (x=1000, y=490)
        "dirt":      sample_median(g, 1000, 490, 12),
        # DirtDark — darker track shadow/worn area (x=1000, y=440, small radius)
        "dirtDark":  sample_median(g, 1000, 440,  4),
        # LaneLine — lighter inter-lane divider (x=600, y=452, tight sample)
        "laneLine":  sample_median(g,  600, 452,  3),
        # Grass — pine-tree / grass zone in far background (x=400, y=150)
        "grass":     sample_median(g, 400,  150, 10),
        # Sky — open sky above far background (x=550, y=5)
        "sky":       sample_median(g, 550,    5, 15),
        # Wood — fence rail (x=300, y=285)
        "wood":      sample_median(g, 300,  285, 10),
        # WoodDark — fence post shadow (x=180, y=283)
        "woodDark":  sample_median(g, 180,  283, 5),
        # Parchment — scoreboard interior (x=1440, y=300)
        "parchment": sample_median(g, 1440, 300, 20),
        # Gold — lightning bolt / crown icon at top-left card area (x=135, y=63)
        "gold":      sample_median(g,  135,  63, 6),
        # Ink — dark text on parchment panel (x=1360, y=210)
        "ink":       sample_median(g, 1360, 210, 4),
    }

    (BG / "palette.json").write_text(json.dumps(palette, indent=2))
    for k, v in palette.items():
        print(f"  {k:12s} {v}")
    print("[palette] Done")
    return palette


# ─── PRODUCT 4 — UI Assets ───────────────────────────────────────────────────

def process_ui(gaming_arr: np.ndarray) -> None:
    print("\n[ui] Processing UI assets…")

    # ── Start Gate ────────────────────────────────────────────────────────────
    start_arr = np.array(Image.open(ASSRT / "race_start.png").convert("RGB"))
    HS, WS    = start_arr.shape[:2]   # 1619 × 971

    # Gate structure: wooden arch + RACE sign + numbered flags + 5 ponies
    # y=175..790, x=150..1140  (adjust checked visually)
    gate = start_arr[175:790, 150:1140]
    Image.fromarray(gate).save(UI / "start_gate.png")
    print(f"  start_gate.png      {gate.shape[1]}×{gate.shape[0]}")

    # ── Logo (Ponygogogo title) from tittle.png ───────────────────────────────
    title_arr = np.array(Image.open(ASSRT / "tittle.png").convert("RGB"))
    HT, WT    = title_arr.shape[:2]

    if not (UI / "logo_title.png").exists():
        logo_rgba = remove_white(title_arr, thr=244)
        # Logo lives in the top content band (y=0..465)
        logo_crop = logo_rgba[:465, :]
        lx0, ly0, lx1, ly1 = alpha_bbox(logo_crop)
        logo_final = logo_crop[ly0: ly1 + 1, lx0: lx1 + 1]
        Image.fromarray(logo_final).save(UI / "logo_title.png")
        print(f"  logo_title.png      {logo_final.shape[1]}×{logo_final.shape[0]}")
    else:
        print(f"  logo_title.png      skipped (manually curated, exists)")

    # ── Wood Button (START) from tittle.png ───────────────────────────────────
    if not ((UI / "btn_wood_1.png").exists() or (UI / "btn_wood.png").exists()):
        # Scan found the START button at y≈488..630, x≈490..1123 (in 1611×976)
        btn_y0, btn_y1, btn_x0, btn_x1 = 482, 633, 488, 1128
        btn_raw = remove_white(title_arr[btn_y0:btn_y1, btn_x0:btn_x1], thr=240)
        bh, bw  = btn_raw.shape[:2]

        # Sample wood colour from left 12% and right 12% (decorative ends, no text)
        left_zone  = btn_raw[:, :int(bw * 0.12)]
        right_zone = btn_raw[:, int(bw * 0.88):]
        wood_px    = []
        for zone in (left_zone, right_zone):
            valid = zone[zone[:, :, 3] > 80, :3]
            if len(valid):
                wood_px.append(valid)
        wood_color = tuple(int(np.median(np.vstack(wood_px)[:, c])) for c in range(3)) \
            if wood_px else (210, 165, 100)

        # Erase text: fill centre band (x: 20–80%, y: 10–90%) with wood colour
        ex0, ex1 = int(bw * 0.20), int(bw * 0.80)
        ey0, ey1 = int(bh * 0.10), int(bh * 0.90)
        fill_region(btn_raw, ey0, ey1, ex0, ex1, wood_color, only_opaque=True)

        # Crop to content bbox
        bx0, by0, bx1, by1 = alpha_bbox(btn_raw)
        btn_final = btn_raw[by0: by1 + 1, bx0: bx1 + 1]
        Image.fromarray(btn_final).save(UI / "btn_wood.png")
        fw, fh = btn_final.shape[1], btn_final.shape[0]

        # Nine-slice: the angled end-caps are ≈13% width; border is ≈14% height
        sl = max(8, int(fw * 0.13))
        sr = sl
        st = max(6, int(fh * 0.14))
        sb = st
        btn_json = {"left": sl, "right": sr, "top": st, "bottom": sb}
        (UI / "btn_wood.json").write_text(json.dumps(btn_json, indent=2))
        print(f"  btn_wood.png        {fw}×{fh}  nine-slice={btn_json}")
        print(f"    wood colour sampled = #{wood_color[0]:02x}{wood_color[1]:02x}{wood_color[2]:02x}")
    else:
        print(f"  btn_wood*.png       skipped (manually curated, exists)")

    # ── Star Button (RACE >) from race_start.png ──────────────────────────────
    if not ((UI / "btn_star.png").exists()):
        # The starburst occupies bottom-right of race_start.png.
        star_x0, star_y0 = 1155, 575   # tight crop around the star
        star_rgb  = start_arr[star_y0:, star_x0:].copy()
        sH, sW    = star_rgb.shape[:2]

        r, g, b = (star_rgb[:, :, c].astype(int) for c in range(3))

        # Pure gold pixels — very tight criteria to avoid background sand
        is_gold = (r > 190) & (b < 90) & (r - b > 130) & (g > 120)
        # Dark outline (the heavy dark border of the star)
        is_dark = (r + g + b < 190) & (r < 85) & (g < 75)

        # radius=1 closing fills 1-2px gaps while keeping background fragments isolated
        raw_star  = is_gold | is_dark
        star_mask = morph_close(raw_star, radius=1)

        # BFS from centroid of gold pixels — this seeds ONLY inside the star body
        gold_ys, gold_xs = np.where(is_gold)
        ctr_y = int(gold_ys.mean()) if len(gold_ys) else sH // 2
        ctr_x = int(gold_xs.mean()) if len(gold_xs) else sW // 2

        keep_mask = np.zeros((sH, sW), dtype=bool)
        vis2      = np.zeros((sH, sW), dtype=bool)
        q2        = deque()
        start_y, start_x = ctr_y, ctr_x
        if not star_mask[start_y, start_x]:
            # Find nearest star pixel by expanding search
            for dist in range(1, 80):
                found = False
                for dy in range(-dist, dist + 1):
                    for dx in range(-dist, dist + 1):
                        ny, nx = start_y + dy, start_x + dx
                        if 0 <= ny < sH and 0 <= nx < sW and star_mask[ny, nx]:
                            start_y, start_x = ny, nx
                            found = True
                            break
                    if found:
                        break
                if found:
                    break
        vis2[start_y, start_x] = True
        q2.append((start_y, start_x))
        while q2:
            cy, cx = q2.popleft()
            keep_mask[cy, cx] = True
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < sH and 0 <= nx < sW and not vis2[ny, nx] and star_mask[ny, nx]:
                    vis2[ny, nx] = True
                    q2.append((ny, nx))

        star_rgba = make_mask_rgba(star_rgb, keep_mask)

        # Crop to content bbox
        sx0, sy0_c, sx1, sy1_c = alpha_bbox(star_rgba)
        star_crop = star_rgba[sy0_c: sy1_c + 1, sx0: sx1 + 1].copy()
        sCH, sCW  = star_crop.shape[:2]

        # Sample dominant gold colour
        cr2, cg2, cb2 = (star_crop[:, :, c].astype(int) for c in range(3))
        pure_gold = (cr2 > 190) & (cb2 < 90) & (cr2 - cb2 > 130) & (star_crop[:, :, 3] > 50)
        star_fill_color = median_color_of_mask(star_crop, pure_gold) \
            if pure_gold.any() else (240, 185, 55)

        # Erase text: fill the entire interior rectangle (including transparent holes
        # that correspond to white text highlights) with the gold colour.
        tx0, tx1 = int(sCW * 0.18), int(sCW * 0.82)
        ty0, ty1 = int(sCH * 0.15), int(sCH * 0.80)
        # Unconditionally overwrite every pixel in the text zone
        star_crop[ty0:ty1, tx0:tx1, 0] = star_fill_color[0]
        star_crop[ty0:ty1, tx0:tx1, 1] = star_fill_color[1]
        star_crop[ty0:ty1, tx0:tx1, 2] = star_fill_color[2]
        star_crop[ty0:ty1, tx0:tx1, 3] = 255

        Image.fromarray(star_crop).save(UI / "btn_star.png")
        sBW, sBH = star_crop.shape[1], star_crop.shape[0]
        # NOT nine-slice: a radially symmetric starburst has its cardinal spikes
        # sitting in the middle of each edge band, so border-image would smear
        # them unevenly the moment the button isn't square. Record stretch-mode
        # metadata instead; theme.css uses a plain background stretch.
        star_json = {"mode": "stretch", "w": sBW, "h": sBH}
        (UI / "btn_star.json").write_text(json.dumps(star_json, indent=2))
        print(f"  btn_star.png        {sBW}×{sBH}  {star_json}")
        print(f"    star fill colour  = #{star_fill_color[0]:02x}{star_fill_color[1]:02x}{star_fill_color[2]:02x}")
    else:
        print(f"  btn_star.png        skipped (manually curated, exists)")

    # ── Parchment Panel from race_gaming.png ─────────────────────────────────
    if not ((UI / "panel_parchment.png").exists()):
        # Panel occupies x≈1275–1595, y≈80–515 in 1619×971 image.
        # Crop slightly wider to include full border:
        px0, py0 = 1265, 75
        pan_rgb   = gaming_arr[py0:520, px0:].copy()
        pH, pW    = pan_rgb.shape[:2]

        pr2, pg2, pb2 = (pan_rgb[:, :, c].astype(int) for c in range(3))

        # Parchment interior: warm cream
        is_parch_pan = (
            (pr2 > 195) & (pg2 > 162) & (pb2 > 108) &
            (pr2 - pb2 > 30)     # warm (R clearly above B)
        )
        # Wooden border of the panel: brownish warm
        is_wood_pan = (
            (pr2 > 90) & (pr2 < 220) &
            (pg2 > 45) &
            (pb2 > 20) &
            (pr2 - pb2 > 35) &   # clearly warmer than background sky
            (pr2 > pg2 + 10)     # R dominates G
        )
        # Dark accents / ink / shadow
        is_dark_pan = (pr2 + pg2 + pb2 < 210) & (pr2 < 80)

        # Combine and close morphologically
        pan_mask = morph_close(is_parch_pan | is_wood_pan | is_dark_pan, radius=3)

        # Keep only the connected component that contains the panel centre
        # (flood-fill from the panel's approximate centre to label the main blob)
        ctr_y = int(pH * 0.50)
        ctr_x = int(pW * 0.50)

        # BFS connected component from centre
        visited  = np.zeros((pH, pW), dtype=bool)
        keep     = np.zeros((pH, pW), dtype=bool)
        q        = deque()
        if pan_mask[ctr_y, ctr_x]:
            visited[ctr_y, ctr_x] = True
            q.append((ctr_y, ctr_x))
        while q:
            cy, cx = q.popleft()
            keep[cy, cx] = True
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < pH and 0 <= nx < pW and not visited[ny, nx] and pan_mask[ny, nx]:
                    visited[ny, nx] = True
                    q.append((ny, nx))

        pan_rgba = make_mask_rgba(pan_rgb, keep)

        # Crop to content bbox
        pax0, pay0, pax1, pay1 = alpha_bbox(pan_rgba)
        pan_final = pan_rgba[pay0: pay1 + 1, pax0: pax1 + 1].copy()
        ppH, ppW  = pan_final.shape[:2]

        # Sample interior parchment colour (centre of the panel)
        parch_interior = (
            (pan_final[:, :, 0] > 200) &
            (pan_final[:, :, 1] > 165) &
            (pan_final[:, :, 3] > 50)
        )
        pan_fill_color = median_color_of_mask(pan_final, parch_interior) \
            if parch_interior.any() else (241, 205, 178)

        # Erase ALL interior content (text, horse icons, names) with parchment fill.
        # Fill EVERY pixel in the zone — including transparent ones (avoids white holes).
        ix0, ix1 = int(ppW * 0.07), int(ppW * 0.93)
        iy0, iy1 = int(ppH * 0.06), int(ppH * 0.94)
        # Overwrite the entire rectangular zone uniformly
        pan_final[iy0:iy1, ix0:ix1, 0] = pan_fill_color[0]
        pan_final[iy0:iy1, ix0:ix1, 1] = pan_fill_color[1]
        pan_final[iy0:iy1, ix0:ix1, 2] = pan_fill_color[2]
        pan_final[iy0:iy1, ix0:ix1, 3] = 255

        Image.fromarray(pan_final).save(UI / "panel_parchment.png")
        pan_sl = max(10, int(ppW * 0.18))
        pan_st = max(10, int(ppH * 0.12))
        pan_json = {"left": pan_sl, "right": pan_sl, "top": pan_st, "bottom": pan_st}
        (UI / "panel_parchment.json").write_text(json.dumps(pan_json, indent=2))
        print(f"  panel_parchment.png {ppW}×{ppH}  nine-slice={pan_json}")
        print(f"    parchment fill    = #{pan_fill_color[0]:02x}{pan_fill_color[1]:02x}{pan_fill_color[2]:02x}")
    else:
        print(f"  panel_parchment.png skipped (manually curated, exists)")
    print("[ui] Done")


# ─── MAIN ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("Ponygogogo — Asset Processing")
    print("=" * 60)

    process_icons()
    frame_json = process_frames()
    gaming_arr, _, _ = process_backgrounds()
    palette = process_palette(gaming_arr)
    process_ui(gaming_arr)

    print("\n" + "=" * 60)
    print("All assets generated successfully.")
    print(f"  palette.json   → {BG / 'palette.json'}")
    print(f"  card_frame.json → {UI / 'card_frame.json'}")
    print("=" * 60)
