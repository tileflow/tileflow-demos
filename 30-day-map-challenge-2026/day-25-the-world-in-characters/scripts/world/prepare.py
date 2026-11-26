"""Build the longitude/latitude geometry for the worldwide typographic map.

Python 3 with pyshp and Shapely. Input archives come from Natural Earth's public
download host, with pinned file digests recorded in the output manifest.
"""
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import sys
from zipfile import ZipFile

folder = Path(__file__).resolve().parent
sys.path.insert(0, str(folder / 'lib'))
import shapefile
from shapely.geometry import LineString, Polygon
from shapely.ops import linemerge, unary_union
from itineraries import make_routes


sources = {
    'land': ('50m_physical', 'ne_50m_land'),
    'lakes': ('50m_physical', 'ne_50m_lakes'),
    'boundaries': ('50m_cultural', 'ne_50m_admin_0_boundary_lines_land'),
    'rivers': ('50m_physical', 'ne_50m_rivers_lake_centerlines'),
    'roads': ('10m_cultural', 'ne_10m_roads'),
    'countries': ('110m_cultural', 'ne_110m_admin_0_countries'),
    'cities': ('110m_cultural', 'ne_110m_populated_places'),
    'route_cities': ('10m_cultural', 'ne_10m_populated_places_simple'),
}


def reader(key):
    return shapefile.Reader(str(folder / (key + '.zip')))


def pieces(geometry):
    starts = [*geometry.parts, len(geometry.points)]
    return [geometry.points[a:b] for a, b in zip(starts, starts[1:]) if b - a > 1]


def pairs(seq):
    result = []
    for x, y in seq:
        point = [round(x, 3), round(y, 3)]
        if not result or result[-1] != point:
            result.append(point)
    return result


def lineparts(g):
    if g.geom_type == 'LineString':
        return [g]
    return [line for piece in getattr(g, 'geoms', []) for line in lineparts(piece)]


def merged(lines):
    union = unary_union(lines)
    return lineparts(union if union.geom_type == 'LineString' else linemerge(union))


def dissolved(groups, tolerance, minimum):
    result = []
    for name, lines in groups.items():
        for line in merged(lines):
            if line.length >= minimum:
                result.append({'name':name, 'path':pairs(line.simplify(tolerance).coords)})
    return sorted(result, key=lambda s: LineString(s['path']).length, reverse=True)


land, land_holes = [], []
for geometry in reader('land').iterShapes():
    for ring in pieces(geometry):
        polygon = Polygon(ring)
        if polygon.area < .035:
            continue
        coords = pairs(polygon.simplify(.07, preserve_topology=True).exterior.coords)
        if len(coords) < 4:
            continue
        # The shapefile's exterior rings use clockwise orientation.
        if polygon.exterior.is_ccw:
            land_holes.append(coords)
        else:
            land.append(coords)

for feature in reader('lakes').iterShapeRecords():
    if 'Caspian' in (feature.record['name_en'] or feature.record['name']):
        continue  # The land geometry already has this inland sea cut out.
    for ring in pieces(feature.shape):
        lake = Polygon(ring)
        if lake.area >= .56 and not lake.exterior.is_ccw:
            land_holes.append(pairs(lake.simplify(.085, preserve_topology=True).exterior.coords))

boundary_keys, boundaries = set(), []
for geometry in reader('boundaries').iterShapes():
    for section in pieces(geometry):
        path = pairs(LineString(section).simplify(.07).coords)
        if len(path) < 2:
            continue
        key = tuple(tuple(p) for p in path)
        if key not in boundary_keys and key[::-1] not in boundary_keys:
            boundary_keys.add(key)
            boundaries.append(path)

river_groups = defaultdict(list)
for feature in reader('rivers').iterShapeRecords():
    r = feature.record
    name = r['name_en'] or r['name']
    if not name or (r['scalerank'] > 3 and name not in {'Murray','Darling','Orange','Niger','Indus','Yellow River'}):
        continue
    river_groups[name].extend(LineString(s) for s in pieces(feature.shape))
rivers = dissolved(river_groups, .11, 2.5)

road_groups = defaultdict(list)
for feature in reader('roads').iterShapeRecords():
    f = feature.record
    route, region = None, f['continent']
    if f['sov_a3'] == 'USA' and f['level'] == 'Interstate' and f['name'] in {'5','10','40','80','95'}:
        route = 'I-' + f['name']
    elif f['sov_a3'] == 'MEX' and f['name'] in {'15','40'} and f['level'] in {'Federal','Interstate'}:
        route = 'MEX ' + f['name']
    elif region in {'Europe','Asia'} and f['label'] in {'E15','E30','E40','E60','E75','E80','E90'}:
        route = f['label']
    elif region == 'Oceania' and f['label'] == 'SH1':
        route = 'SH 1'
    if route:
        road_groups[route].extend(LineString(s) for s in pieces(feature.shape))
roads = dissolved(road_groups, .075, 1.2)
roads += make_routes(reader, pieces, pairs)

countries = []
for r in reader('countries').iterRecords():
    countries.append({'name':r['NAME_EN'], 'point':[round(r['LABEL_X'],3), round(r['LABEL_Y'],3)],'rank':r['LABELRANK'], 'code':r['ADM0_A3']})
cities = []
for feature in reader('cities').iterShapeRecords():
    r = feature.record
    cities.append({'name':r['NAME'], 'point':pairs(feature.shape.points)[0], 'rank':r['SCALERANK'], 'population':r['POP_MAX']})

manifest = {}
for key, (collection, stem) in sources.items():
    archive = folder / (key + '.zip')
    with ZipFile(archive) as src:
        version = src.read(stem + '.VERSION.txt').decode().strip()
    manifest[key] = {'url':f'https://naturalearth.s3.amazonaws.com/{collection}/{stem}.zip','version':version,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
meta = {'source':'Natural Earth','license':'Public domain','terms':'https://www.naturalearthdata.com/about/terms-of-use/', 'crs':'WGS84 longitude, latitude','sources':manifest,'scope':'World including Antarctica. Boundaries follow Natural Earth default de facto linework. Use seamLandIndices to avoid drawing antimeridian/polar closure edges. Selected roads and rivers are generalized. The twelve city-pair itineraries follow the shortest connected paths on the mapped road graph; their labels identify terminals.'}
# The application can omit synthetic ring closure lines at the poles/date line.
coast_exceptions=[]
for index, ring in enumerate(land):
    if any(abs(lon)>179.995 or lat < -89.98 for lon,lat in ring):
        coast_exceptions.append(index)
result = {'meta':meta,'land':land,'landHoles':land_holes,'boundaries':boundaries,'rivers':rivers,'roads':roads,'labels':{'countries':countries,'cities':cities},'seamLandIndices':coast_exceptions}
(folder.parents[1]/'public/detail/natural-earth.json').write_text(json.dumps(result, ensure_ascii=False,separators=(',',':')))
print('bytes', (folder.parents[1]/'public/detail/natural-earth.json').stat().st_size,'land rings',len(land),'holes',len(land_holes),'borders',len(boundaries),'rivers',len(rivers),'roads',len(roads))
print('road labels',dict(Counter(r['name'] for r in roads)),'sources',manifest.keys())
