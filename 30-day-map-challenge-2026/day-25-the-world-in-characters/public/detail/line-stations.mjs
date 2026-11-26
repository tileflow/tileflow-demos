// A stroke meets a fixed family of survey lines in the map's projected plane.
// The intersection is independent of which tile or viewport clipped a street.
// At a closer scale the halfway stations join the existing ones, one by one.
const unit=512/(2*Math.PI),diagonal=Math.SQRT2-1;
function hash(station,cross,axis){
  let n=Math.imul(station,0x1f123bb5)^Math.imul(cross,0x5f356495)^Math.imul(axis+1,0x2c1b3c6d);
  n=Math.imul(n^(n>>>16),0x45d9f3b);
  return (n^(n>>>16))>>>0;
}
export function lineStations(matrix){
  if(!matrix)return null;
  const {p0,v0,sx,sy,tx,ty}=matrix,det=sx*ty-sy*tx;
  if(!Number.isFinite(det)||Math.abs(det)<1e-8)return null;
  const ix=unit*ty/det,iy=-unit*tx/det,jx=-unit*sy/det,jy=unit*sx/det;
  const originX=p0[0]*unit-v0[0]*ix-v0[1]*iy;
  const originY=p0[1]*unit-v0[0]*jx-v0[1]*jy;
  const density=Math.sqrt(Math.abs(det))/unit;
  const pitches=new Map();
  function octave(level){
    const power=Math.floor(level);
    return {power,frequency:2**(power+1),admission:2**(level-power)-1};
  }
  return (path,spacing,visit,fitRoad=false)=>{
    let steps=pitches.get(spacing);
    if(!steps){
      const level=Math.log2(density/spacing);
      steps=[octave(level),octave(level-.5)];pitches.set(spacing,steps);
    }
    const line=path.line;let stations=0,previous=null;
    function flush(nextGap){
      const near=Math.min(previous.gap,nextGap),far=Math.max(previous.gap,nextGap);
      const fit=Math.max(.79,Math.min(1.78,(far*.86+near*.14)/spacing));
      return visit(previous.x,previous.y,previous.angle,previous.seed,previous.key,fit);
    }
    for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1];
      const wx=ix*dx+iy*dy,wy=jx*dx+jy*dy;
      if(!wx&&!wy)continue;
      const ax=Math.abs(wx),ay=Math.abs(wy);
      const axis=ay<ax*diagonal?0:ax<ay*diagonal?1:wx*wy>0?2:3;
      const u=axis===1?0:1,v=axis===0?0:axis===3?-1:1;
      const px=originX+ix*a[0]+iy*a[1];
      const py=originY+jx*a[0]+jy*a[1];
      // Integer axis vectors make the diagonal grids wrap at the meridian too.
      const {frequency,admission,power}=steps[axis>=2?1:0];
      const start=(u*px+v*py)*frequency,end=start+(u*wx+v*wy)*frequency;
      const direction=end>start?1:-1,stop=direction>0?Math.ceil(end):Math.floor(end);
      const angle=Math.atan2(dy,dx);
      for(let k=direction>0?Math.ceil(start):Math.floor(start);k!==stop;k+=direction){
        const t=(k-start)/(end-start);
        const wxAt=px+t*wx,wyAt=py+t*wy;
        const wrap=matrix.merc?Math.floor((wxAt+256)/512)*512*frequency:0;
        const index=k-u*wrap,cross=(-v*wxAt+u*wyAt)*frequency+v*wrap;
        const seed=hash(index,Math.floor(cross*.125),axis);
        if(k%2&&seed/4294967296>=admission)continue;
        const key=hash(index,Math.round(cross*16),axis+power*4);
        stations++;
        const x=a[0]+dx*t,y=a[1]+dy*t;
        if(fitRoad){
          // A double rule must still read as one road where the next station
          // has yet to enter. Lengthen the glyph along its tangent, leaving
          // its geographic centre and perpendicular stroke width untouched.
          const distance=path.ds[i-1]+t*(path.ds[i]-path.ds[i-1]);
          const gap=previous?distance-previous.distance:Math.min(spacing,2*distance);
          if(previous&&flush(gap)===false)return stations;
          previous={x,y,angle,seed,key,gap,distance};
        }else if(visit(x,y,angle,seed,key)===false)return stations;
      }
    }
    if(previous)flush(Math.min(spacing,2*(path.length-previous.distance)));
    return stations;
  };
}
