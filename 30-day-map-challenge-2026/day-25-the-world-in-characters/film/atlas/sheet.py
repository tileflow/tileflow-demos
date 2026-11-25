"""Sample the one registered typographic sheet in Tileflow's Equal Earth camera."""
import functools
import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent / 'enhanced'
META = json.loads((ROOT / 'register.json').read_text())
PAPER = (250, 248, 241)
# Our fixed, known render is just above Pillow's generic warning level.
Image.MAX_IMAGE_PIXELS = max(Image.MAX_IMAGE_PIXELS or 0, META['w'] * META['h'] * META['ratio']**2 + 1)

def equal_earth(lon, lat):
    m = math.sqrt(3) / 2
    t = math.asin(m * math.sin(math.radians(lat)))
    s = t*t
    p = s**3
    den = m * (1.340264 + 3*(-.081106)*s + p*(7*.000893 + 9*.003796*s))
    return (math.radians(lon)*math.cos(t)/den, t*(1.340264-.081106*s+p*(.000893+.003796*s)))

REFERENCE = equal_earth(4, 44)
PLANE_STEP = equal_earth(5, 44)[0] - REFERENCE[0]

def camera_sample(center, zoom, film_css=(960, 540)):
    cx, cy = equal_earth(*center)
    dx = META['dx'] * 2**(zoom - META['zoom'])
    p = dx / PLANE_STEP
    return {'dx': dx, 'origin': (film_css[0]/2 + (REFERENCE[0]-cx)*p,
                                 film_css[1]/2 + (cy-REFERENCE[1])*p)}

@functools.lru_cache(maxsize=2)
def _bitmap(level):
    im = Image.open(ROOT / f'plate-{level}.png')
    im.load()
    return im

def from_sample(sample, size=(1920, 1080), film_css=(960, 540)):
    """Use a native map origin [4,44] and dx measured in CSS px per longitude degree."""
    pixel_ratio = size[0] / film_css[0]
    if abs(size[1]/film_css[1]-pixel_ratio) > 1e-5:
        raise ValueError('Use a uniform device pixel ratio')
    css_step = META['dx'] / sample['dx']
    input_step = css_step * META['ratio'] / pixel_ratio
    factor = next(n for n in [8, 4, 2, 1] if input_step >= n or n == 1)
    im = _bitmap(factor)
    k = META['ratio'] / factor
    dx = input_step / factor
    x0, y0 = [(a - css_step*b)*k for a, b in zip(META['origin'], sample['origin'])]
    x1, y1 = x0 + dx*size[0], y0 + dx*size[1]
    if x0 >= 0 and y0 >= 0 and x1 <= im.width and y1 <= im.height:
        return im.resize(size, Image.Resampling.LANCZOS, box=(x0,y0,x1,y1))
    return im.transform(size, Image.Transform.AFFINE, (dx,0,x0,0,dx,y0),
                        Image.Resampling.BICUBIC, fillcolor=PAPER)

def get_frame(center, z, size=(1920, 1080), film_css=(960, 540)):
    return from_sample(camera_sample(center, z, film_css), size, film_css)
