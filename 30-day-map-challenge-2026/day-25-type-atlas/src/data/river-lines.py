"""Rebuild the NYC writing baselines with shapely, requests and mapbox-vector-tile."""
import json
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import mapbox_vector_tile
import requests
from shapely import make_valid
from shapely.geometry import GeometryCollection, LineString, box, shape
from shapely.ops import transform, unary_union

# Editorial centre lines, followed from mouth to head. Offsets are clipped to Tileflow water.
rivers = {
    'Hudson River': (1700, [(-74.028,40.697),(-74.0266,40.710),(-74.0203,40.733),(-74.0138,40.752),(-74.004,40.770),(-73.989,40.789),(-73.975,40.805),(-73.960,40.824),(-73.946,40.846),(-73.941,40.874),(-73.925,40.901)]),
    'East River': (820, [(-74.0142,40.6946),(-74.009,40.7003),(-74.000,40.7048),(-73.9925,40.7083),(-73.9797,40.7108),(-73.9695,40.7139),(-73.966,40.7207),(-73.9663,40.7306),(-73.962,40.739),(-73.956,40.748),(-73.946,40.7618),(-73.943,40.771),(-73.938,40.780),(-73.930,40.786),(-73.919,40.793)]),
    'Harlem River': (360, [(-73.929,40.790),(-73.931,40.799),(-73.93,40.807),(-73.933,40.816),(-73.9345,40.828),(-73.933,40.839),(-73.924,40.852),(-73.918,40.867),(-73.914,40.874)]),
}
R = 6378137
def merc(lon, lat):
    return R*math.radians(lon), R*math.asinh(math.tan(math.radians(lat)))
def ll(x, y):
    return [round(math.degrees(x/R),6), round(math.degrees(math.atan(math.sinh(y/R))),6)]

zoom = 13
extent = math.pi*R
span = 2*extent/(2**zoom)
template = requests.get('https://api.tileflow.dev/tiles/world/tiles.json', timeout=15).json()['tiles'][0]
def shoreline(tile):
    x,y = tile
    response = requests.get(template.format(z=zoom,x=x,y=y),timeout=45)
    if response.status_code in (204,404): return []
    response.raise_for_status()
    layer = mapbox_vector_tile.decode(response.content).get('water')
    if not layer: return []
    west = -extent+x*span
    south = extent-(y+1)*span
    scale = span/layer['extent']
    bounds = box(west,south,west+span,south+span)
    shapes = []
    for feature in layer['features']:
        polygon = transform(lambda a,b:(west+a*scale,south+b*scale),shape(feature['geometry']))
        shapes.append(make_valid(polygon).intersection(bounds))
    return shapes

channels = [(name,width,LineString([merc(*p) for p in coords])) for name,(width,coords) in rivers.items()]
region = unary_union([line.buffer(width) for _,width,line in channels])
w,s,e,n = region.bounds
tiles = [(x,y) for x in range(int((w+extent)/span),int((e+extent)/span)+1)
         for y in range(int((extent-n)/span),int((extent-s)/span)+1)
         if region.intersects(box(x*span-extent,extent-(y+1)*span,(x+1)*span-extent,extent-y*span))]
with ThreadPoolExecutor(max_workers=6) as pool:
    water = unary_union([g for parts in pool.map(shoreline,tiles) for g in parts])
features = []
def line_parts(geometry):
    if geometry.geom_type == 'LineString': yield geometry
    elif hasattr(geometry,'geoms'):
        for part in geometry.geoms: yield from line_parts(part)
# Actual banks give the word-rivers a continuous edge, including small piers and islands.
coast = [list(map(lambda p:ll(*p),line.simplify(4).coords))
         for line in line_parts(water.boundary.intersection(region.buffer(-35))) if line.length>45]
Path(__file__).with_name('banks.json').write_text(json.dumps({
    'type':'FeatureCollection','features':[{'type':'Feature','properties':{},'geometry':{'type':'MultiLineString','coordinates':coast}}]
},separators=(',',':')))
used = GeometryCollection()
for name,width,axis in channels:
    corridor = axis.buffer(width,cap_style='flat')
    ink_area = water.intersection(corridor).difference(used)
    used = used.union(corridor)
    for row in range(-(width//5),width//5+1):
        rank = max(9, 19-((abs(row) & -abs(row)).bit_length()-1)) if row else 9
        baseline = axis.offset_curve(row*5,quad_segs=4,join_style='round') if row else axis
        segments = [list(map(lambda p:ll(*p), line.simplify(2).coords)) for line in line_parts(baseline.intersection(ink_area)) if line.length>28]
        if segments:
            features.append({'type':'Feature','properties':{'river':name,'rank':rank},'geometry':{'type':'MultiLineString','coordinates':segments}})
out = Path(__file__).with_name('river-lines.json')
out.write_text(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':')))
print(f'{len(tiles)} water tiles · {len(features)} baselines · {out.stat().st_size:,} bytes')
