// Union intervals per scanline, using even–odd intersections within each polygon.
// Islands stay dry and buffered overlaps between vector tiles disappear.
export function waterSurface(features,view,project){
  const pad=115,rows=new Map(),rings=[];
  for(const {geometry:g} of features){
    const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    for(const polygon of polygons){
      const cuts=new Map();
      for(const raw of polygon){
        const ring=raw.map(project);rings.push(ring);
        for(let i=1;i<ring.length;i++){
          const [x,y]=ring[i-1],[xx,yy]=ring[i];
          const first=Math.max(-pad,Math.ceil(Math.min(y,yy)-.5));
          const stop=Math.min(view.h+pad,Math.ceil(Math.max(y,yy)-.5));
          for(let j=first;j<stop;j++){
            if(!cuts.has(j))cuts.set(j,[]);
            cuts.get(j).push(x+(j+.5-y)*(xx-x)/(yy-y));
          }
        }
      }
      for(const [j,xs] of cuts){
        xs.sort((a,b)=>a-b);
        for(let i=0;i+1<xs.length;i+=2){
          const lo=Math.max(-pad,xs[i]),hi=Math.min(view.w+pad,xs[i+1]);
          if(hi<=lo)continue;
          if(!rows.has(j))rows.set(j,[]);
          rows.get(j).push([lo,hi]);
        }
      }
    }
  }
  for(const [j,parts] of rows){
    parts.sort((a,b)=>a[0]-b[0]);const merged=[];
    for(const [lo,hi] of parts){
      const last=merged.at(-1);
      if(last && lo<=last[1]+.02)last[1]=Math.max(last[1],hi);
      else merged.push([lo,hi]);
    }
    rows.set(j,merged);
  }
  function intersects(x1,y1,x2=x1,y2=y1){
    for(let j=Math.floor(y1);j<=Math.floor(y2);j++){
      const intervals=rows.get(j);if(!intervals)continue;
      for(const [lo,hi] of intervals){if(lo>x2)break;if(hi>=x1)return true;}
    }
    return false;
  }
  function covers(x1,y1,x2,y2){
    for(let j=Math.floor(y1);j<=Math.floor(y2);j++)
      if(!rows.get(j)?.some(([lo,hi])=>lo<=x1 && hi>=x2))return false;
    return true;
  }
  function marks(dx,dy,accept){
    const world=512*2**view.z,ox=view.w/2-view.x*world,oy=view.h/2-view.y*world;
    const dots=[];
    for(let r=Math.ceil((-65-oy)/dy);r*dy+oy<view.h+65;r++){
      const y=r*dy+oy,offset=ox+(r&1)*dx*.5;
      for(const [lo,hi] of rows.get(Math.floor(y))??[]){
        for(let col=Math.ceil((lo+1-offset)/dx);col*dx+offset<hi-1;col++){
          const x=col*dx+offset;
          if(accept(x,y) && covers(x-2,y-9,x+11,y+2))dots.push([x,y]);
        }
      }
    }
    return dots;
  }
  return {rings,intersects,marks};
}
