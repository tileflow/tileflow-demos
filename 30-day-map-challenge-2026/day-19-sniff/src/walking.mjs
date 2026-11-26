import {distance} from './streets.mjs';
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
export function segmentProjection(p,a,b){const v=[b[0]-a[0],b[1]-a[1]],len=dot(v,v),t=Math.max(0,Math.min(1,dot([p[0]-a[0],p[1]-a[1]],v)/(len||1)));const point=[a[0]+v[0]*t,a[1]+v[1]*t];return {point,distance:distance(p,point),t,tangent:len?[v[0]/Math.sqrt(len),v[1]/Math.sqrt(len)]:[0,0]};}
export function pointInRing(p,ring){let result=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;}
/** Keyboard controls move across open ground without a queue of five-metre nodes.
 * @param {any[]} lines
 * @param {any[]} buildings
 * @param {number[][][][]} areas
 * @param {{center:number[],radius:number}|null} openGround
 * @param {number[][][][]} water
 */
export function createWalkSurface(lines,buildings=[],areas=[],openGround=null,water=[]){
 let barriers=[],height=0;
 const size=24,roads=new Map(),walls=new Map(),plazas=new Map(),lakes=new Map();
 const insert=(grid,item,min,max)=>{for(let x=Math.floor(min[0]/size);x<=Math.floor(max[0]/size);x++)for(let z=Math.floor(min[1]/size);z<=Math.floor(max[1]/size);z++){const key=`${x}:${z}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(item);}};
 const bounds=ring=>[[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1]))],[Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))]];
 const nearby=(grid,p)=>grid.get(`${Math.floor(p[0]/size)}:${Math.floor(p[1]/size)}`)??[];
 for(const line of lines)for(let i=1;i<line.points.length;i++){const a=line.points[i-1],b=line.points[i],radius=Math.max(1.5,(line.width??10)/2),s={a,b,radius};insert(roads,s,[Math.min(a[0],b[0])-radius,Math.min(a[1],b[1])-radius],[Math.max(a[0],b[0])+radius,Math.max(a[1],b[1])+radius]);}
 for(const b of buildings){if(!b.ring?.length)continue;const [min,max]=bounds(b.ring);insert(walls,b,[min[0]-1,min[1]-1],[max[0]+1,max[1]+1]);}
 for(const area of areas){const [min,max]=bounds(area[0]);insert(plazas,area,min,max);}
 for(const area of water){const [min,max]=bounds(area[0]);insert(lakes,area,min,max);}
 const blockedByBarrier=(p,h=height)=>barriers.some(b=>(b.works||h<(b.height??3.5))&&segmentProjection(p,b.a,b.b).distance<(b.radius??1));
 const blocked=p=>nearby(walls,p).some(b=>{if(pointInRing(p,b.ring)&&!(b.holesLocal??[]).some(h=>pointInRing(p,h)))return true;for(const ring of [b.ring,...(b.holesLocal??[])])for(let i=1;i<ring.length;i++)if(segmentProjection(p,ring[i-1],ring[i]).distance<.55)return true;return false;});
 const supported=p=>nearby(roads,p).some(s=>segmentProjection(p,s.a,s.b).distance<=s.radius)||nearby(plazas,p).some(rings=>pointInRing(p,rings[0])&&!rings.slice(1).some(r=>pointInRing(p,r)));
 const inArea=(p,rings)=>pointInRing(p,rings[0])&&!rings.slice(1).some(r=>pointInRing(p,r));
 const canStand=(p,elevation=height)=>(openGround?distance(p,openGround.center)<=openGround.radius:supported(p))&&!blocked(p)&&!blockedByBarrier(p,elevation)&&(!nearby(lakes,p).some(r=>inArea(p,r))||supported(p));
 const canTravel=(a,b,elevation=height)=>{const n=Math.max(1,Math.ceil(distance(a,b)/.20));for(let i=1;i<=n;i++)if(!canStand([a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n],elevation))return false;return true;};
 return {canStand,canTravel,setBarriers(next){barriers=next;},setHeight(value){height=value;},settle(p){if(!blockedByBarrier(p,0))return p;for(let r=.4;r<=5;r+=.4)for(let a=0;a<Math.PI*2;a+=Math.PI/8){const q=[p[0]+Math.cos(a)*r,p[1]+Math.sin(a)*r];if(!blockedByBarrier(q,0)&&canStand(q))return q;}return p;},move(position,vector,metres){
  let p=[...position];const magnitude=Math.hypot(...vector);if(magnitude<1e-8||metres<=0)return p;const steps=Math.max(1,Math.ceil(metres/.4)),delta=vector.map(v=>v/magnitude*metres/steps);
  for(let step=0;step<steps;step++){const next=[p[0]+delta[0],p[1]+delta[1]];if(canStand(next)){p=next;continue;}
   // Slide along the contacted street edge or façade; never bounce into reverse.
   const tangents=nearby(roads,p).map(s=>segmentProjection(p,s.a,s.b).tangent);
   for(const b of nearby(walls,p))for(const ring of [b.ring,...(b.holesLocal??[])])for(let i=1;i<ring.length;i++){const hit=segmentProjection(p,ring[i-1],ring[i]);if(hit.distance<3)tangents.push(hit.tangent);}
   let best=p,bestProgress=.001;for(const tangent of tangents){const amount=dot(delta,tangent),candidate=[p[0]+tangent[0]*amount,p[1]+tangent[1]*amount],progress=dot([candidate[0]-p[0],candidate[1]-p[1]],delta);if(progress>bestProgress&&canStand(candidate)){best=candidate;bestProgress=progress;}}if(best===p)break;p=best;
  }return p;
 }};
}
