#!/usr/bin/env python3
"""Register source UI slices, generated transparent HUD assets, and continuous track layers."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'public/assets/art'
HOME = ART / 'home'
HOME.mkdir(parents=True, exist_ok=True)
source = Image.open(ROOT / 'assrt/tittle.png').convert('RGBA')
rects = {
    'logo': (250, 0, 1345, 485), 'start': (486, 482, 1140, 650),
    'collection': (536, 645, 1066, 786), 'settings': (541, 781, 1055, 936),
    'login': (1310, 0, 1611, 161), 'register': (1325, 159, 1611, 392),
}
for name, box in rects.items():
    source.crop(box).save(HOME / f'{name}.png')

UI = ART / 'ui'
race_source = Image.open(ROOT / 'assrt/race_start.png').convert('RGBA')
for name, matte_name, box in [
    ('avatar-source', 'avatar-reference', (35, 25, 253, 247)),
    ('star-race-source', 'star-reference', (1190, 565, 1619, 955)),
]:
    image = race_source.crop(box)
    matte = Image.open(UI / f'{matte_name}.png').convert('RGBA').getchannel('A')
    image.putalpha(matte.resize(image.size, Image.Resampling.LANCZOS))
    image.save(UI / f'{name}.png')
for name in ['avatar', 'avatar-blank', 'stamina', 'star', 'wallet', 'bet-panel', 'bet-chip',
             'bet-chip-selected', 'coin', 'win-strip', 'horseshoe', 'dust', 'gold-ring', 'buff-frame', 'buff-wing', 'buff-leaf', 'buff-fire', 'buff-eye']:
    source_name = 'buff-eye-v2' if name == 'buff-eye' else name
    image = Image.open(UI / f'{source_name}.png').convert('RGBA')
    threshold = 6 if name in ['dust', 'gold-ring', 'buff-wing', 'buff-fire', 'buff-eye'] else 127
    box = image.getchannel('A').point(lambda a: 255 if a > threshold else 0).getbbox()
    image = image.crop(box)
    if name == 'dust':
        image = image.resize((128, round(image.height * 128 / image.width)), Image.Resampling.LANCZOS)
    image.save(UI / f'{name}-trimmed.png')
flags = Image.open(UI / 'lane-flags.png').convert('RGBA')
for index in range(5):
    image = flags.crop((round(index * flags.width / 5), 0,
                        round((index + 1) * flags.width / 5), flags.height))
    box = image.getchannel('A').point(lambda a: 255 if a > 127 else 0).getbbox()
    image.crop(box).save(UI / f'flag-{index}.png')

TRACK = ART / 'track'
source = Image.open(TRACK / 'scene.png').convert('RGB').resize((1619, 971), Image.Resampling.LANCZOS)
loop = Image.open(TRACK / 'scene-loop.png').convert('RGB')
rects = [('far', (0, 0, 1619, 356)),
         ('front', (0, 769, 1619, 971)), ('track', (0, 356, 1619, 769))]
for name, box in rects:
    image = source.crop(box)
    if name in ['far', 'front']:
        tile = loop.crop((0, box[1], loop.width, box[3]))
    else:
        tile = Image.new('RGB', (3238, image.height))
        tile.paste(image, (0, 0))
        tile.paste(image.transpose(Image.Transpose.FLIP_LEFT_RIGHT), (1619, 0))
    tile.save(TRACK / f'{name}.png')
