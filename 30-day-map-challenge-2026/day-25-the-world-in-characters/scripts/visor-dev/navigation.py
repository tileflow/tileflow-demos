"""Compile visible Natural Earth 1:10m road and settlement records into local regional blocks.
Inputs are public-domain Natural Earth downloads in scripts/world. The compressed files
hold WGS84 coordinates and display ranks; they contain no imagery or provider street tiles.
"""
from pathlib import Path
from collections import defaultdict,Counter
import hashlib,json,math,gzip,sys
root=Path(__file__).resolve().parents[2]
data=root/'scripts/world';out=root/'public/detail/navigation';out.mkdir(exist_ok=True)
sys.path.insert(0,str(data/'lib'))
import shapefile
size=12;ny=15;nx=30
chunks=defaultdict(lambda:{'r':[],'c':[]});roads=0
def cell(x,y):return (min(nx-1,max(0,math.floor((x+180)/size))),min(ny-1,max(0,math.floor((90-y)/size))))
def simplified(points,eps=.0028):
    if len(points)<3:return list(points)
    result=[False]*len(points);result[0]=result[-1]=True;stack=[(0,len(points)-1)]
    while stack:
        i,j=stack.pop();x,y=points[i];a,b=points[j];dx,dy=a-x,b-y;s=dx*dx+dy*dy;largest=eps*eps;k=-1
        for m in range(i+1,j):
            u,v=points[m];t=min(1,max(0,((u-x)*dx+(v-y)*dy)/s)) if s else 0;d=(u-x-t*dx)**2+(v-y-t*dy)**2
            if d>largest:largest=d;k=m
        if k>=0:result[k]=True;stack.append((i,k));stack.append((k,j))
    return [p for p,keep in zip(points,result) if keep]
def encode(points):
    row=[];px=py=0
    for x,y in points:
        u,v=round(x*10000),round(y*10000)
        if row and (u,v)==(px,py):continue
        row.extend((u-px,v-py));px,py=u,v
    return row
for feat in shapefile.Reader(str(data/'roads.zip')).iterShapeRecords():
    r=feat.record
    if r.ignore or 'Ferry' in r.type or r.level=='U/C':continue
    rank=r.scalerank;tier=0 if r.expressway or r.type in ('Major Highway','Beltway') else 1 if r.type=='Secondary Highway' or rank<=6 else 2
    minz=max(r.min_zoom or 0,(5.,6.,7.4)[tier])
    name=(r.label or r.local or r.name or '').strip()
    if name.startswith('_') or len(name)>30:name=''
    pts=feat.shape.points;parts=list(feat.shape.parts)+[len(pts)]
    for start,end in zip(parts,parts[1:]):
        line=simplified(pts[start:end]);row=encode(line)
        if len(row)<4:continue
        # No segment can span the entire map at the antimeridian.
        cuts=[0]+[i for i in range(1,len(line)) if abs(line[i][0]-line[i-1][0])>180]+[len(line)]
        for lo,hi in zip(cuts,cuts[1:]):
            piece=line[lo:hi]
            for i in range(0,len(piece)-1,96):
                part=piece[i:i+97];xs,ys=zip(*part);bbox=[min(xs),min(ys),max(xs),max(ys)]
                x0,y1=cell(bbox[0],bbox[1]);x1,y0=cell(bbox[2],bbox[3])
                record=[roads,tier,round(minz*10),round(max(6.3,r.min_label or 0)*10),name,[round(q*10000) for q in bbox],encode(part)];roads+=1
                for x in range(x0,x1+1):
                    for y in range(y0,y1+1):chunks[(x,y)]['r'].append(record)
ncity=0
for f in shapefile.Reader(str(data/'route_cities.zip')).iterShapeRecords():
    r=f.record;x,y=f.shape.points[0];name=(r.name or r.nameascii).strip()
    if not name:continue
    ncity+=1;chunks[cell(x,y)]['c'].append([name,round(x*10000),round(y*10000),max(r.pop_max or 0,0),round((r.min_zoom or 0)*10)])
files=[];sizes=[]
for (x,y),chunk in sorted(chunks.items()):
    name=f'{x}-{y}';files.append(name)
    d=gzip.compress(json.dumps(chunk,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=8,mtime=0)
    (out/(name+'.gz')).write_bytes(d);sizes.append(len(d))
index={'cellDegrees':size,'cells':files,'roadParts':roads,'settlements':ncity,
       'attribution':'Natural Earth, public domain. 1:10m roads and populated places simple.',
       'sources':{k:hashlib.sha256((data/(k+'.zip')).read_bytes()).hexdigest() for k in ['roads','route_cities']}}
(out/'index.json').write_text(json.dumps(index,separators=(',',':')))
print('Regional index:',roads,'road segments,',ncity,'settlements,',len(files),'blocks,',sum(sizes),'bytes; largest block:',max(sizes))
