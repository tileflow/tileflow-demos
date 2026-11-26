import {streetZoom} from './street-scale.mjs?v=grounded-type-1';
// The Tileflow camera is affine in its projected plane at zero pitch. Three
// nearby WGS84 anchors recover the native camera transform including its local
// metric correction, bearing and viewport origin. The compositor can then use
// the same projection without accessing the DOM or the map on the input thread.
const rad=Math.PI/180, m=Math.sqrt(3)/2;
const A=1.340264,B=-.081106,C=.000893,D=.003796;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function poly(t){const s=t*t,p=s*s*s;return t*(A+B*s+p*(C+D*s));}
function derivative(t){const s=t*t,p=s*s*s;return A+3*B*s+p*(7*C+9*D*s);}
const polar=poly(Math.asin(m));
function plane(lon,lat,merc){
  if(merc)return [lon*rad,Math.asinh(Math.tan(clamp(lat,-85.05112878,85.05112878)*rad))];
  const t=Math.asin(m*Math.sin(lat*rad));
  return [lon*rad*Math.cos(t)/(m*derivative(t)),poly(t)];
}
function invert(x,y,merc){
  if(merc)return [x/rad,Math.atan(Math.sinh(y))/rad];
  y=clamp(y,-polar,polar);
  let t=y/A;
  for(let i=0;i<7;i++){const d=(poly(t)-y)/derivative(t);t-=d;if(Math.abs(d)<1e-13)break;}
  return [clamp(x*m*derivative(t)/Math.cos(t)/rad,-180,180),Math.asin(clamp(Math.sin(t)/m,-1,1))/rad];
}
export function captureCamera(map,c,lead){
  const focus=[c.w/2+(lead?.x||0),c.h/2+(lead?.y||0)],factor=2**(lead?.z||0);
  if(lead){
    const ll=map.unproject(focus);
    c={...c,lon:ll.lng,lat:ll.lat,z:c.z+lead.z};
  }
  const pad=c.z>=streetZoom?Math.min(260,Math.ceil(Math.max(c.w,c.h)*.175)):
    lead?Math.min(184,Math.ceil(Math.min(c.w,c.h)*.30)):Math.min(110,Math.ceil(Math.min(c.w,c.h)*.13));
  const width=c.w+2*pad,height=c.h+2*pad;
  const center=[c.lon,c.lat],merc=map.getProjection().type==='mercator';
  const step=clamp(45/2**c.z,.000001,4);
  const lonDelta=center[0]>179? -step:step,latDelta=center[1]>80?-step:step;
  const anchors=[center,[center[0]+lonDelta,center[1]],[center[0],center[1]+latDelta]];
  const [p0,p1,p2]=anchors.map(ll=>plane(...ll,merc));
  const [v0,v1,v2]=anchors.map(ll=>{
    const p=map.project(ll);
    return lead?[(p.x-focus[0])*factor+c.w/2+pad,(p.y-focus[1])*factor+c.h/2+pad]:[p.x+pad,p.y+pad];
  });
  const sx=(v1[0]-v0[0])/(p1[0]-p0[0]),sy=(v1[1]-v0[1])/(p1[0]-p0[0]);
  const tx=((v2[0]-v0[0])-sx*(p2[0]-p0[0]))/(p2[1]-p0[1]);
  const ty=((v2[1]-v0[1])-sy*(p2[0]-p0[0]))/(p2[1]-p0[1]);
  const matrix={merc,p0,v0,sx,sy,tx,ty};
  const a={...c,pad,width,height,zoom:c.z,leadZoom:lead?.z||0,matrix,projection:map.getProjection().type};
  const {unproject}=cameraContext(a),xs=[],ys=[];
  for(let i=0;i<=8;i++)for(const xy of [[width*i/8,0],[width*i/8,height],[0,height*i/8],[width,height*i/8]]){
    const [lon,lat]=unproject(xy);
    if(!Number.isFinite(lon+lat))continue;
    let delta=lon-center[0];while(delta< -180)delta+=360;while(delta>180)delta-=360;
    xs.push(center[0]+delta);ys.push(lat);
  }
  a.bounds=[Math.min(...xs),Math.max(-89.9,Math.min(...ys)),Math.max(...xs),Math.min(89.9,Math.max(...ys))];
  return a;
}
export function cameraContext(camera){
  const {p0,v0,sx,sy,tx,ty,merc}=camera.matrix,det=sx*ty-sy*tx;
  const project=ll=>{
    const [x,y]=plane(ll[0],ll[1],merc),dy=y-p0[1];
    // Geographic records use canonical longitudes. The wrapped atlas can
    // have +179 and −179 degrees side by side in the same camera footprint.
    let dx=x-p0[0];
    if(merc)dx-=2*Math.PI*Math.round(dx/(2*Math.PI));
    return [v0[0]+sx*dx+tx*dy,v0[1]+sy*dx+ty*dy];
  };
  const unproject=([x,y])=>{
    const a=x-v0[0],b=y-v0[1];return invert(p0[0]+(ty*a-tx*b)/det,p0[1]+(sx*b-sy*a)/det,merc);
  };
  return {...camera,project,unproject,phase:0};
}
