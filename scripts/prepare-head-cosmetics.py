#!/usr/bin/env python3
"""Normalize the generated head-item cutouts and ship only their scoped WebP assets."""
import hashlib
import importlib.util
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'art-src/art/cosmetics'
FRAME = (192, 144)


def main():
    spec = importlib.util.spec_from_file_location('build_web_assets', ROOT / 'scripts/build-web-assets.py')
    build = importlib.util.module_from_spec(spec)
    # dataclass resolves its defining module through sys.modules.
    import sys
    sys.modules[spec.name] = build
    spec.loader.exec_module(build)
    manifest_path = ROOT / 'public/assets/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    metadata = {}
    for name in ['blonde-hair', 'green-hair']:
        source = Image.open(ART / f'{name}-source.png')
        if source.mode != 'RGBA' or source.getchannel('A').getextrema()[0] != 0:
            raise ValueError(f'{name} requires a transparent RGBA source')
        bounds = source.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox()
        sprite = source.crop(bounds)
        sprite.thumbnail((FRAME[0] - 16, FRAME[1] - 16), Image.Resampling.LANCZOS)
        master = Image.new('RGBA', FRAME)
        master.alpha_composite(sprite, ((FRAME[0] - sprite.width) // 2, (FRAME[1] - sprite.height) // 2))
        master_path = ART / f'{name}.png'
        master.save(master_path)
        rel = f'assets/art/cosmetics/{name}.webp'
        target = ROOT / 'public' / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        build.encode_webp(master_path, target, None)
        data = target.read_bytes()
        manifest[f'art.cosmetics.{name}'] = {'kind': 'image', 'path': rel, 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest()[:16], 'tier': 'race'}
        metadata[name] = {'sourceSize': list(source.size), 'sourceBounds': bounds, 'frameSize': FRAME}
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    (ART / 'head-cosmetics-frameprep-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')


if __name__ == '__main__':
    main()
