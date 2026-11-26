"""Generate the local Madrid navigation levels from a redistributable OSM extract.
GeoPackage (Geofabrik, 2026-11-23); no Tileflow tile is an input. Outputs ODbL.
"""
from pathlib import Path
import sqlite3,struct,json,math,gzip,collections,hashlib
work=Path(__file__).resolve().parent;out=work.parents[1]/'public/detail/madrid-navigation'
out.mkdir(exist_ok=True)
db=sqlite3.connect(work/'madrid.gpkg');db.row_factory=sqlite3.Row
region=(-4.12,40.02,-3.22,40.82);classes=collections.Counter();banks={'a':collections.defaultdict(list),'b':collections.defaultdict(list)}
road_hi={'motorway','trunk','primary','secondary','tertiary','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link'}
road_lo={'residential','living_street','unclassified','pedestrian','service','footway','cycleway'}
def intersects(a,b):return a[0]<=b[2] and a[2]>=b[0] and a[1]<=b[3] and a[3]>=b[1]
def wkb(data):
 flags=data[3];start=8+[0,32,48,48,64][flags>>1&7];pos=start
 def parse():
  nonlocal pos
  endian='<' if data[pos] else '>';k=struct.unpack_from(endian+'I',data,pos+1)[0];pos+=5
  def read(fmt):
   nonlocal pos
   vals=struct.unpack_from(endian+fmt,data,pos);pos+=struct.calcsize(endian+fmt);return vals
  def point():return tuple(round(v*1e5) for v in read('dd'))
  def line():return [point() for i in range(read('I')[0])]
  if k==1:return point()
  if k==2:return line()
  if k==3:return [line() for i in range(read('I')[0])]
  if k in (4,5,6):return [parse() for i in range(read('I')[0])]
  raise ValueError(k)
 return parse()
def simple(points,tol):
 if len(points)<3:return points
 ids={0,len(points)-1};stack=[(0,len(points)-1)]
 while stack:
  i,j=stack.pop()
  if j==i+1:continue
  x,y=points[i];dx,dy=points[j][0]-x,points[j][1]-y;l=dx*dx+dy*dy or 1;best=tol*tol;idx=-1
  for k in range(i+1,j):
   px,py=points[k][0]-x,points[k][1]-y;t=max(0,min(1,(px*dx+py*dy)/l))
   d=(px-t*dx)**2+(py-t*dy)**2
   if d>best:best=d;idx=k
  if idx>0:ids.add(idx);stack.extend(((i,idx),(idx,j)))
 return [points[i] for i in sorted(ids)]
def delta(line,tol):
 a=simple(line,tol);row=list(a[0])
 for p,q in zip(a,a[1:]):row.extend((q[0]-p[0],q[1]-p[1]))
 return row
def cells(bbox,tier):
 size=0.18 if tier=='a' else .075
 x0,y0,x1,y1=region
 for i in range(max(0,math.floor((bbox[0]-x0)/size)),min(math.ceil((x1-x0)/size)-1,math.floor((bbox[2]-x0)/size))+1):
  for j in range(max(0,math.floor((bbox[1]-y0)/size)),min(math.ceil((y1-y0)/size)-1, math.floor((bbox[3]-y0)/size))+1):
   yield f'{i}-{j}'
def row(table):
 return db.execute('select * from gis_osm_'+table+'_free')
def unpack_box(g):
 if (g[3]>>1)&7:
  x,X,y,Y=struct.unpack_from('<4d' if g[3]&1 else '>4d',g,8);return (x,y,X,Y)
 else:
  pt=wkb(g);return (pt[0]/1e5,pt[1]/1e5,pt[0]/1e5,pt[1]/1e5)
tables=['roads','places','waterways','water_a','landuse_a']
source_counts=collections.Counter()
for kind,t in enumerate(tables):
 for f in row(t):
  cl=f['fclass'];name=f['name'] or '';ref='';structure='';tier='a'
  if kind==0:
   if cl not in road_hi|road_lo:continue
   if cl in {'footway','cycleway','service'} and not name:continue
   if cl in road_lo:tier='b'
   structure='bridge' if f['bridge']=='T' else 'tunnel' if f['tunnel']=='T' else '';ref=f['ref'] or ''
  if kind==1 and (not name or cl not in {'city','town','village','hamlet','suburb'}):continue
  if kind==2 and cl!='river' and not name:continue
  if kind==2 and cl not in {'river','canal'}:tier='b'
  if kind==3 and not cl in {'water','reservoir','riverbank'}:continue
  if kind==4 and cl not in {'park','forest','recreation_ground','meadow','grass'}:continue
  geom=f['geom'];box=unpack_box(geom)
  if not intersects(box,region):continue
  if kind>=3:
   area=(box[2]-box[0])*(box[3]-box[1])*9.4e9
   if area<(140 if kind==3 else 1400):continue
   if area<(19000 if kind==3 else 75000):tier='b'
  coords=wkb(geom)
  if kind==1:loc=list(coords)
  elif kind==0 or kind==2:
   loc=delta(coords,1.25 if tier=='b' else 1.85)
   if len(loc)<4:continue
  else:
   loc=[]
   for poly in coords:
    if not poly:continue
    exterior=delta(poly[0],1.6)
    if len(exterior)<8:continue
    holes=[line for ring in poly[1:] if len(line:=delta(ring,1.6))>=8]
    loc.append([exterior,*holes])
   if not loc:continue
  fid=f['fid']
  rec=[kind,fid,cl,name,ref,structure,[round(d*1e5) for d in box],loc]
  for cell in cells(box,tier):banks[tier][cell].append(rec)
  source_counts[t]+=1;classes[cl]+=1
tot=0;features=0
for tier,blocks in banks.items():
 for name,recs in blocks.items():
  body=gzip.compress(json.dumps(recs,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=6,mtime=0);tot+=len(body);features+=len(recs);(out/f'{tier}{name}.gz').write_bytes(body)
manifest={'source':'© OpenStreetMap contributors, extracted by Geofabrik','date':'2026-11-23','license':'Open Database License 1.0','licenseUrl':'https://opendatacommons.org/licenses/odbl/1-0/','copyright':'https://www.openstreetmap.org/copyright','sourceUrl':'https://download.geofabrik.de/europe/spain/madrid-261123-free.gpkg.zip','coverage':region,'cells':{t:sorted(v.keys()) for t,v in banks.items()},'features':source_counts,'sha256':hashlib.sha256((work/'madrid-open-gpkg.zip').read_bytes()).hexdigest()}
(out/'index.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False));print('Bytes',tot,'Unique',source_counts,'Cells',[(k,len(v)) for k,v in banks.items()])
