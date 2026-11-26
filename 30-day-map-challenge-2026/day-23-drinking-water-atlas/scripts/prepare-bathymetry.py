"""Build the small offline bathymetry asset from Natural Earth 1:10m.

Requires shapely 2.x. Pass an optional directory containing the four upstream
GeoJSON files; otherwise they are read from the pinned Natural Earth release.
The exported integer paths are cumulative areas below the stated depths.
"""
import base64
import json
import math
import pathlib
import sys
import urllib.request
from shapely.geometry import box, shape, Polygon
from shapely.geometry.polygon import orient
from shapely.validation import make_valid

BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/'
BANDS = [('K', 200), ('J', 1000), ('H', 3000), ('F', 5000)]
SCALE = 1000

def polygons(geometry):
    if geometry.geom_type == 'Polygon':
        yield geometry
    elif geometry.geom_type in ('MultiPolygon', 'GeometryCollection'):
        for part in geometry.geoms:
            yield from polygons(part)

def uint(buf, n):
    while n > 127:
        buf.append((n & 127) | 128)
        n >>= 7
    buf.append(n)

def ring_points(ring):
    points = []
    coords = ring.coords
    for (x, y), (nx, ny) in zip(coords, coords[1:]):
        # Keep parallel segments aligned across the source's polygon cuts when
        # an orthographic renderer resamples them as great-circle arcs.
        count = max(1, math.ceil(max(abs(nx-x), abs(ny-y)) / 1.2))
        for i in range(count):
            p = (round((x+(nx-x)*i/count)*SCALE), round((y+(ny-y)*i/count)*SCALE))
            if not points or points[-1] != p:
                points.append(p)
    return points

out = {}
for letter, depth in BANDS:
    name = f'ne_10m_bathymetry_{letter}_{depth}.geojson'
    data = (pathlib.Path(sys.argv[1], name).read_bytes() if len(sys.argv) > 1 else urllib.request.urlopen(BASE + name).read())
    paths = []
    for feature in json.loads(data)['features']:
        for p in polygons(shape(feature['geometry'])):
            if p.area < (.045 if depth<3000 else .105):
                continue
            p = p.simplify(.061 if depth<3000 else .093, preserve_topology=True)
            if not p.is_valid:
                p = make_valid(p)
            x1, y1, x2, y2 = p.bounds
            for col in range(math.floor(x1/40), math.ceil(x2/40)):
                for row in range(math.floor(y1/30), math.ceil(y2/30)):
                    clip = box(col*40,row*30,(col+1)*40,(row+1)*30)
                    for part in polygons(p.intersection(clip)):
                        if part.area < .012:
                            continue
                        part = orient(part, sign=-1)
                        rings=[ring_points(part.exterior)]
                        rings.extend(ring_points(r) for r in part.interiors if Polygon(r).area>.02)
                        rings = [r for r in rings if len(r)>=3]
                        if rings:
                            paths.append(rings)
    buf = bytearray()
    uint(buf, len(paths))
    for rings in paths:
        uint(buf, len(rings))
        for ring in rings:
            uint(buf, len(ring))
            px=py=0
            for x,y in ring:
                for n in (x-px,y-py):
                    uint(buf, 2*n if n>=0 else -2*n-1)
                px,py=x,y
    out[depth] = base64.b64encode(buf).decode('ascii')
    print(f'{depth} m: {len(paths)} polygons, {len(buf):,} bytes')
pathlib.Path(__file__).resolve().parents[1].joinpath('src/bathymetry.paths.json').write_text(json.dumps(out,separators=(',', ':')))
