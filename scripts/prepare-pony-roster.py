#!/usr/bin/env python3
"""Pack generated 4x2 storyboards into the existing 8x256x192 runtime format.

Only crop, uniformly resize and register frames; never synthesize missing poses.
Both actions share one scale so switching idle/running cannot resize the character.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'art-src/art'
CONCEPTS = ART / 'ponies/_concepts/2026-10-03'
NAMES = {5: 'niulai', 6: 'bajuntu', 7: 'nailong', 8: 'gugugaga'}
MASTERS = {5: 'niulai-conversation-render.png', 6: 'bajuntu-source.png',
           7: 'review/nailong-source-v6-smile.png', 8: 'review/gugugaga-source-v2-biped.png'}


def read_frames(path):
    image = Image.open(path).convert('RGBA')
    frames = []
    for i in range(8):
        column, row = i % 4, i // 4
        frame = image.crop((round(column * image.width / 4), round(row * image.height / 2),
                            round((column + 1) * image.width / 4), round((row + 1) * image.height / 2)))
        visible = frame.getchannel('A').point(lambda alpha: 255 if alpha > 128 else 0)
        box = visible.getbbox()
        if box is None:
            raise ValueError(f'{path}: empty frame {i}')
        if box[0] == 0 or box[1] == 0 or box[2] == frame.width or box[3] == frame.height:
            raise ValueError(f'{path}: frame {i} touches a cell edge')
        frames.append((frame, box))
    return frames


def pack(pony_id):
    name = NAMES[pony_id]
    paths = {action: CONCEPTS / f'motion/{name}-{action}-storyboard.png' for action in ('idle', 'running')}
    # Verify both sources before writing any output.
    actions = {action: read_frames(path) for action, path in paths.items()}
    master_path = CONCEPTS / MASTERS[pony_id]
    master = Image.open(master_path).convert('RGBA')
    master_box = master.getchannel('A').point(lambda alpha: 255 if alpha > 128 else 0).getbbox()
    if master_box is None:
        raise ValueError(f'{master_path}: empty master')
    subject = master.crop(master_box)
    # Keep each action's source coordinates intact; square-stretching a portrait cell would
    # squash a biped. Register the two union boxes at their centers and common ground plane.
    bounds = {}
    for action, frames in actions.items():
        boxes = [box for _, box in frames]
        bounds[action] = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    width = max(box[2] - box[0] for box in bounds.values())
    height = max(box[3] - box[1] for box in bounds.values())
    scale = min(224 / width, 168 / height)
    normalized = {}
    for action, frames in actions.items():
        box = bounds[action]
        size = (round((box[2] - box[0]) * scale), round((box[3] - box[1]) * scale))
        sheet = Image.new('RGBA', (2048, 192))
        normalized[action] = []
        for i, (frame, visible_box) in enumerate(frames):
            packed = Image.new('RGBA', (256, 192))
            sprite = frame.crop(box).resize(size, Image.Resampling.LANCZOS)
            # Idle feet stay planted; running keeps its shared source baseline for suspension.
            idle_offset = round((box[3] - visible_box[3]) * scale) if action == 'idle' else 0
            packed.paste(sprite, ((256 - size[0]) // 2, 180 - size[1] + idle_offset))
            normalized[action].append(packed)
            sheet.paste(packed, (i * 256, 0))
            packed.save(ART / f'ponies/{pony_id}-{action}-{i}.png')
        sheet.save(ART / f'ponies/{pony_id}-{action}.png')
    # Static views preserve the selected high-resolution mother, rather than enlarging a 256px frame.
    master_dir = ART / 'ponies/_masters'
    master_dir.mkdir(exist_ok=True)
    shutil.copy2(master_path, master_dir / f'{pony_id}-source.png')
    portrait = subject.copy()
    portrait.thumbnail((320, 320), Image.Resampling.LANCZOS)
    portrait.save(ART / f'ponies/{pony_id}-portrait.png')
    def static_canvas(width, height, max_width, max_height, baseline):
        ratio = min(max_width / subject.width, max_height / subject.height)
        size = (round(subject.width * ratio), round(subject.height * ratio))
        canvas = Image.new('RGBA', (width, height))
        canvas.paste(subject.resize(size, Image.Resampling.LANCZOS), ((width - size[0]) // 2, baseline - size[1]))
        return canvas
    hero = static_canvas(515, 393, 450, 344, 368)
    hero.save(ART / f'result/hero-{pony_id}.png')
    static_canvas(768, 576, 672, 504, 540).save(ART / f'share/horse-{pony_id}.png')
    metadata = {'ponyId': pony_id, 'frameWidth': 256, 'frameHeight': 192, 'frameCount': 8,
                'sourceCell': {action: frames[0][0].size for action, frames in actions.items()},
                'sourceBounds': bounds, 'scale': scale, 'baseline': 180, 'idleFootRegistration': 'per-frame bottom at 180',
                'master': MASTERS[pony_id], 'masterSha256': hashlib.sha256(master_path.read_bytes()).hexdigest(),
                'sourceSha256': {action: hashlib.sha256(path.read_bytes()).hexdigest() for action, path in paths.items()}}
    (ART / f'ponies/{pony_id}-frameprep-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--pony', type=int, choices=NAMES, nargs='+', default=list(NAMES))
    for pony in parser.parse_args().pony:
        pack(pony)
