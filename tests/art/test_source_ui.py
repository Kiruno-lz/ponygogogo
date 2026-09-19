"""Generated mattes must preserve native source pixels in fixed UI artwork."""
import unittest
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
UI = ROOT / 'art-src/art/ui'

class SourceUiTest(unittest.TestCase):
    def test_native_avatar_and_race_callout_preserve_source_rgb(self):
        source = Image.open(ROOT / 'art-src/renders/race_start.png').convert('RGB')
        for name, crop in [('avatar-source', (35, 25, 253, 247)),
                           ('star-race-source', (1190, 565, 1619, 955))]:
            with self.subTest(asset=name):
                image = Image.open(UI / f'{name}.png').convert('RGBA')
                self.assertEqual(image.size, (crop[2] - crop[0], crop[3] - crop[1]))
                self.assertIsNone(ImageChops.difference(image.convert('RGB'), source.crop(crop)).getbbox())
                self.assertEqual(image.getchannel('A').getextrema(), (0, 255))

    def test_empty_stamina_preserves_the_bolt_frame_and_alpha(self):
        full = Image.open(UI / 'stamina-reference.png').convert('RGBA')
        empty = Image.open(UI / 'stamina-reference-empty.png').convert('RGBA')
        mask = Image.open(UI / 'stamina-reference-empty-mask.png').convert('L')
        self.assertEqual(full.size, empty.size)
        self.assertIsNone(ImageChops.difference(full.getchannel('A'), empty.getchannel('A')).getbbox())
        diff = ImageChops.difference(full.convert('RGB'), empty.convert('RGB'))
        self.assertIsNotNone(diff.getbbox(), 'Empty artwork must have a genuinely empty fill')
        outside = ImageChops.invert(mask).point(lambda a: 255 if a == 255 else 0)
        self.assertIsNone(ImageChops.multiply(diff, Image.merge('RGB', (outside, outside, outside))).getbbox())

    def test_gogogo_keeps_native_lettering_and_changes_only_the_sample_payout(self):
        source = Image.open(ROOT / 'art-src/renders/race_gaming.png').convert('RGB').crop((1190, 565, 1619, 955))
        image = Image.open(UI / 'star-gogo-source.png').convert('RGBA')
        mask = Image.open(UI / 'star-gogo-source-label-mask.png').convert('L')
        diff = ImageChops.difference(source, image.convert('RGB'))
        self.assertIsNotNone(diff.getbbox())
        outside = ImageChops.invert(mask).point(lambda a: 255 if a == 255 else 0)
        self.assertIsNone(ImageChops.multiply(diff, Image.merge('RGB', (outside, outside, outside))).getbbox())
        for box in [(80, 95, 357, 227), (315, 185, 356, 236)]:
            self.assertIsNone(diff.crop(box).getbbox(), 'Main lettering and brush arrow must preserve original pixels')
        self.assertEqual(image.getchannel('A').getextrema(), (0, 255))

if __name__ == '__main__':
    unittest.main()
