"""Derive spaced indoor label alternatives from official IGN administrative polygons."""
from pathlib import Path
from math import cos, radians, sqrt
from hashlib import sha256
from urllib.parse import urlencode
import json, sys
import numpy as np
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parents[2];geo=root/'scripts/corona-region/geodata';dest=root/'public/detail/iberia-regions.json'
source=geo/'ign-autonomias.geojson'
params={'nationallevel':'https://inspire.ec.europa.eu/codelist/AdministrativeHierarchyLevel/2ndOrder','limit':'25','f':'json'}
url='https://api-features.ign.es/collections/administrativeunit/items?'+urlencode(params)
if not source.exists():
    from urllib.request import urlopen
    geo.mkdir(parents=True,exist_ok=True)
    with urlopen(url,timeout=120) as r, source.open('wb') as f:
        import shutil
        shutil.copyfileobj(r,f)
raw=json.loads(source.read_bytes());assert raw['numberMatched']==20
entries=[];validation=[]

def simplify(a,tol):
    flags=np.zeros(len(a),dtype=bool);flags[[0,-1]]=True;stack=[(0,len(a)-1)]
    while stack:
        i,j=stack.pop()
        if j<=i+1:continue
        pi=a[i];v=a[j]-pi;w=a[i+1:j]-pi;length=float(v@v)
        if length:
            pos=np.clip((w[:,0]*v[0]+w[:,1]*v[1])/length,0,1);w=w-pos[:,None]*v
        distances=w[:,0]**2+w[:,1]**2;key=int(distances.argmax())
        if distances[key]>tol*tol:
            k=i+1+key;flags[k]=True;stack.extend(((i,k),(k,j)))
    return a[flags]

def inside(ring,x,y):
    a=ring[:-1];b=ring[1:];active=(a[:,1]>y)!=(b[:,1]>y)
    if not active.any():return False
    a=a[active];b=b[active]
    return int(np.count_nonzero(x<a[:,0]+(y-a[:,1])*(b[:,0]-a[:,0])/(b[:,1]-a[:,1])))%2==1

def boundary_km(rings,coords):
    aa=np.concatenate([r[:-1] for r in rings]);bb=np.concatenate([r[1:] for r in rings]);vv=bb-aa
    length=np.sum(vv*vv,axis=1);length[length==0]=1
    result=[]
    for point in coords:
        dif=point-aa;t=np.clip(np.sum(dif*vv,axis=1)/length,0,1)
        residual=dif-t[:,None]*vv
        result.append(float(np.sqrt(np.min(np.sum(residual*residual,axis=1)))))
    return result

def depth(mask):
    h,w=mask.shape
    cost=np.where(mask,1e4,0.0)
    diagonal=sqrt(2)
    for y in range(1,h-1):
        for x in range(1,w-1):
            if mask[y,x]:cost[y,x]=min(cost[y,x],cost[y-1,x]+1,cost[y,x-1]+1,cost[y-1,x-1]+diagonal,cost[y-1,x+1]+diagonal)
    for y in range(h-2,0,-1):
        for x in range(w-2,0,-1):
            if mask[y,x]:cost[y,x]=min(cost[y,x],cost[y+1,x]+1,cost[y,x+1]+1,cost[y+1,x+1]+diagonal,cost[y+1,x-1]+diagonal)
    return cost

for f in raw['features']:
    name=f['properties']['nameunit'];tag=f['properties']['nationalcode']
    if name=='Territorios no asociados a ninguna autonomía':continue
    geom=f['geometry'];assert geom['type'] in ('Polygon','MultiPolygon')
    polys=geom['coordinates'] if geom['type']=='MultiPolygon' else [geom['coordinates']]
    polygons=[[np.asarray(r,dtype=float)[:,:2] for r in poly if len(r)>=4] for poly in polys];polygons=[p for p in polygons if p]
    ext=np.vstack([p[0] for p in polygons]);low=ext.min(axis=0);high=ext.max(axis=0)
    # The northerly latitude gives a conservative longitude-to-km conversion
    # for the local distance used to check whether a label fits its region.
    scale=np.array([111.0*cos(radians(high[1])),110.57])
    extent=(high-low)*scale;cell=max(extent)/155;dims=(np.ceil(extent/cell)+8).astype(int);mask=Image.new('1',tuple(dims),0)
    native=[[((r-low)*scale) for r in poly] for poly in polygons]
    simplified=[]
    for poly in native:
        large=Image.new('1',tuple(dims),0);draw=ImageDraw.Draw(large);parts=[]
        for j,r in enumerate(poly):
            # A label alternative is checked against the complete ring later.
            # This simplification is only used to generate the candidate lattice.
            a=simplify(r,max(cell*.13,.015))
            if len(a)<4:continue
            coords=[tuple(t) for t in (a/cell+3)]
            draw.polygon(coords,fill=1 if j==0 else 0)
            parts.append([[round(v[0],4),round(v[1],4)] for v in a/scale+low])
        mask.paste(large,(0,0),large)
        if parts:simplified.append(parts)
    bits=np.asarray(mask,dtype=bool);dist=depth(bits)
    y,x=np.where(bits & (dist>=max(2.5,dist.max()*.19)))
    d=dist[y,x];p=np.stack([x,y],axis=1);spread=np.full(len(p),1e10);selections=[]
    for i in range(min(24,len(p))):
        rank=d if i==0 else np.minimum(spread,1.6*d)
        pick=int(np.argmax(rank));selections.append(p[pick]);spread=np.minimum(spread,np.hypot(x-x[pick],y-y[pick]))
    km=(np.asarray(selections)-3)*cell
    nearest=boundary_km([r for poly in native for r in poly],km)
    alternatives=[]
    for xy,distance in zip(km,nearest):
        if any(inside(poly[0],*xy) and not any(inside(r,*xy) for r in poly[1:]) for poly in native):
            lon,lat=xy/scale+low;alternatives.append([round(lon,5),round(lat,5),round(distance,1)])
    assert len(alternatives)>=20,(name,len(alternatives))
    entity={'name':name,'id':f['id'],'bbox':[round(k,5) for k in [*low,*high]],'anchors':alternatives}
    entries.append(entity);validation.append({'name':name,'id':f['id'],'geometry':{'type':'MultiPolygon','coordinates':simplified}})
    print(name,len(alternatives),alternatives[0],flush=True)
dest.write_text(json.dumps(entries,separators=(',',':'),ensure_ascii=False)+'\n')
(geo/'ign-simplified.json').write_text(json.dumps(validation,separators=(',',':'),ensure_ascii=False))
provenance={'source':url,'dataset':'Base de Datos de Divisiones Administrativas de España, Instituto Geográfico Nacional','attribution':'Obra derivada de BDLJE CC-BY 4.0 ign.es','metadata':'https://centrodedescargas.cnig.es/CentroDescargas/limites-municipales-provinciales-autonomicos','retrieved':'2026-11-25','sourceSHA256':sha256(source.read_bytes()).hexdigest(),'units':len(entries),'anchorsPerUnit':24,'distance':'Conservative local equirectangular distance in km from the point to the closest segment of the native IGN polygon, including holes. Rounded to 0.1 km. These are derived cartographic positions, not official label stations.'}
(geo/'ign-provenance.json').write_text(json.dumps(provenance,indent=2,ensure_ascii=False)+'\n')
