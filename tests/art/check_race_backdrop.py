"""Validate a real browser capture of the first frame containing the race canvas."""
import sys
from PIL import Image, ImageStat

image = Image.open(sys.argv[1]).convert('RGB')
# This region contains castle / trees / bunting in the source, with no HUD overlay.
region = image.crop((round(600 * image.width / 1619), round(240 * image.height / 971),
                     round(1100 * image.width / 1619), round(320 * image.height / 971)))
variation = sum(ImageStat.Stat(region).stddev) / 3
assert variation > 12, f'First race canvas frame has a blank backdrop: RGB variation {variation:.2f}'
print(f'First race frame has artwork: RGB variation {variation:.2f}')
