import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import earcut from 'earcut';
import {readLandmarks,covers} from './landmarks.mjs';
import {TILE} from '../src/grid.js';

const directory=process.argv[2], out=new URL('../public/maqueta/',import.meta.url);
const models=readLandmarks(process.argv[3]);
fs.writeFileSync(new URL('../public/datos/landmark-credits.json',import.meta.url),JSON.stringify(models.map(m=>m.credit)));
const unit=TILE/4096;
const surface={park:1,water:2,road:3,wall:4,roof:5,tree:6};
const unitNormal=(x,y)=>{const length=Math.hypot(x,y)||1;return [x/length,y/length];};
function clean(ring){
  const pts=ring.slice();
  if(pts.length>1 && pts[0][0]===pts.at(-1)[0] && pts[0][1]===pts.at(-1)[1])pts.pop();
  return pts.filter((p,i)=>i===0 || p[0]!==pts[i-1][0] || p[1]!==pts[i-1][1]);
}
function cornerCut(ring){
  const points=[];
  for(let i=0;i<ring.length;i++){
    const a=ring[(i+ring.length-1)%ring.length], b=ring[i], c=ring[(i+1)%ring.length];
    const ab=[a[0]-b[0],a[1]-b[1]],cb=[c[0]-b[0],c[1]-b[1]];
    const la=Math.hypot(...ab),lc=Math.hypot(...cb),radius=Math.min(1.8/unit,la*.18,lc*.18);
    if(radius<.85 || Math.abs(ab[0]*cb[1]-ab[1]*cb[0])<.18*la*lc){points.push(b);continue;}
    points.push([b[0]+ab[0]*radius/la,b[1]+ab[1]*radius/la],
                [b[0]+cb[0]*radius/lc,b[1]+cb[1]*radius/lc]);
  }
  return points;
}
function tileMesh(data,x,y){
  const vertices=[],indices=[];
  const nearby=models.filter(m=>m.cx+m.extent>=x && m.cx-m.extent<x+1 && m.cy+m.extent>=y && m.cy-m.extent<y+1);
  function vertex(x,y,height,nx,ny,nz,kind,ao=1){
    const id=vertices.length/8;
    vertices.push(x,y,height,nx,ny,nz,kind,ao);return id;
  }
  function cap(rings,make){
    const xy=[],holes=[],ids=[];
    for(const ring of rings){if(ring.length<3)continue;if(ids.length)holes.push(ids.length);
      for(const p of ring){xy.push(p[0],p[1]);ids.push(make(p));}}
    if(!ids.length)return;
    for(const k of earcut(xy,holes))indices.push(ids[k]);
  }
  function building(rings,h){
    const roof=[];
    for(const input of rings){
      const pts=cornerCut(clean(input));if(pts.length<3)continue;
      const rim=[],n=pts.length,first=vertices.length/8;
      for(let i=0;i<n;i++){
        const p=pts[i],a=pts[(i+n-1)%n],b=pts[(i+1)%n];
        const n1=unitNormal(p[1]-a[1],a[0]-p[0]),n2=unitNormal(b[1]-p[1],p[0]-b[0]);
        const [nx,ny]=unitNormal(n1[0]+n2[0],n1[1]+n2[1]);
        const miter=1/Math.max(.68,nx*n1[0]+ny*n1[1]);
        const radius=Math.min(1.45,.15*h,.65+.018*h);
        const inset=radius/unit*miter,rx=p[0]-inset*nx,ry=p[1]-inset*ny;
        vertex(...p,0,nx,ny,0,surface.wall,.68);
        vertex(...p,h-radius,nx,ny,0,surface.wall,1);
        vertex(p[0]-inset*.293*nx,p[1]-inset*.293*ny,h-radius*.293,nx*.707,ny*.707,.707,surface.wall,1);
        vertex(rx,ry,h,0,0,1,surface.roof,1);
        rim.push([rx,ry,first+i*4+3]);
      }
      for(let i=0;i<n;i++){
        const a=first+i*4,b=first+((i+1)%n)*4;
        for(let k=0;k<3;k++)indices.push(a+k,b+k,b+k+1,a+k,b+k+1,a+k+1);
      }
      roof.push(rim);
    }
    cap(roof,p=>p[2]);
  }
  function tree(cx,cy,r){
    const base=vertices.length/8,n=7;
    for(const [rr,z,nz] of [[.65,1,-.3],[1,.55*r+1,.04],[.73,r+1,.72],[.045,r*1.25+1,1]]){
      const horizontal=Math.sqrt(1-nz*nz);
      for(let i=0;i<n;i++){
        const t=2*Math.PI*i/n,dx=Math.cos(t),dy=Math.sin(t);
        vertex(cx+dx*rr*r/unit,cy+dy*rr*r/unit,z,dx*horizontal,dy*horizontal,nz,surface.tree,.9+.1*Math.max(0,nz));
      }
    }
    for(let level=0;level<3;level++)for(let i=0;i<n;i++){
      const a=base+level*n+i,b=base+level*n+(i+1)%n;
      indices.push(a,b,a+n,b,b+n,a+n);
    }
  }
  for(const [kind,polygons,z] of [[surface.park,data.parks,.025],[surface.water,data.water,.06]]){
    for(const polygon of polygons)cap(polygon.map(clean),p=>vertex(...p,z,0,0,1,kind));
  }
  for(const polygon of data.bridges){
    const rings=polygon.map(clean);
    cap(rings,p=>vertex(...p,3,0,0,1,surface.road));
    for(const ring of rings)for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      const [nx,ny]=unitNormal(b[1]-a[1],a[0]-b[0]),base=vertices.length/8;
      for(const [point,h] of [[a,1.4],[b,1.4],[b,3],[a,3]])vertex(...point,h,nx,ny,0,surface.wall,.93);
      indices.push(base,base+1,base+2,base,base+2,base+3);
    }
  }
  for(const [width,line] of data.roads){
    if(line.length<2)continue;
    const base=vertices.length/8;
    for(let i=0;i<line.length;i++){
      const a=line[Math.max(i-1,0)],p=line[i],b=line[Math.min(i+1,line.length-1)];
      const [nx,ny]=unitNormal(b[1]-a[1],a[0]-b[0]),r=width/(2*unit);
      vertex(p[0]+r*nx,p[1]+r*ny,.14,0,0,1,surface.road);
      vertex(p[0]-r*nx,p[1]-r*ny,.14,0,0,1,surface.road);
      if(i>0){const j=base+i*2;indices.push(j-2,j-1,j,j,j-1,j+1);}
    }
  }
  for(const [height,rings] of data.buildings){
    if(nearby.length && covers(rings[0],x,y,nearby))continue;
    building(rings,Math.max(3,Math.min(135,height*.92+1)));
  }
  for(const [cx,cy] of data.trees)tree(cx,cy,3.9);
  // Reuse the tree centres from the geographic park material so that relief and shadows agree.
  const trees=path.join(process.argv[4] || directory,'trees-'+x+'-'+y+'.json');
  if(fs.existsSync(trees))for(const [cx,cy,r] of JSON.parse(fs.readFileSync(trees)))tree(cx,cy,r);
  for(const model of nearby)for(const {positions,normals,indices:faces} of model.parts){
    const base=vertices.length/8;
    for(let k=0;k<positions.length;k+=3){
      vertex((model.cx-x)*4096+positions[k]/unit,(model.cy-y)*4096+positions[k+2]/unit,positions[k+1],
        normals[k],normals[k+2],normals[k+1],model.metal?7:8,.96);
    }
    for(const i of faces)indices.push(base+i);
  }
  const count=vertices.length/8;
  // Keep neighbouring triangles contiguous. A street view can skip the rest of the city tile.
  const buckets=Array.from({length:64},()=>({tris:[],x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity,high:0}));
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*8,b=indices[i+1]*8,c=indices[i+2]*8;
    const gx=Math.min(7,Math.max(0,Math.floor((vertices[a]+vertices[b]+vertices[c])/1536)));
    const gy=Math.min(7,Math.max(0,Math.floor((vertices[a+1]+vertices[b+1]+vertices[c+1])/1536)));
    const group=buckets[gy*8+gx];group.tris.push(indices[i],indices[i+1],indices[i+2]);
    group.x0=Math.min(group.x0,vertices[a],vertices[b],vertices[c]);group.x1=Math.max(group.x1,vertices[a],vertices[b],vertices[c]);
    group.y0=Math.min(group.y0,vertices[a+1],vertices[b+1],vertices[c+1]);group.y1=Math.max(group.y1,vertices[a+1],vertices[b+1],vertices[c+1]);
    group.high=Math.max(group.high,vertices[a+2],vertices[b+2],vertices[c+2]);
  }
  const active=buckets.filter(group=>group.tris.length);
  const buf=Buffer.alloc(8+count*12+indices.length*4+active.length*7*4);
  buf.writeUInt32LE(count);buf.writeUInt32LE(indices.length,4);
  for(let i=0;i<count;i++){
    const at=8+i*12,k=i*8;
    for(let j=0;j<3;j++)buf.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(vertices[k+j]*(j===2?64:4)))),at+j*2);
    for(let j=0;j<3;j++)buf.writeInt8(Math.round(vertices[k+3+j]*127),at+6+j);
    buf[at+9]=vertices[k+6];buf[at+10]=Math.round(vertices[k+7]*255);
  }
  const table=8+count*12+indices.length*4;
  let offset=0;
  active.forEach((group,i)=>{
    const range=[offset,group.tris.length,Math.floor(group.x0),Math.floor(group.y0),Math.ceil(group.x1),Math.ceil(group.y1),Math.ceil(group.high)];
    range.forEach((v,j)=>buf.writeInt32LE(v,table+(i*7+j)*4));
    for(const idx of group.tris)buf.writeUInt32LE(idx,8+count*12+(offset++)*4);
  });
  return gzipSync(buf,{level:5});
}
for(const name of fs.readdirSync(directory).filter(n=>/^\d+_\d+\.json$/.test(n))){
  const [x,y]=name.slice(0,-5).split('_').map(Number);
  fs.writeFileSync(new URL(x+'-'+y+'.mesh.gz',out),tileMesh(JSON.parse(fs.readFileSync(path.join(directory,name))),x,y));
}
