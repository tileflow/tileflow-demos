"""Prepare shared, simplified municipal boundary arcs and interior district labels.
Source Ayuntamiento de Madrid. Dataset and conditions travel with the published asset.
"""
from pathlib import Path
import json,math,heapq
w=Path(__file__).resolve().parent
raw=json.loads((w/'distritos-oficial.json').read_text())
sx,sy=raw['transform']['scale'];tx,ty=raw['transform']['translate']
arcs=[]
for arc in raw['arcs']:
 x=y=0;a=[]
 for dx,dy in arc:
  x+=dx;y+=dy;a.append((round((x*sx+tx)*1e5),round((y*sy+ty)*1e5)))
 arcs.append(a)
def segment_distance(x,y,a,b):
 dx,dy=b[0]-a[0],b[1]-a[1];f=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy or 1)))
 return (x-a[0]-dx*f)**2+(y-a[1]-dy*f)**2
def simplify(points,tolerance=2):
 stack=[(0,len(points)-1)];keep={0,len(points)-1}
 while stack:
  i,j=stack.pop()
  if j<=i+1:continue
  v,k=max((segment_distance(*points[k],points[i],points[j]),k) for k in range(i+1,j))
  if v>tolerance*tolerance:keep.add(k);stack.extend(((i,k),(k,j)))
 return [points[k] for k in sorted(keep)]
def ring(nums):
 line=[]
 for i in nums:
  pts=arcs[i] if i>=0 else list(reversed(arcs[~i]));line+=pts[1:] if line else pts
 return line
def interior(poly):
 # Maximise distance from the cartographic point label to the surveyed perimeter.
 ring=poly[0];xs,ys=zip(*ring);x0,x1=min(xs),max(xs);y0,y1=min(ys),max(ys);scale=.762
 def clearance(x,y):
  inside=False;d=float("inf")
  for r in poly:
   for a,b in zip(r[:-1],r[1:]):
    if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:inside=not inside
    d=min(d,segment_distance(x*scale,y,[a[0]*scale,a[1]],[b[0]*scale,b[1]]))
  return math.sqrt(d)*(1 if inside else -1)
 xx=(x1+x0)*.5;yy=(y1+y0)*.5;bx,by,best=xx,yy,clearance(xx,yy)
 rx=(x1-x0)*.5;ry=(y1-y0)*.5;trials=[]
 for sweep in range(4):
  for row in range(9):
   for col in range(9):
    x=xx+(col/4-1)*rx;y=yy+(row/4-1)*ry;score=clearance(x,y)
    if sweep==0 and score>0:trials.append((score,x,y))
    if score>best:bx,by,best=x,y,score
  xx,yy=bx,by;rx/=3;ry/=3
 assert best>0
 positions=[[round(bx),round(by)]]
 for _,x,y in sorted(trials,reverse=True):
  if all(math.hypot((x-a)*scale,y-b)>max(250,min((x1-x0)*scale,y1-y0)*.24) for a,b in positions):
   positions.append([round(x),round(y)])
   if len(positions)==4:break
 return positions
labels=[];owners=[0]*len(arcs)
for g in raw['objects']['Distritos']['geometries']:
 rings=g['arcs'] if g['type']=='Polygon' else g['arcs'][0]
 full=[]
 for nums in rings:
  for i in nums:owners[i if i>=0 else ~i]+=1
  full.append(simplify(ring(nums),10))
 labels.append([g['properties']['NOMBRE'],interior(full)])
outArcs=[]
for a,n in zip(arcs,owners):
 arr=simplify(a,1.75);assert n in (1,2)
 # Integer delta coding keeps a viewport-only transfer small even without HTTP compression.
 flat=[n,*arr[0]]
 for a,b in zip(arr,arr[1:]): flat.extend((b[0]-a[0],b[1]-a[1]))
 outArcs.append(flat)
data=dict(source='Ayuntamiento de Madrid, Departamento de Cartografía. Límites administrativos actuales.',updated='2026-08-31',sourceUrl='https://geoportal.madrid.es/IDEAM_WBGEOPORTAL/dataset.iam?id=e251898e-4a9c-11eb-9104-dc4a3e8ce33b',conditions='https://datos.madrid.es/pages/condiciones-generales-ayuntamiento-de-madrid',unit=1e-5,arcs=outArcs,labels=labels)
dest=w.parents[1]/'public/detail/madrid-districts.json';dest.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
print(len(labels),len(outArcs),dest.stat().st_size)
