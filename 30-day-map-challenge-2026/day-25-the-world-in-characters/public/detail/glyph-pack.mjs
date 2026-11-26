// The geometric marks remain typeset characters. Only complete words and unknown
// signs need the native symbol pipeline for shaping, labels and interaction.
import {cameraContext} from './projector.mjs?v=regional-reading-1';
import {atlas} from './glyph-metrics.mjs';

const codes=new Map(Object.keys(atlas.metrics).map((t,i)=>[t,i]));
const order={water:0,urban:0,townDot:3,bathymetry:1,land:1,park:2,coast:2,building:2,border:2,river:2,road:2,flow:3};
const pointList=f=>f.geometry.type==='Point'?[f.geometry.coordinates]:f.geometry.coordinates;
export const floatsPerGlyph=7;

export function packGlyphs(fc,camera){
  const ctx=cameraContext(camera),origin=[camera.lon,camera.lat],centre=ctx.project(origin);
  // A short perpendicular geographic basis accurately recovers the current
  // camera transform at zero pitch, also when its centre crosses the date line.
  const corners=[],step=[];
  for(let axis=0;axis<2;axis++){
    const options=[48,-48].map(offset=>{
      const p=centre.slice();p[axis]+=offset;
      const ll=ctx.unproject(p),back=ctx.project(ll);
      return {ll,offset,error:Math.hypot(back[0]-p[0],back[1]-p[1])};
    });
    const best=options.sort((a,b)=>a.error-b.error)[0];corners.push(best.ll);step.push(best.offset);
  }
  const signs=[],native=[];
  let n=0;
  for(const f of fc.features){
    const p=f.properties;
    if(!(p.b in order)||!codes.has(p.t)||!['Point','MultiPoint'].includes(f.geometry.type)){native.push(f);continue;}
    signs.push(f);n+=pointList(f).length;
  }
  signs.sort((a,b)=>order[a.properties.b]-order[b.properties.b]||(a.properties.order||0)-(b.properties.order||0));
  const data=new Float32Array(n*floatsPerGlyph),rgba=new Uint8Array(data.buffer);
  let pos=0;
  for(const f of signs){
    const {s,e=0,t,c,a=1,b,q=0}=f.properties;
    const rgb=Number.parseInt(c.slice(1),16),alpha=Math.round(Math.max(0,Math.min(1,a))*255);
    const code=codes.get(t),angle=e*Math.PI/180,motion=b==='water'?1:b==='flow'?2+q%4:0;
    const points=pointList(f);
    for(let i=0;i<points.length;i++){
      const ll=points[i];
      const x=ctx.matrix.merc?camera.lon+((ll[0]-camera.lon+540)%360)-180:ll[0];
      const p=ctx.project([x,ll[1]]);
      data[pos]=p[0]-centre[0];data[pos+1]=p[1]-centre[1];data[pos+2]=s;
      data[pos+3]=angle;data[pos+4]=code;data[pos+5]=f.stretches?-f.stretches[i]:motion;
      const j=(pos+6)*4;rgba[j]=rgb>>16;rgba[j+1]=rgb>>8;rgba[j+2]=rgb;rgba[j+3]=alpha;
      pos+=floatsPerGlyph;
    }
  }
  fc.features=native;
  const extent=[-centre[0],-centre[1],camera.width-centre[0],camera.height-centre[1]];
  return {data,count:n,zoom:camera.z,projection:camera.projection,anchors:[origin,...corners],step,extent};
}
