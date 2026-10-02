#!/usr/bin/env python3
"""Ship the poster masters with the canonical encoder without rebuilding unrelated assets."""
import hashlib
import json
import runpy
import shutil
import subprocess
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'art-src/art/share'
OUT = ROOT / 'public/assets/art/share'


def main():
    subprocess.run(['bun', str(ROOT / 'scripts/prepare-share-qr.ts')], check=True)
    pipeline = runpy.run_path(str(ROOT / 'scripts/build-web-assets.py'))
    manifest_path = ROOT / 'public/assets/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    for name in ['background', 'prize-group', 'win', 'finish', *[f'horse-{i}' for i in range(5)], 'qr']:
        source = ART / f'{name}.png'
        with Image.open(source) as image:
            if name != 'background' and (image.mode != 'RGBA' or image.getchannel('A').getextrema()[0] != 0):
                raise ValueError(f'{name} must have a genuine alpha background')
        target = OUT / (name + ('.png' if name == 'qr' else '.webp'))
        if name == 'qr':
            shutil.copy2(source, target)
        else:
            pipeline['encode_webp'](source, target, None)
        data = target.read_bytes()
        manifest[f'art.share.{name}'] = {'kind': 'image', 'path': str(target.relative_to(ROOT / 'public')),
            'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()[:16], 'tier': 'result'}
    # The opaque QR is an input master, not a second deployable asset.
    manifest.pop('QR code', None)
    (ROOT / 'public/assets/QR code.png').unlink(missing_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
