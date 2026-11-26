"""Print the atlas's moving asterisk and its trail of middle dots."""
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


FONT = Path(__file__).resolve().parent / 'NotoSans-Regular.ttf'
PAPER = (250, 248, 241)
INK = (156, 59, 37)
SUPERSAMPLE = 4
TRAIL_LENGTH = 400


@lru_cache(maxsize=16)
def _stamp(character, size, stroke):
    font = ImageFont.truetype(str(FONT), size)
    left, top, right, bottom = font.getbbox(character, stroke_width=stroke)
    stamp = Image.new('RGBA', (right-left+4, bottom-top+4))
    draw = ImageDraw.Draw(stamp)
    draw.text((2-left, 2-top), character, font=font, fill=(*INK, 255),
              stroke_width=stroke, stroke_fill=(*PAPER, 237))
    return stamp.crop(stamp.getchannel('A').getbbox())


def render_route(plate, positions, at, amplitude):
    """Draw on a PIL plate. Positions are projected pixels, at is a sample index."""
    opacity = float(np.clip(amplitude, 0, 1))
    if opacity < .001 or len(positions) == 0:
        return plate
    scale = plate.width / 1920
    projected = np.asarray(positions, dtype=float)
    cursor = float(np.clip(at, 0, len(projected)-1))
    index = int(cursor)
    head = projected[index] + (cursor-index)*(projected[min(index+1, len(projected)-1)]-projected[index])
    tail = np.vstack((head, projected[index::-1]))
    cumulative = np.r_[0, np.cumsum(np.linalg.norm(np.diff(tail, axis=0), axis=1))]
    length = TRAIL_LENGTH * scale
    distances = np.arange(19*scale, min(length, cumulative[-1]), 14*scale)
    dots = np.column_stack([np.interp(distances, cumulative, axis) for axis in tail.T])
    centers = np.vstack((dots, head))

    # Centring the actual ink and drawing at quarter-pixel precision avoids
    # snapping the small dots as the projected path moves under the camera.
    margin = 22*scale + 3
    x0, y0 = np.maximum(np.floor(centers.min(axis=0)-margin), 0).astype(int)
    x1, y1 = np.minimum(np.ceil(centers.max(axis=0)+margin), plate.size).astype(int)
    if x1 <= x0 or y1 <= y0:
        return plate
    sample = SUPERSAMPLE
    overlay = Image.new('RGBA', ((x1-x0)*sample, (y1-y0)*sample))
    dot = _stamp('·', max(1, round(47*scale*sample)), max(1, round(1.1*scale*sample)))
    star = _stamp('*', max(1, round(50*scale*sample)), max(1, round(1.9*scale*sample)))

    def print_glyph(point, glyph, strength):
        alpha = round(255*opacity*strength)
        if alpha == 0:
            return
        mark = glyph
        if alpha < 255:
            mark = glyph.copy()
            mark.putalpha(glyph.getchannel('A').point(lambda v: v*alpha/255))
        xy = np.rint((point-[x0, y0])*sample-np.array(mark.size)/2).astype(int)
        overlay.alpha_composite(mark, (int(xy[0]), int(xy[1])))

    # The last specks reach zero opacity before disappearing. The leading fourth
    # stays firm enough to read when the atlas is watched at phone width.
    fade = np.clip((distances/length-.13)/.87, 0, 1)
    for point, strength in zip(dots, 1-fade*fade*(3-2*fade)):
        print_glyph(point, dot, strength)
    print_glyph(head, star, 1)
    ink = overlay.resize((x1-x0, y1-y0), Image.Resampling.LANCZOS)

    # Place names use the atlas's dark green ink. Let those letters overprint
    # the tail when the itinerary crosses a name, retaining the guiding star.
    background = np.asarray(plate.crop((x0, y0, x1, y1)).convert('RGB'), dtype=np.int16)
    red, green, blue = np.moveaxis(background, 2, 0)
    label = np.minimum(np.clip((124-red)/78, 0, 1), np.clip((green-red-7)/19, 0, 1))
    label *= np.clip((green-blue+3)/8, 0, 1)
    star_radius = np.ceil(np.array(star.size)/(2*sample)+2).astype(int)
    cx, cy = np.rint(head-[x0, y0]).astype(int)
    label[max(0, cy-star_radius[1]):max(0, cy+star_radius[1]+1),
          max(0, cx-star_radius[0]):max(0, cx+star_radius[0]+1)] = 0
    ink.putalpha(Image.fromarray(np.rint(np.asarray(ink.getchannel('A'))*(1-label)).astype('uint8')))
    if plate.mode == 'RGBA':
        plate.alpha_composite(ink, (int(x0), int(y0)))
    else:
        plate.paste(ink, (int(x0), int(y0)), ink)
    return plate
