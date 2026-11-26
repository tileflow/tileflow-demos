export {intersects,viewport} from '../../../public/detail/cover.mjs';

// Liang–Barsky clipping assigns each road/waterway segment to its canonical tile.
function clipSegment(x0,y0,x1,y1,e) {
  const dx=x1-x0, dy=y1-y0;
  let start=0,end=1;
  const p=[-dx,dx,-dy,dy], q=[x0,e-x0,y0,e-y0];
  for (let i=0;i<4;i++) {
    if (p[i]===0) { if (q[i]<0) return null; continue; }
    const t=q[i]/p[i];
    if (p[i]<0) start=Math.max(start,t);
    else end=Math.min(end,t);
    if (start>=end) return null;
  }
  return [x0+start*dx,y0+start*dy,x0+end*dx,y0+end*dy];
}

function signedArea(flat) {
  let area=0;
  for (let i=2;i<flat.length;i+=2) area+=flat[i-2]*flat[i+1]-flat[i]*flat[i-1];
  return area;
}

// The output retains polygon holes and disconnected parts, including the tile buffer.
// The compositor may ignore buffered polygon edges using properties._tile.
export function toGeometry(feature, tile, extent) {
  const scale=2**tile.z;
  const box=[Infinity,Infinity,-Infinity,-Infinity];
  function point(x,y) {
    const lon=(tile.x+x/extent)/scale*360-180;
    const lat=Math.atan(Math.sinh(Math.PI*(1-2*(tile.y+y/extent)/scale)))*180/Math.PI;
    box[0]=Math.min(box[0],lon); box[1]=Math.min(box[1],lat);
    box[2]=Math.max(box[2],lon); box[3]=Math.max(box[3],lat);
    return [lon,lat];
  }

  const parts=[];
  for (const flat of feature.geometry) {
    if (feature.type==='Point') {
      for (let i=0;i<flat.length;i+=2) {
        const x=flat[i],y=flat[i+1];
        if (x>=0 && x<extent && y>=0 && y<extent) parts.push(point(x,y));
      }
    } else if (feature.type==='LineString') {
      let line,prevX,prevY;
      for (let i=2;i<flat.length;i+=2) {
        const seg=clipSegment(flat[i-2],flat[i-1],flat[i],flat[i+1],extent);
        if (!seg) {line=undefined; continue;}
        const [a,b,c,d]=seg;
        if (a===c && b===d) continue;
        if (!line || Math.abs(a-prevX)>1e-8 || Math.abs(b-prevY)>1e-8) {
          line=[point(a,b)]; parts.push(line);
        }
        line.push(point(c,d)); prevX=c;prevY=d;
      }
    } else if (flat.length>=8) {
      const winding=signedArea(flat);
      if (!winding) continue;
      const ring=[];
      for (let i=0;i<flat.length;i+=2) ring.push(point(flat[i],flat[i+1]));
      if (winding>0) parts.push([ring]);
      else if (parts.length) parts[parts.length-1].push(ring);
    }
  }
  if (!parts.length) return null;
  return {geometry:{type:parts.length===1 ? feature.type : 'Multi'+feature.type, coordinates:parts.length===1 ? parts[0] : parts},bbox:box};
}

// Use a parent tile only when a mapped open-water polygon contains the entire
// empty child, including a margin. A coastline or hole inside it disqualifies it.
export function inheritedOcean(tile,features) {
  const n=2**tile.z;
  const lat=y=>Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI;
  const bounds=[tile.x/n*360-180,lat(tile.y+1),(tile.x+1)/n*360-180,lat(tile.y)];
  const [w,s,e,h]=bounds;
  const padX=(e-w)*.01,padY=(h-s)*.01;
  const box=[w-padX,s-padY,e+padX,h+padY];
  function inside(ring,x,y) {
    let yes=false;
    for(let i=1;i<ring.length;i++){
      const [a,b]=ring[i-1],[c,d]=ring[i];
      if ((b>y)!==(d>y) && x<(c-a)*(y-b)/(d-b)+a) yes=!yes;
    }
    return yes;
  }
  function edgeTouches(ring) {
    for(let i=1;i<ring.length;i++){
      const [a,b]=ring[i-1],[c,d]=ring[i];
      if (Math.max(a,c)>=box[0] && Math.min(a,c)<=box[2] && Math.max(b,d)>=box[1] && Math.min(b,d)<=box[3]) return true;
    }
    return false;
  }
  for (const feature of features) {
    const p=feature.properties,shape=feature.geometry;
    if (p._layer!=='water' || !['ocean','sea'].includes(p.class)) continue;
    const polygons=shape.type==='Polygon' ? [shape.coordinates] : shape.type==='MultiPolygon' ? shape.coordinates : [];
    for (const rings of polygons) {
      if (!rings.length || rings.some(edgeTouches) || !inside(rings[0],(w+e)/2,(s+h)/2)) continue;
      if (rings.slice(1).some(ring=>inside(ring,(w+e)/2,(s+h)/2))) continue;
      const coordinates=[[[w,s],[e,s],[e,h],[w,h],[w,s]]];
      return {type:'Feature',properties:{_layer:'water',class:p.class,_class:p.class,_tile:tile.key,_sourceTile:p._tile},bbox:bounds,geometry:{type:'Polygon',coordinates}};
    }
  }
  return null;
}
