// A metropolitan sheet represents each resolvable road corridor with one trail
// of type. The lanes chosen below are always stations on source road geometry.
import {regionalWeight} from './metropolitan.mjs?v=continuous-zoom-1';
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
// About one pixel of paper between adjacent highway marks keeps the individual
// strokes legible at normal screen size.
const pens=[
    {char:'━',size:9.2,step:6.6,alpha:.91,color:'#94543e'},
    {char:'–',size:10.5,step:6.0,alpha:.94,color:'#9a664c'},
    {char:'–',size:9.6,step:5.85,alpha:.85,color:'#93755d'},
    {char:'–',size:8.7,step:6.1,alpha:.69,color:'#887e69'},
    {char:'-',size:8.2,step:6.4,alpha:.60,color:'#8d856e'}
];

function interpolateInk(from,to,t){
  if(t<=0)return from;if(t>=1)return to;
  const a=parseInt(from.slice(1),16),b=parseInt(to.slice(1),16);
  let rgb=0;
  for(const shift of [16,8,0]){
    const x=(a>>shift)&255,y=(b>>shift)&255;rgb|=Math.round(x+(y-x)*t)<<shift;
  }
  return '#'+rgb.toString(16).padStart(6,'0');
}
export function metropolitanScale(z){
  return z>=5.45&&z<11.35;
}

export function metropolitanPen(rank,z,link,detail){
  const blend=clamp((z-10.35)/1,0,1);
  if(link){
    if(z<10.6)return null;
    return {...detail,size:7.5+blend*1.4,step:5.4+blend,alpha:.55+blend*.27};
  }
  // A single dash reads at this scale. A separate double stroke returns when
  // the urban sheet has room to distinguish the highway from its junctions.
  const metro=pens[rank];
  if(!metro)return detail;
  const regional=regionalWeight(z);
  if(regional){
    // At intercity scale keep the motorway as the spine. Lower classes use
    // shorter, lighter type and leave larger intervals of paper.
    const p=[
      [9.1,6.7,.89,'#925c48'],
      [9.0,6.4,.80,'#99745a'],
      [7.8,7.35,.58,'#9c846e'],
      [7.4,8.1,.48,'#a49680'],
      [7,8.5,.39,'#a49680']
    ][rank];
    return {...detail,char:metro.char,color:interpolateInk(metro.color,p[3],regional),
      size:metro.size+(p[0]-metro.size)*regional,step:metro.step+(p[1]-metro.step)*regional,
      alpha:metro.alpha+(p[2]-metro.alpha)*regional};
  }
  const mix=(a,b)=>a+blend*(b-a);
  return {...detail,char:metro.char,color:interpolateInk(metro.color,detail.color,blend),size:mix(metro.size,detail.size),
    step:mix(metro.step,detail.step),alpha:mix(metro.alpha,detail.alpha)};
}

// A screen-local index tests the perpendicular separation and tangent of prior
// ink, allowing crossed roads to keep their own stations. A more important or
// more complete road is typeset first. Each accepted station stays exactly on
// its original path. Adjacent but readable roads survive, even if parallel.
export function corridorStations(width,height,z){
  const cell=10,columns=Math.ceil(width/cell)+2,rows=Math.ceil(height/cell)+2;
  const buckets=new Array(columns*rows),scale=clamp((11.35-z)/1.1,0,1);
  let omitted=0;
  function accept(x,y,angle,path,step,rank){
    const ux=Math.cos(angle),uy=Math.sin(angle);
    const cx=Math.floor(x/cell)+1,cy=Math.floor(y/cell)+1;
    const side=1.4+scale*(rank<3?3.8:2.9),along=Math.max(2.6,step*.70);
    for(let j=cy-1;j<=cy+1;j++)for(let i=cx-1;i<=cx+1;i++){
      const prior=buckets[j*columns+i];
      if(!prior)continue;
      for(const a of prior){
        if(a.path===path||Math.abs(ux*a.ux+uy*a.uy)<.91)continue;
        const dx=x-a.x,dy=y-a.y;
        if(Math.abs(dx*a.ux+dy*a.uy)>along||Math.abs(dy*a.ux-dx*a.uy)>side)continue;
        omitted++;return false;
      }
    }
    const key=cy*columns+cx;
    (buckets[key]??=[]).push({x,y,ux,uy,path});
    return true;
  }
  return {accept,get omitted(){return omitted;}};
}
