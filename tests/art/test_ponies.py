"""Inspect decoded production pixels, including transparent margins and reference-sized silhouettes."""
import unittest
from pathlib import Path
from PIL import Image

PONIES = Path(__file__).resolve().parents[2] / 'public/assets/art/ponies'

class PonySilhouetteTest(unittest.TestCase):
    def test_every_frame_has_reference_proportions_and_registered_hooves(self):
        for horse in range(5):
            for action in ['running', 'idle']:
                for frame in range(8):
                    with self.subTest(horse=horse, action=action, frame=frame):
                        image = Image.open(PONIES / f'{horse}-{action}-{frame}.png').convert('RGBA')
                        alpha = image.getchannel('A')
                        self.assertEqual(alpha.getextrema(), (0, 255), 'PNG must contain real transparency')
                        bounds = alpha.point(lambda a: 255 if a > 127 else 0).getbbox()
                        self.assertIsNotNone(bounds)
                        left, top, right, bottom = bounds
                        self.assertGreater(left, 0)
                        self.assertGreater(top, 0)
                        self.assertLess(right, 256)
                        self.assertLessEqual(right - left, 210, 'Horse exceeds the source silhouette width')
                        self.assertLessEqual(bottom - top, 145, 'Horse exceeds the source silhouette height')
                        self.assertLessEqual(bottom, 180, 'Running hooves must not penetrate the registered ground')
                        if action == 'idle':
                            self.assertEqual(bottom, 180, 'Standing hooves must share the registered ground')

if __name__ == '__main__':
    unittest.main()
