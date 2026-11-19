import {distance} from './streets.mjs';
import {segmentProjection} from './walking.mjs';

const directions=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

/** A* checks actual ground and hazards. The grid starts exactly at the dog. */
function* searchGrid(start,goal,canStand,{step=2,maxVisited=18000,padding=55,sampleStep=.35}={}){
 const min=[Math.min(start[0],goal[0])-padding,Math.min(start[1],goal[1])-padding];
 const max=[Math.max(start[0],goal[0])+padding,Math.max(start[1],goal[1])+padding];
 const point=(x,z)=>[start[0]+x*step,start[1]+z*step];
 const key=(x,z)=>`${x}:${z}`;
 const cache=new Map();
 function clear(p){
  const k=key(Math.round(p[0]*100),Math.round(p[1]*100));
  if(!cache.has(k))cache.set(k,p[0]>=min[0]&&p[0]<=max[0]&&p[1]>=min[1]&&p[1]<=max[1]&&canStand(p));
  return cache.get(k);
 }
 const sampleCount=(a,b)=>Math.max(1,Math.ceil(distance(a,b)/sampleStep));
 const interpolate=(a,b,u)=>[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u];
 function segment(a,b){
  const steps=sampleCount(a,b);
  for(let i=1;i<=steps;i++)if(!clear(interpolate(a,b,i/steps)))return false;
  return true;
 }
 // A clear straight route needs no grid search. Check it at the same resolution.
 const steps=sampleCount(start,goal);
 let unobstructed=true;
 for(let i=1;i<=steps;i++){
  if(!clear(interpolate(start,goal,i/steps))){unobstructed=false;break;}
  if(i%32===0)yield;
 }
 if(unobstructed)return [start,goal];

 const heap=[],nodes=new Map();
 function push(node){
  let index=heap.length;
  heap.push(node);
  while(index>0){
   const parent=(index-1)>>1;
   if(heap[parent].f<=node.f)break;
   heap[index]=heap[parent];
   index=parent;
  }
  heap[index]=node;
 }
 function pop(){
  const first=heap[0],last=heap.pop();
  if(heap.length){
   let index=0;
   while(index*2+1<heap.length){
    let child=index*2+1;
    if(child+1<heap.length&&heap[child+1].f<heap[child].f)child++;
    if(heap[child].f>=last.f)break;
    heap[index]=heap[child];
    index=child;
   }
   heap[index]=last;
  }
  return first;
 }

 const seed={x:0,z:0,g:0,f:distance(start,goal),p:start,previous:null};
 nodes.set('0:0',seed);
 push(seed);
 for(let visited=0;heap.length&&visited<maxVisited;visited++){
  yield;
  const current=pop();
  if(nodes.get(key(current.x,current.z))!==current)continue;
  if(distance(current.p,goal)<=step*1.5&&segment(current.p,goal)){
   const path=[goal];
   for(let node=current;node;node=node.previous)path.push(node.p);
   path.reverse();
   const smooth=[path[0]];
   for(let i=0;i<path.length-1;){
    yield;
    let j=Math.min(path.length-1,i+10);
    while(j>i+1&&!segment(path[i],path[j]))j--;
    smooth.push(path[j]);
    i=j;
   }
   return smooth;
  }
  for(const [dx,dz] of directions){
   const x=current.x+dx,z=current.z+dz,k=key(x,z),p=point(x,z);
   const g=current.g+step*Math.hypot(dx,dz);
   if(g>=(nodes.get(k)?.g??Infinity)||!clear(p)||!segment(current.p,p))continue;
   const next={x,z,g,f:g+distance(p,goal),p,previous:current};
   nodes.set(k,next);
   push(next);
  }
 }
 return [];
}

function* searchScentPath(start,goal,canStand,options={}){
 if(options.maxVisited<=0||!canStand(goal))return [];
 const path=yield* searchGrid(start,goal,canStand,options);
 if(path.length||options.padding!==undefined)return path;
 // A long block or park can force a detour well outside the local search.
 // Widen the grid while keeping the same collision sampling along each edge.
 return yield* searchGrid(start,goal,canStand,{
  ...options,step:Math.max(2.5,options.step??2),padding:160,
 });
}

export function findScentPath(start,goal,canStand,options){
 const search=searchScentPath(start,goal,canStand,options);
 let progress=search.next();
 while(!progress.done)progress=search.next();
 return progress.value;
}

export async function findScentPathAsync(start,goal,canStand,options,shouldContinue=()=>true){
 const search=searchScentPath(start,goal,canStand,options);
 while(shouldContinue()){
  const deadline=performance.now()+4;
  do{
   const progress=search.next();
   if(progress.done)return shouldContinue()?progress.value:[];
  }while(performance.now()<deadline);
  await new Promise(resolve=>setTimeout(resolve,0));
 }
 return [];
}

/** Join a valid trail through the nearest reachable segment, even between distant waypoints. */
export function joinScentPath(path,position,canTravel,maxGap=24){
 let best,smallestGap=maxGap;
 for(let i=1;i<path.length;i++){
  const {point,distance:gap}=segmentProjection(position,path[i-1],path[i]);
  if(gap>smallestGap||!canTravel(position,point))continue;
  best=[position,point,...path.slice(i)];
  smallestGap=gap;
 }
 return best??[];
}

export const SCENT_TRAIL_SECONDS=4;
export function trailEnvelope(remaining){const elapsed=SCENT_TRAIL_SECONDS-remaining;return {draw:Math.max(0,Math.min(1,elapsed/.72)),opacity:remaining<=0?0:Math.min(1,elapsed/.22,remaining/1.15)};}
