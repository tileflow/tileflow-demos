"""Generalised land contours and Atlantic isobaths from the atlas's local NOAA ETOPO tiles."""
import gzip
import json
import math
import sys
from array import array
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT/'public/detail'
INDEX = json.loads((DETAIL/'terrain/index.json').read_text())
WEST, SOUTH, EAST, NORTH = -35,18,24,62
STEP = 1/6

@lru_cache(maxsize=None)
def tile(r,c):
    values=array('h',gzip.decompress((DETAIL/'terrain'/f'{r}-{c}.gz').read_bytes()))
    if sys.byteorder!='little':values.byteswap()
    return values

def height(x,y):
    c=round((x-INDEX['west'])/INDEX['step'])%INDEX['width']
    r=round((INDEX['north']-y)/INDEX['step'])
    return tile(r//360,c//360)[r%360*360+c%360]*INDEX['metersPerUnit']

# A 3x3 separable filter removes features smaller than a character at this scale.
width=round((EAST-WEST)/STEP)+1
rows=round((NORTH-SOUTH)/STEP)+1
grid=[]
for j in range(rows):
    y=NORTH-j*STEP
    row=[]
    for i in range(width):
        x=WEST+i*STEP
        row.append(sum(wx*wy*height(x+dx/12,y+dy/12) for (dx,wx) in [(-1,1),(0,2),(1,1)] for (dy,wy) in [(-1,1),(0,2),(1,1)])/16)
    grid.append(row)

def simplify(points,epsilon=.019):
    if len(points)<3:return points
    keep={0,len(points)-1};stack=[(0,len(points)-1)]
    while stack:
        a,b=stack.pop();x,y=points[a];dx=points[b][0]-x;dy=points[b][1]-y
        norm=dx*dx+dy*dy;best=epsilon*epsilon;at=None
        for k in range(a+1,b):
            u,v=points[k][0]-x,points[k][1]-y
            t=max(0,min(1,(u*dx+v*dy)/norm)) if norm else 0
            dist=(u-dx*t)**2+(v-dy*t)**2
            if dist>best:best=dist;at=k
        if at is not None:keep.add(at);stack.extend([(a,at),(at,b)])
    return [points[i] for i in sorted(keep)]

features=[]
levels=[-4500,-3000,-1500,-250,850,1300,1900,2700]
for level in levels:
    nodes={};adj=defaultdict(set)
    for j in range(rows-1):
        for i in range(width-1):
            corners=[(i,j),(i+1,j),(i+1,j+1),(i,j+1)]
            values=[grid[y][x] for x,y in corners]
            if not min(values)<=level<max(values):continue
            hits=[]
            for a in range(4):
                b=(a+1)%4
                if (values[a]>level)==(values[b]>level):continue
                ax,ay=corners[a];bx,by=corners[b]
                key=(min(ax,bx),min(ay,by),ay==by)
                if key not in nodes:
                    t=(level-values[a])/(values[b]-values[a])
                    nodes[key]=[round(WEST+(ax+(bx-ax)*t)*STEP,3),round(NORTH-(ay+(by-ay)*t)*STEP,3)]
                hits.append(key)
            if len(hits)==4 and (sum(values)*.25>level)==(values[0]>level):hits=hits[1:]+hits[:1]
            for a,b in zip(hits[::2],hits[1::2]):
                adj[a].add(b);adj[b].add(a)
    order=sorted(adj,key=lambda p:len(adj[p]))
    for start in order:
        if not adj[start]:continue
        p=start;coords=[nodes[p]]
        while adj[p]:
            q=min(adj[p]);adj[p].remove(q);adj[q].remove(p);p=q;coords.append(nodes[p])
        arc=sum(math.hypot((b[0]-a[0])*.78,b[1]-a[1]) for a,b in zip(coords,coords[1:]))
        if arc<(1.45 if level<0 else .8):continue
        features.append({'level':level,'arr':simplify(coords)})
out=DETAIL/'iberia-elevation.gz'
out.write_bytes(gzip.compress(json.dumps(features,separators=(',',':')).encode(),mtime=0))
print(len(features),'contours;',out.stat().st_size,'bytes')
