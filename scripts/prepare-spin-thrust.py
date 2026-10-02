#!/usr/bin/env python3
"""Normalize C-02's generated 4×4 sheet, encode its WebP and register the asset.

Run with the same Python/Pillow and cwebp used by build-web-assets.py.
All frames share one scale and a fixed red leading-tip anchor; preserve the raw source.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'art-src/art/effects'
FRAME_W, FRAME_H = 288, 192


def normalize(source: Image.Image) -> tuple[Image.Image, dict]:
    if source.mode != 'RGBA' or source.width % 4 or source.height % 4:
        raise ValueError('Expected an RGBA sheet with four equal columns and rows')
    cell_w, cell_h = source.width // 4, source.height // 4
    frames, anchors, bounds = [], [], []
    for index in range(16):
        x, y = index % 4 * cell_w, index // 4 * cell_h
        frame = source.crop((x, y, x + cell_w, y + cell_h))
        # Remove only imperceptible alpha=1 background noise; keep the glow gradient.
        frame.putalpha(frame.getchannel('A').point(lambda a: 0 if a <= 1 else a))
        red = [(px, py) for py in range(cell_h) for px in range(cell_w)
               if (p := frame.getpixel((px, py)))[3] > 32
               and p[0] > p[1] * 1.15 and p[0] > p[2] * 1.12]
        if not red:
            raise ValueError(f'Frame {index} has no red leading tip')
        tip_x = max(px for px, _ in red)
        tip = [(px, py) for px, py in red if px >= tip_x - 5]
        tip_y = sum(py for _, py in tip) / len(tip)
        box = frame.getchannel('A').point(lambda a: 255 if a > 4 else 0).getbbox()
        bounds.append((box[0] - tip_x, box[1] - tip_y, box[2] - tip_x, box[3] - tip_y))
        anchors.append((tip_x, tip_y))
        frames.append(frame)

    left = min(b[0] for b in bounds)
    top = min(b[1] for b in bounds)
    right = max(b[2] for b in bounds)
    bottom = max(b[3] for b in bounds)
    scale = min((FRAME_W - 32) / (right - left), (FRAME_H - 32) / (bottom - top))
    target_x, target_y = FRAME_W - 16 - right * scale, FRAME_H / 2
    size = (round(cell_w * scale), round(cell_h * scale))
    sheet = Image.new('RGBA', (FRAME_W * 4, FRAME_H * 4))
    for index, (frame, (tip_x, tip_y)) in enumerate(zip(frames, anchors)):
        normalized = Image.new('RGBA', (FRAME_W, FRAME_H))
        normalized.alpha_composite(frame.resize(size, Image.Resampling.LANCZOS),
                                   (round(target_x - tip_x * scale), round(target_y - tip_y * scale)))
        sheet.paste(normalized, (index % 4 * FRAME_W, index // 4 * FRAME_H))
    return sheet, {
        'sourceSize': list(source.size), 'frameSize': [FRAME_W, FRAME_H],
        'columns': 4, 'rows': 4, 'frameCount': 16, 'loopMs': 650,
        'scale': scale, 'sourceTipAnchors': anchors, 'targetTipAnchor': [target_x, target_y],
    }


def main() -> None:
    source = ART / 'spin-thrust-source.png'
    sheet, metadata = normalize(Image.open(source))
    master = ART / 'spin-thrust-sheet.png'
    sheet.save(master)
    (ART / 'spin-thrust-frameprep-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    # Reference playback: full-frame replacement preserves clean alpha between phases.
    frames = [sheet.crop((i % 4 * FRAME_W, i // 4 * FRAME_H,
                          i % 4 * FRAME_W + FRAME_W, i // 4 * FRAME_H + FRAME_H)) for i in range(16)]
    durations = [(i + 1) * metadata['loopMs'] // 16 - i * metadata['loopMs'] // 16 for i in range(16)]
    frames[0].save(ART / 'spin-thrust-animated.png', save_all=True, append_images=frames[1:],
                   duration=durations, loop=0, disposal=0, blend=0)
    pony = Image.open(ROOT / 'public/assets/art/ponies/0-idle-0.webp').convert('RGBA')
    pony = pony.resize((206, 154), Image.Resampling.LANCZOS)
    composites = []
    for frame in frames:
        base = Image.new('RGBA', (FRAME_W, FRAME_H), '#343f50')
        base.alpha_composite(pony, (41, 19))
        overlay = frame.copy()
        overlay.putalpha(overlay.getchannel('A').point(lambda a: round(a * 0.55)))
        base.alpha_composite(overlay)
        composites.append(base.resize((576, 384), Image.Resampling.LANCZOS))
    review = ART / '_review'
    review.mkdir(exist_ok=True)
    composites[0].save(review / 'spin-thrust-cycle.png', save_all=True, append_images=composites[1:],
                       duration=durations, loop=0, disposal=0, blend=0)

    # Reuse the canonical encoder, updating only this asset instead of rebuilding all art.
    spec = importlib.util.spec_from_file_location('web_assets', ROOT / 'scripts/build-web-assets.py')
    builder = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = builder
    spec.loader.exec_module(builder)
    output = ROOT / 'public/assets/art/effects/spin-thrust-sheet.webp'
    output.parent.mkdir(parents=True, exist_ok=True)
    pending_output = output.with_suffix('.tmp.webp')
    builder.encode_webp(master, pending_output, None)
    pending_output.replace(output)
    data = output.read_bytes()
    manifest_path = ROOT / 'public/assets/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['art.effects.spin-thrust-sheet'] = {
        'kind': 'image', 'path': 'assets/art/effects/spin-thrust-sheet.webp',
        'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()[:16], 'tier': 'race',
    }
    pending_manifest = manifest_path.with_suffix('.tmp.json')
    pending_manifest.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    pending_manifest.replace(manifest_path)
    print(f'{master.relative_to(ROOT)}: {sheet.width}×{sheet.height} RGBA, 16 frames')
    print(f'{output.relative_to(ROOT)}: {len(data):,} bytes')


if __name__ == '__main__':
    main()
