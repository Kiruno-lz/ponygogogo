"""Prepare the generated gold arrow and update only its runtime manifest entry.

Input: art-src/art/ui/queue-arrow-source.png (original Image Gen output).
The down arrow uses a CSS rotation of the same asset. No other artwork is rebuilt.
"""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'art-src/art/ui/queue-arrow-source.png'
image = Image.open(source).convert('RGBA')
alpha = image.getchannel('A')
if alpha.getextrema() != (0, 255):
    raise ValueError('The generated arrow must have a real transparent background and solid fill')
bounds = alpha.getbbox()
if not bounds:
    raise ValueError('Empty arrow')
image = image.crop(bounds)
image.thumbnail((256, 256), Image.Resampling.LANCZOS)
master = Image.new('RGBA', (image.width + 12, image.height + 12))
master.alpha_composite(image, (6, 6))
master.save(source.with_name('queue-arrow-up.png'))
output = ROOT / 'public/assets/art/ui/queue-arrow-up.webp'
master.save(output, 'WEBP', lossless=True, method=6)
data = output.read_bytes()
manifest_path = ROOT / 'public/assets/manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['art.ui.queue-arrow-up'] = {
    'kind': 'image', 'path': str(output.relative_to(ROOT / 'public')),
    'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()[:16], 'tier': 'race',
}
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
print(f'{output}: {master.size}, {len(data)} bytes')
