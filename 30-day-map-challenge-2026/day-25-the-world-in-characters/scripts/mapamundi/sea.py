"""Trace an invented wave field. These isolines describe lettering, not measured currents."""
import json, math, pathlib
root=pathlib.Path(__file__).resolve().parent
dx=2
xs=list(range(-180,181,dx));ys=list(range(-90,91,dx))
# Opposing eddies give lines of type a turn around each ocean basin.
eddies=[(-146,25,47,25,57),(-125,-20,52,24,-49),(-41,28,26,18,40),
        (-29,-25,25,23,-52),(77,-27,32,22,-55),(165,22,23,21,28),
        (165,-26,24,16,-25),(-164,-60,35,15,13),(49,-57,38,14,12)]
def field(lon,lat):
 r=math.radians
 f=lat+4*math.sin(r(lon*2+lat))+2*math.cos(r(3*lon-3*lat))
 for cx,cy,a,b,power in eddies:
  x=((lon-cx+180)%360-180)/a;y=(lat-cy)/b
  f+=power*math.exp(-x*x-y*y)
 return f
v=[[field(x,y) for x in xs] for y in ys]
bands=[]
for level in range(-91,101,2):
 segments={}
 def key(p):return tuple(round(x,3) for x in p)
 def edge(a,b,va,vb):return key([a[0]+(b[0]-a[0])*(level-va)/(vb-va),a[1]+(b[1]-a[1])*(level-va)/(vb-va)])
 for j,y in enumerate(ys[:-1]):
  for i,x in enumerate(xs[:-1]):
   vals=[v[j][i],v[j][i+1],v[j+1][i+1],v[j+1][i]];corners=[(x,y),(x+dx,y),(x+dx,y+dx),(x,y+dx)]
   if min(vals)>level or max(vals)<level:continue
   hits=[edge(corners[a],corners[(a+1)%4],vals[a],vals[(a+1)%4]) for a in range(4) if (vals[a]>level)!=(vals[(a+1)%4]>level)]
   for a,b in zip(hits[::2],hits[1::2]):segments.setdefault(a,[]).append(b);segments.setdefault(b,[]).append(a)
 while segments:
  start=next((p for p,vv in segments.items() if len(vv)==1),next(iter(segments)))
  path=[start];n=start
  while n in segments:
   t=segments[n].pop()
   if not segments[n]:del segments[n]
   segments[t].remove(n)
   if not segments[t]:del segments[t]
   path.append(t);n=t
  if len(path)>4:bands.append([level,[list(p) for p in path]])
(root/'sea.json').write_text(json.dumps(bands,separators=(',',':')))
