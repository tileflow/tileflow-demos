import fs from 'node:fs';
import path from 'node:path';
import {world,TILE} from '../src/grid.js';

// The tower's mapped outline is concave between its feet. Its separate OSM
// pillar parts occupy those recesses and are supplied by the lattice model too.
function convexFootprint(points){
  const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  function half(list){
    const hull=[];
    for(const p of list){
      while(hull.length>=2){
        const a=hull.at(-2),b=hull.at(-1);
        if((b[0]-a[0])*(p[1]-a[1])>(b[1]-a[1])*(p[0]-a[0]))break;
        hull.pop();
      }
      hull.push(p);
    }
    return hull.slice(0,-1);
  }
  return [...half(sorted),...half(sorted.reverse())];
}

// The authored mid-distance GLBs use east, up, south metres and identity scene nodes.
export function readLandmarks(root){
  const models=[];
  for(const name of ['eiffel-tower','arc-de-triomphe','palais-de-chaillot']){
    const dir=path.join(root,name),manifest=JSON.parse(fs.readFileSync(path.join(dir,'model/manifest.json')));
    const bytes=fs.readFileSync(path.join(dir,'model',manifest.levels.mid.file));
    const size=bytes.readUInt32LE(12),spec=JSON.parse(bytes.toString('utf8',20,20+size)),bin=28+size;
    if(spec.nodes.some(n=>n.matrix||n.scale||n.rotation||n.translation)||manifest.placement.heading!==0)throw Error('Unexpected landmark transform');
    function accessor(id){
      const a=spec.accessors[id],v=spec.bufferViews[a.bufferView],n=a.type==='SCALAR'?1:3;
      const C=({5126:Float32Array,5125:Uint32Array,5123:Uint16Array})[a.componentType];
      if(!C || v.byteStride)throw Error('Unexpected landmark encoding');
      return new C(bytes.buffer,bytes.byteOffset+bin+(a.byteOffset||0)+(v.byteOffset||0),a.count*n);
    }
    const [cx,cy]=world(...manifest.placement.at);
    const parts=spec.meshes.flatMap(m=>m.primitives).filter(p=>p.attributes.NORMAL!==undefined).map(p=>({
      positions:accessor(p.attributes.POSITION), normals:accessor(p.attributes.NORMAL), indices:accessor(p.indices)
    }));
    const footprints=fs.readdirSync(path.join(dir,'source')).filter(n=>/^osm-way-.*\.geojson$/.test(n))
      .flatMap(n=>{const g=JSON.parse(fs.readFileSync(path.join(dir,'source',n))).geometry;
        if(g.type!=='Polygon')return [];
        const boundary=g.coordinates[0].map(p=>world(...p));
        return [name==='eiffel-tower'?convexFootprint(boundary):boundary];});
    const extent=parts.reduce((max,part)=>{for(let k=0;k<part.positions.length;k+=3)max=Math.max(max,Math.abs(part.positions[k]),Math.abs(part.positions[k+2]));return max;},0)/TILE;
    models.push({cx,cy,parts,footprints,extent,metal:name==='eiffel-tower',credit:manifest.attribution});
  }
  return models;
}
export function covers(ring,x,y,models){
  const points=ring.slice(0,-1);if(!points.length)return false;
  const cx=x+points.reduce((s,p)=>s+p[0],0)/points.length/4096;
  const cy=y+points.reduce((s,p)=>s+p[1],0)/points.length/4096;
  return models.some(m=>m.footprints.some(poly=>{
    let inside=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const [ax,ay]=poly[i],[bx,by]=poly[j];
      if((ay>cy)!==(by>cy) && cx<(bx-ax)*(cy-ay)/(by-ay)+ax)inside=!inside;
    }return inside;
  }));
}
