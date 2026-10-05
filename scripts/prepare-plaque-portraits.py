#!/usr/bin/env python3
"""Encode the accepted plaque close-ups without rebuilding other art."""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORTRAIT_IDS = (1, 5, 6, 7, 8)
spec = importlib.util.spec_from_file_location('web_assets', ROOT / 'scripts/build-web-assets.py')
web_assets = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = web_assets
spec.loader.exec_module(web_assets)


def main():
    manifest_path = ROOT / 'public/assets/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    sizes = json.loads((ROOT / 'scripts/display-sizes.json').read_text())['sizes']
    group = web_assets.group_key('art/ponies/5-plaque-portrait')
    display = tuple(max(sizes[f'/assets/art/ponies/{id}-plaque-portrait'][axis] for id in PORTRAIT_IDS) for axis in range(2))
    for id in PORTRAIT_IDS:
        rel = f'art/ponies/{id}-plaque-portrait'
        source = ROOT / f'art-src/{rel}.png'
        destination = ROOT / f'public/assets/{rel}.webp'
        web_assets.encode_webp(source, destination, web_assets.target_size(source, f'{rel}.png', {group: display}))
        data = destination.read_bytes()
        manifest[rel.replace('/', '.')] = {
            'kind': 'image', 'path': f'assets/{rel}.webp', 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest()[:16], 'tier': 'race', 'deferred': True,
        }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
