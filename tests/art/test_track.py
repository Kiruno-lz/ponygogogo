"""Readable signs must retain their original orientation when the backdrop wraps."""
import unittest
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

ART = Path(__file__).resolve().parents[2] / 'public/assets/art/track'

class TrackArtTest(unittest.TestCase):
    def test_parallax_art_has_no_hard_edge_when_it_wraps(self):
        for name in ['far', 'front']:
            with self.subTest(layer=name):
                image = Image.open(ART / f'{name}.png').convert('RGB')
                for boundary in [1619, image.width]:
                    left = image.crop((boundary - 1, 0, boundary, image.height))
                    right_x = boundary % image.width
                    right = image.crop((right_x, 0, right_x + 1, image.height))
                    contrast = sum(ImageStat.Stat(ImageChops.difference(left, right)).mean) / 3
                    self.assertLessEqual(contrast, 8, 'A scrolling join must not introduce a vertical color stripe')

    def test_readable_signs_preserve_the_original_artwork(self):
        source = Image.open(ART / 'scene.png').convert('RGB').resize((1619, 971), Image.Resampling.LANCZOS)
        for name, rect in [('far', (780, 220, 895, 284)), ('front', (660, 95, 970, 180))]:
            with self.subTest(layer=name):
                image = Image.open(ART / f'{name}.png').convert('RGB')
                x0, y0, x1, y1 = rect
                sign = image.crop(rect)
                offset = 769 if name == 'front' else 0
                original = source.crop((x0, y0 + offset, x1, y1 + offset))
                self.assertIsNone(ImageChops.difference(sign, original).getbbox(),
                                  'The MON / Go! Go! Pony signs must retain their original lettering')

if __name__ == '__main__':
    unittest.main()
