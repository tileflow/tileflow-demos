"""Build the regional atlas gazetteer from Natural Earth 1:10m editorial geography.

Requires pyshp and Shapely 2. Source archives are cached locally and verified by hash.
The renderer receives small shared administrative arcs instead of filled polygons.
"""
from collections import defaultdict
from hashlib import sha256
from io import BytesIO
import json
import math
from pathlib import Path
import sys
import zipfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'scripts/world/lib'))
import shapefile
from shapely.geometry import shape, Point, MultiLineString, box
from shapely.ops import linemerge, unary_union, polylabel
from shapely.affinity import scale
from shapely import make_valid

# Wide enough for the margin of the peninsular sheet and its neighbouring shores.
EXTENT = (-12, 30.5, 8.5, 48.5)
CLIP = box(*EXTENT)
# The Bay of Biscay sheet includes the French mainland. Keep the original
# Iberian and North African survey, then extend the French drainage and cities.
FRENCH_EXTENT = (-5.2, 41.2, 9.7, 51.2)
FRENCH_CLIP = box(*FRENCH_EXTENT)
SURVEY = CLIP.union(FRENCH_CLIP)
SOURCES = {
    'rivers': ('physical', 'ne_10m_rivers_lake_centerlines', 'ded71b01870855ccfe19b51f2ec14c9bb48fae23c0e9f3c11974d426433b5c38'),
    'states': ('cultural', 'ne_10m_admin_1_states_provinces', 'efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05'),
    'cities': ('cultural', 'ne_10m_populated_places_simple', '2963ee08f7743f13f37d5243acd77a2f7a510e26a36c7e04b920f1b381f2b251'),
}

def reader(key):
    section, dataset, checksum = SOURCES[key]
    path = HERE / (dataset + '.zip')
    if key == 'cities':
        path = ROOT / 'scripts/world/route_cities.zip'
    if not path.exists():
        url = f'https://naturalearth.s3.amazonaws.com/10m_{section}/{dataset}.zip'
        with urlopen(url, timeout=90) as response:
            path.write_bytes(response.read())
    raw = path.read_bytes()
    if sha256(raw).hexdigest() != checksum:
        raise ValueError(f'{path} differs from the source edition used for this atlas.')
    with zipfile.ZipFile(BytesIO(raw)) as archive:
        parts = {ext: BytesIO(archive.read(dataset + '.' + ext)) for ext in ['shp','shx','dbf']}
    return shapefile.Reader(**parts, encoding='utf8')

def rounded(coords):
    return [[round(x,4), round(y,4)] for x,y,*_ in coords]

def pieces(g):
    if g.geom_type in ('LineString','Polygon'):
        yield g
    elif hasattr(g,'geoms'):
        for piece in g.geoms:
            yield from pieces(piece)

def lines(g, tolerance=.009):
    candidates = [p for p in pieces(g) if p.geom_type=='LineString' and not p.is_empty]
    if not candidates:
        return []
    merged = linemerge(MultiLineString(candidates))
    # Suppress microscopic junction slivers but retain islands of autonomous territory.
    return [rounded(p.simplify(tolerance).coords) for p in pieces(merged) if p.length>.04]

def source_city_names():
    # Local forms used on this regional sheet.
    return {'Poitier':'Poitiers','Lisbon':'Lisboa','Seville':'Sevilla','Castello':'Castelló de la Plana','La Coruña':'A Coruña',
        'Vitoria':'Vitoria-Gasteiz','Andorra':'Andorra la Vella','Viana Do Castelo':'Viana do Castelo',
        'Granada\u200e':'Granada','Tangier':'Tanger','Fez':'Fès','Algiers':'Alger'}

def cities():
    aliases=source_city_names()
    capitals={'Paris','Madrid','Lisboa','Rabat','Alger'}
    large={'Barcelona','Porto','Sevilla','Valencia','Zaragoza','Bilbao','Málaga','Toulouse','Bordeaux','Lyon','Nantes','Lille','Casablanca','Marseille','Oran','Tanger'}
    centres={'Valladolid','Salamanca','Badajoz','Cáceres','Mérida','Évora','Coimbra','Córdoba','Toledo','Granada',
        'Ciudad Real','Zamora','Cuenca','Murcia','Faro','Vigo','Santiago de Compostela','Oviedo','León','Clermont-Ferrand','Montpellier','Rennes','Strasbourg','Rouen','Fès','Oujda','Tlemcen'}
    places=[]
    def add(name,point,population,country):
        # An editorial rank, separate from census data, keeps regional capitals
        # legible even when a larger neighbour lies just across the frontier.
        rank=0 if name in capitals else 1 if name in large else 2 if name in centres or population>=400000 else 3 if population>=65000 else 4
        places.append(dict(name=name,point=rounded([point])[0],rank=rank,population=population,country=country))
    for row in reader('cities').iterShapeRecords(bbox=SURVEY.bounds):
        r=row.record.as_dict()
        point=Point(row.shape.points[0])
        if not (CLIP.covers(point) or r['adm0_a3']=='FRA' and FRENCH_CLIP.covers(point)):continue
        name=aliases.get(r['name'],r['name']).strip('\u200e')
        add(name,row.shape.points[0],r['pop_max'],r['adm0_a3'])
    # Settlement centres missing from the Natural Earth city sample.
    for city in json.loads((HERE/'settlements.json').read_text())['places']:
        add(city['name'],city['point'],city['population'],'ESP')
    return sorted(places,key=lambda a:(a['rank'],-a['population'],a['name']))

def main_regions():
    by_code=defaultdict(list)
    for row in reader('states').iterShapeRecords(bbox=(-9.6,35.9,3.5,43.9)):
        p=row.record.as_dict()
        if p['adm0_a3']=='ESP' and p['region_cod'] and p['region_cod'] not in ('ES.PM','ES.CE','ES.ML','ES.CN'):
            by_code[p['region_cod']].append(make_valid(shape(row.shape.__geo_interface__)))
    return {code:unary_union(parts) for code,parts in by_code.items()}

def administration():
    polygons=main_regions()
    names={'AN':'Andalucía','AR':'Aragón','AS':'Asturias','CB':'Cantabria','CL':'Castilla y León',
           'CM':'Castilla-La Mancha','CT':'Catalunya','EX':'Extremadura','GA':'Galicia','LO':'La Rioja',
           'MD':'Comunidad de Madrid','MU':'Región de Murcia','NA':'Navarra','PV':'País Vasco','VC':'Comunitat Valenciana'}
    areas=[]; boundaries=[]
    for code,geom in sorted(polygons.items()):
        name=names[code[3:]]
        poly=max((p for p in pieces(geom) if p.geom_type=='Polygon'), key=lambda a:a.area)
        # Work in an approximately isotropic local coordinate frame when finding
        # text anchors. Clearance is an inscribed radius in kilometres.
        lon_factor=math.cos(math.radians(poly.centroid.y))
        metric=scale(poly,xfact=lon_factor,origin=(0,0))
        core=polylabel(metric,tolerance=.013)
        candidates=[(core,core.distance(metric.boundary))]
        xmin,ymin,xmax,ymax=metric.bounds
        for iy in range(1,16):
            for ix in range(1,20):
                p=Point(xmin+(xmax-xmin)*ix/20, ymin+(ymax-ymin)*iy/16)
                if metric.contains(p): candidates.append((p,p.distance(metric.boundary)))
        selected=[]
        for p,dist in sorted(candidates,key=lambda pd:-pd[1]):
            if dist<.04 or any(p.distance(q)<max(.23,dist*.65) for q,d in selected):continue
            selected.append((p,dist))
            if len(selected)==8:break
        anchors=[[round(p.x/lon_factor,4),round(p.y,4),round(d*110.5,1)] for p,d in selected]
        areas.append(dict(name=name,point=anchors[0][:2],anchors=anchors,code=code))
        for other,other_geom in sorted(polygons.items()):
            if other<=code or not poly.envelope.intersects(other_geom.envelope):continue
            for arr in lines(geom.boundary.intersection(other_geom.boundary)):
                boundaries.append(dict(arr=arr,areas=[code,other]))
    return areas,boundaries

def rivers():
    chosen={'Duero':1,'Tajo':1,'Tejo':1,'Guadiana':1,'Guadalquivir':1,'Ebro':1,
        'Mio':2,'Minho':2,'Esla':3,'Segre':3,'Zncara':3,'Garonne':1,'Dordogne':2,
        'Rhône':1,'Loire':1,'Tarn':3,'Ariège':3,'Oued Sebou':2,'Moulouya':2}
    french={'Seine':1,'Loire':1,'Garonne':1,'Rhône':1,'Dordogne':2,
        'Sane':2,'Marne':2,'Vienne':2,'Durance':2,'Tarn':3,'Ariège':3}
    chosen.update(french)
    aliases={'Sane':'Saône','Mio':'Miño','Zncara':'Záncara','Oued Sebou':'Sebou'}
    portugal=unary_union([make_valid(shape(row.shape.__geo_interface__))
        for row in reader('states').iterShapeRecords(bbox=(-9.6,36.9,-6.0,42.3))
        if row.record['adm0_a3']=='PRT'])
    paths=[]
    for row in reader('rivers').iterShapeRecords(bbox=SURVEY.bounds):
        r=row.record.as_dict();key=r['name']
        if key not in chosen:continue
        geom=shape(row.shape.__geo_interface__).intersection(FRENCH_CLIP if key in french else CLIP)
        if key=='Duero':
            parts=[('Douro',geom.intersection(portugal)),('Duero',geom.difference(portugal))]
        else:
            parts=[(aliases.get(key,key),geom)]
        for name,path in parts:
            for arr in lines(path,.0055):
                paths.append(dict(name=name,arr=arr,rank=chosen[key]))
    return paths

detail = ROOT/'public/detail'
# Keep the original globe label vocabulary for the adjacent portions of wide screens.
world_labels = json.loads((detail/'natural-earth.json').read_text())['labels']
labels = {kind: [entry for entry in world_labels[kind]
                 if -65 <= entry['point'][0] <= 70 and 0 <= entry['point'][1] <= 85]
          for kind in ('cities','countries')}
areas, boundaries = administration()
data=dict(cities=cities(),rivers=rivers(),areas=areas,boundaries=boundaries,labels=labels)
dest=detail/'iberia-middle.json'
dest.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
print({k:len(v) for k,v in data.items()},dest.stat().st_size)
