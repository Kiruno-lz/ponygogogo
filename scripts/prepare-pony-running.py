"""Crop generated poses, register one scale per character, and pack runtime sheets."""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'art-src/art/ponies'


def gutter(projection, expected, radius):
    candidates = []
    start = None
    for i in range(max(1, expected - radius), min(len(projection) - 1, expected + radius)):
        if projection[i] == 0:
            if start is None:
                start = i
        elif start is not None:
            if i - start >= 4:
                candidates.append((start + i) // 2)
            start = None
    if start is not None:
        end = min(len(projection) - 1, expected + radius)
        if end - start >= 4:
            candidates.append((start + end) // 2)
    if not candidates:
        raise ValueError('No transparent gutter; subjects overlap or background is not transparent')
    return min(candidates, key=lambda x: abs(x - expected))


def frames_from(path):
    image = Image.open(path).convert('RGBA')
    alpha = np.asarray(image.getchannel('A')) > 128
    mid = gutter(alpha.sum(axis=1), image.height // 2, image.height // 8)
    frames = []
    source_crops = []
    for top, bottom in [(0, mid), (mid, image.height)]:
        projection = alpha[top:bottom].sum(axis=0)
        edges = [0] + [gutter(projection, round(i * image.width / 4), image.width // 12) for i in range(1, 4)] + [image.width]
        for left, right in zip(edges, edges[1:]):
            crop = (left, top, right, bottom)
            frame = image.crop(crop)
            box = frame.getchannel('A').point(lambda a: 255 if a > 128 else 0).getbbox()
            if not box or box[0] <= 0 or box[1] <= 0 or box[2] >= frame.width or box[3] >= frame.height:
                raise ValueError(f'{path.name}: character touches source boundary {crop}')
            frames.append((frame, box))
            source_crops.append(crop)
    return frames, source_crops


def head_anchor(frame, box):
    alpha = np.asarray(frame.getchannel('A'))
    band = alpha[box[1]:box[1] + round((box[3] - box[1]) * .2), :]
    _, xs = np.where(band > 128)
    return float(xs.mean()), box[1]


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir', type=Path, required=True, help='Directory containing {pony}-running-storyboard.png')
parser.add_argument('--pony', type=int, choices=range(9), nargs='+', required=True)
parser.add_argument('--reference-frames', default='0,2,4,6,8,10,12,14', help='Eight chronological reference frame numbers')
args = parser.parse_args()
reference_frames = [int(i) for i in args.reference_frames.split(',')]
if len(reference_frames) != 8:
    parser.error('--reference-frames requires eight entries')
HERE = args.source_dir.resolve()
for pony in args.pony:
    source = HERE / f'{pony}-running-storyboard.png'
    frames, crops = frames_from(source)
    anchors = [head_anchor(frame, box) for frame, box in frames]
    idle = Image.open(ART / f'{pony}-idle-0.png').convert('RGBA')
    idle_box = idle.getchannel('A').point(lambda a: 255 if a > 128 else 0).getbbox()
    head_x, _ = head_anchor(idle, idle_box)
    left = min(box[0] - anchor[0] for (_, box), anchor in zip(frames, anchors))
    right = max(box[2] - anchor[0] for (_, box), anchor in zip(frames, anchors))
    height = max(box[3] - box[1] for _, box in frames)
    # Retain the standing character's overall stature, with room for a small gait bob.
    target_height = min(160, idle_box[3] - idle_box[1])
    scale = min((head_x - 10) / -left, (246 - head_x) / right, target_height / height)
    head_top = 178 - round(height * scale)
    bob = [1, 2, 0, -3, 1, 2, 0, -3] if pony == 8 else [-2, -1, 1, -1, 0, 2, 1, -1]
    sheet = Image.new('RGBA', (2048, 192))
    contact = Image.new('RGBA', (1024, 384))
    packed_frames = []
    ground_shifts = []
    for i, ((frame, box), (anchor_x, anchor_y)) in enumerate(zip(frames, anchors)):
        bounds = (box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2)
        cropped = frame.crop(bounds)
        size = (round(cropped.width * scale), round(cropped.height * scale))
        packed = Image.new('RGBA', (256, 192))
        packed.paste(cropped.resize(size, Image.Resampling.LANCZOS),
                     (round(head_x - (anchor_x - bounds[0]) * scale), round(head_top - (anchor_y - bounds[1]) * scale) + bob[i]))
        visible = packed.getchannel('A').point(lambda a: 255 if a > 128 else 0).getbbox()
        # Biped stance soles share a floor; suspension is 12px above it.
        # Translate the complete frame only, preserving all generated limb pixels.
        ground_shift = 0
        if pony == 8 and visible:
            target_bottom = 166 if i in (3, 7) else 178
            ground_shift = target_bottom - visible[3]
            registered = Image.new('RGBA', packed.size)
            registered.paste(packed, (0, ground_shift))
            packed = registered
            visible = packed.getchannel('A').point(lambda a: 255 if a > 128 else 0).getbbox()
        ground_shifts.append(ground_shift)
        if not visible or visible[0] <= 0 or visible[1] <= 0 or visible[2] >= 256 or visible[3] >= 192:
            raise ValueError(f'pony {pony}: packed frame {i} clips')
        packed.save(ART / f'{pony}-running-{i}.png')
        packed_frames.append(packed)
        sheet.paste(packed, (i * 256, 0))
        contact.paste(packed, ((i % 4) * 256, (i // 4) * 192))
    sheet.save(ART / f'{pony}-running.png')
    contact.save(HERE / f'{pony}-packed-storyboard.png')
    packed_frames[0].save(ART / f'{pony}-running-animated.png', save_all=True,
                          append_images=packed_frames[1:], duration=1000 / 12, loop=0, disposal=0, blend=0)
    metadata = {'ponyId': pony, 'source': str(source.relative_to(ROOT)), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'sourceCrops': crops, 'frameSize': [256, 192], 'frameCount': 8, 'scale': scale,
                'sourceHeadAnchors': anchors, 'targetHeadAnchor': [head_x, head_top], 'phaseBobPx': bob,
                'phaseGroundRegistrationPx': ground_shifts,
                'referenceFrameIndices': reference_frames,
                'registration': 'uniform scale per character; horizontal head anchor; biped stance/flight floor registration' if pony == 8 else 'uniform scale per character; fixed head anchor plus small short-limb gait bob; original generated limb pixels and frame order'}
    (HERE / f'{pony}-running-registration.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(pony, round(scale, 4), (round(head_x), head_top))
