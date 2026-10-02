"""Check the shipped C-02 art, fixed leading-tip anchor, loop and pipeline guards."""
import importlib.util
import json
import io
import statistics
import subprocess
import sys
import time
import unittest
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'art-src/art/effects'


class SpinThrustArtTest(unittest.TestCase):
    def test_runtime_sheet_stays_decodable_during_rebuild(self):
        output = ROOT / 'public/assets/art/effects/spin-thrust-sheet.webp'
        process = subprocess.Popen([sys.executable, str(ROOT / 'scripts/prepare-spin-thrust.py')],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        samples = 0
        try:
            while process.poll() is None:
                # This is the consumer's actual published filename, not the pending file.
                data = output.read_bytes()
                self.assertGreater(len(data), 0)
                image = Image.open(io.BytesIO(data))
                image.load()
                self.assertEqual(image.size, (1152, 768))
                samples += 1
                time.sleep(0.005)
        finally:
            _, error = process.communicate()
        self.assertEqual(process.returncode, 0, error.decode())
        self.assertGreater(samples, 5)

    def test_sixteen_distinct_transparent_frames_have_a_stable_tip_and_loop(self):
        sheet = Image.open(ART / 'spin-thrust-sheet.png')
        deployed = Image.open(ROOT / 'public/assets/art/effects/spin-thrust-sheet.webp')
        self.assertEqual(sheet.mode, 'RGBA')
        self.assertEqual(sheet.size, (1152, 768))
        self.assertEqual(deployed.size, sheet.size)
        self.assertEqual(deployed.getchannel('A').tobytes(), sheet.getchannel('A').tobytes())
        frames, tips = [], []
        for index in range(16):
            x, y = index % 4 * 288, index // 4 * 192
            frame = sheet.crop((x, y, x + 288, y + 192))
            alpha = frame.getchannel('A')
            self.assertEqual(alpha.crop((0, 0, 288, 16)).getextrema()[1], 0)
            self.assertEqual(alpha.crop((0, 176, 288, 192)).getextrema()[1], 0)
            self.assertEqual(alpha.crop((0, 0, 8, 192)).getextrema()[1], 0)
            self.assertEqual(alpha.crop((280, 0, 288, 192)).getextrema()[1], 0)
            self.assertGreater(alpha.getextrema()[1], 200)
            visible = alpha.point(lambda a: 255 if a > 32 else 0).getbbox()
            self.assertGreaterEqual(visible[3] - visible[1], 146, 'spiral must cover the pony vertically')
            red = [(px, py) for py in range(192) for px in range(288)
                   if (p := frame.getpixel((px, py)))[3] > 32
                   and p[0] > p[1] * 1.15 and p[0] > p[2] * 1.12]
            tip_x = max(px for px, _ in red)
            tip = [py for px, py in red if px >= tip_x - 3]
            tips.append((tip_x, sum(tip) / len(tip)))
            frames.append(Image.alpha_composite(Image.new('RGBA', frame.size, '#4b7c42'), frame))
        self.assertEqual(len({frame.tobytes() for frame in frames}), 16)
        self.assertLessEqual(max(t[0] for t in tips) - min(t[0] for t in tips), 2)
        self.assertLessEqual(max(t[1] for t in tips) - min(t[1] for t in tips), 2)
        changes = [sum(ImageStat.Stat(ImageChops.difference(frames[i], frames[(i + 1) % 16])).mean[:3])
                   for i in range(16)]
        self.assertGreater(min(changes), 0)
        self.assertLess(changes[-1], statistics.median(changes) * 3)

        # The top crest must actually advance in the baked pixels, not just wobble in place.
        def upper_crest(index):
            x, y = index % 4 * 288, index // 4 * 192
            frame = sheet.crop((x, y, x + 288, y + 192))
            energy = [sum((p := frame.getpixel((px, py)))[3] * sum(p[:3])
                          for py in range(16, 45)) for px in range(288)]
            return max(range(110, 190), key=lambda px: energy[px])
        travel = upper_crest(8) - upper_crest(12)
        motion = json.loads((ART / 'spin-thrust-motion-metadata.json').read_text())
        prepared = json.loads((ART / 'spin-thrust-frameprep-metadata.json').read_text())
        expected = motion['length'] / (4 * motion['turns']) * motion['sourceScale'] * prepared['scale']
        self.assertGreater(travel, 20)
        self.assertAlmostEqual(travel, expected, delta=3)

    def test_asset_rebuild_never_ships_sources_or_changes_sheet_dimensions(self):
        spec = importlib.util.spec_from_file_location('web_assets_test', ROOT / 'scripts/build-web-assets.py')
        builder = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = builder
        spec.loader.exec_module(builder)
        self.assertFalse(builder.ships('art/effects/spin-thrust-reference.png'))
        self.assertFalse(builder.ships('art/effects/spin-thrust-source.png'))
        self.assertFalse(builder.ships('art/effects/spin-thrust-ribbon-material.png'))
        self.assertFalse(builder.ships('art/effects/spin-thrust-animated.png'))
        self.assertFalse(builder.ships('art/effects/spin-thrust-frameprep-metadata.json'))
        self.assertTrue(builder.ships('art/effects/spin-thrust-sheet.png'))
        self.assertIsNone(builder.target_size(ART / 'spin-thrust-sheet.png',
                                            'art/effects/spin-thrust-sheet.png',
                                            {'art/effects/spin-thrust-sheet': (100, 50)}))


if __name__ == '__main__':
    unittest.main()
