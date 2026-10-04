#!/usr/bin/env python3
"""Prepare generated card artwork without drawing or recoloring its pixels.

Inputs: art-src/art/cards/_generated/card-N.png (1..40),
Outputs: normalized transparent PNG masters, WebP assets, manifest entries.
Uses the canonical WebP encoder; a full build uses the same PNG masters.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('web_assets', ROOT / 'scripts/build-web-assets.py')
builder = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = builder
spec.loader.exec_module(builder)


def prepare(source: Path, master: Path, size: int, padding: int, preserve_canvas: bool = False) -> dict:
    image = Image.open(source).convert('RGBA')
    alpha = image.getchannel('A')
    if alpha.getextrema()[0] != 0:
        raise ValueError(f'Generated source has no transparent background: {source}')
    if preserve_canvas:
        if image.size != (size, size):
            raise ValueError(f'Registered source must already be {size} x {size}: {source}')
        master.parent.mkdir(parents=True, exist_ok=True)
        image.save(master)
        return {'sourceSize': list(image.size), 'crop': [0, 0, size, size],
                'masterSize': list(image.size), 'preserveCanvas': True}
    box = alpha.point(lambda a: 255 if a > 8 else 0).getbbox()
    if box is None:
        raise ValueError(f'Empty generated source: {source}')
    # Keep low-alpha antialiased edges and glow outside the visible subject.
    box = (max(0, box[0]-8), max(0, box[1]-8), min(image.width, box[2]+8), min(image.height, box[3]+8))
    subject = image.crop(box)
    subject.thumbnail((size-padding*2, size-padding*2), Image.Resampling.LANCZOS)
    result = Image.new('RGBA', (size, size))
    result.alpha_composite(subject, ((size-subject.width)//2, (size-subject.height)//2))
    master.parent.mkdir(parents=True, exist_ok=True)
    result.save(master)
    return {'sourceSize': list(image.size), 'crop': list(box), 'masterSize': list(result.size)}


def main() -> None:
    sources = [(ROOT / f'art-src/art/cards/_generated/card-{i}.png',
                f'art/cards/card-{i}.png', 512, 24, (320, 320)) for i in range(1, 41)]
    missing = [str(source) for source, *_ in sources if not source.exists()]
    if missing:
        raise ValueError('Missing generated sources: ' + ', '.join(missing))
    manifest_path = ROOT / 'public/assets/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    provenance = json.loads((ROOT / 'art-src/art/cards/generation-prompts.json').read_text())
    fixed_canvas = {f'art/cards/card-{card["id"]}.png' for card in provenance['cards'] if card.get('preserveCanvas')}
    metadata = {}
    for source, relative, size, padding, target in sources:
        master = ROOT / 'art-src' / relative
        metadata[relative] = prepare(source, master, size, padding, relative in fixed_canvas)
        output_relative = str(Path(relative).with_suffix('.webp'))
        output = ROOT / 'public/assets' / output_relative
        output.parent.mkdir(parents=True, exist_ok=True)
        builder.encode_webp(master, output, target)
        data = output.read_bytes()
        key = str(Path(output_relative).with_suffix('')).replace('/', '.')
        manifest[key] = {'kind': 'image', 'path': 'assets/'+output_relative,
                         'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()[:16], 'tier': 'race'}
    # Remove only the replaced nineteen code-drawn card SVGs.
    for i in range(22, 41):
        manifest.pop(f'cards.card-{i}', None)
        (ROOT / f'public/assets/cards/card-{i}.svg').unlink(missing_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+'\n')
    (ROOT / 'art-src/art/cards/card-art-meta.json').write_text(json.dumps(metadata, indent=2)+'\n')
    print('Prepared 40 image card icons')


if __name__ == '__main__':
    main()
