import {makeStreetGraph} from './network.mjs';
import {distance,makeRoute,shortestPath} from './streets.mjs';
import {segmentProjection} from './walking.mjs';

const midpoint=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const edgeKey=(a,b)=>a<b?a+'|'+b:b+'|'+a;

export const carriesRoadTraffic=line=>line.vehicleRoad!==false&&!line.parkPath;

export function nearestOnRoute(route,point){
 let nearest={distance:Infinity,along:0};
 for(let i=1;i<route.points.length;i++){
  const hit=segmentProjection(point,route.points[i-1],route.points[i]);
  if(hit.distance>=nearest.distance)continue;
  nearest={distance:hit.distance,along:route.cumulative[i-1]+hit.t*(route.cumulative[i]-route.cumulative[i-1])};
 }
 return nearest;
}

function roundCorners(points){
 const corners=points.filter((point,index)=>{
  const previous=points[(index+points.length-1)%points.length];
  const next=points[(index+1)%points.length];
  return segmentProjection(point,previous,next).distance>.18;
 });
 if(corners.length<3)return points;
 return corners.flatMap((point,index)=>{
  const previous=corners[(index+corners.length-1)%corners.length];
  const next=corners[(index+1)%corners.length];
  const incoming=distance(previous,point),outgoing=distance(point,next);
  const cut=Math.min(4,incoming*.27,outgoing*.27);
  const start=lerp(point,previous,cut/incoming),end=lerp(point,next,cut/outgoing);
  return [0,.25,.5,.75,1].map(t=>lerp(lerp(start,point,t),lerp(point,end,t),t));
 });
}

function offsetLane(points,offset){
 return points.map((point,index)=>{
  const previous=points[(index+points.length-1)%points.length];
  const next=points[(index+1)%points.length];
  const length=distance(previous,next)||1;
  return [point[0]+(next[1]-previous[1])*offset/length,point[1]-(next[0]-previous[0])*offset/length];
 });
}

/** Find circular routes on connected ground-level streets. A cul-de-sac has no route. */
export function collectTrafficCircuits(lines,surface,spawn){
 const closeLines=lines.filter(line=>carriesRoadTraffic(line)&&line.width>=7&&Math.abs(line.grade??0)<.1&&
  line.points.some((point,i)=>i>0&&segmentProjection(spawn,line.points[i-1],point).distance<440));
 const graph=makeStreetGraph(closeLines);
 const safe=(a,b)=>segmentProjection(spawn,a,b).distance>10&&surface.canTravel(a,b);
 const roadClearance=new Map();
 for(const node of graph.nodes.values())node.links=node.links.filter(link=>{
  const key=edgeKey(node.id,link.id);
  if(!roadClearance.has(key))roadClearance.set(key,safe(node.p,graph.nodes.get(link.id).p));
  return roadClearance.get(key);
 });

 const seeds=new Map();
 for(const node of graph.nodes.values())for(const link of node.links){
  if(node.id>=link.id)continue;
  const other=graph.nodes.get(link.id),middle=midpoint(node.p,other.p),range=distance(spawn,middle);
  if(range>345)continue;
  const cell=middle.map(value=>Math.floor(value/22)).join(':');
  if(!seeds.has(cell)||range<seeds.get(cell).range)seeds.set(cell,{node,other,range});
 }

 const routes=[],seen=new Set();
 const ordered=[...seeds.values()].sort((a,b)=>a.range-b.range);
 const nearby=ordered.filter(seed=>seed.range<130).slice(0,65);
 const farther=ordered.filter(seed=>seed.range>=130).filter((_,index)=>index%3===0).slice(0,50);
 for(const {node,other} of [...nearby,...farther]){
  const direct=edgeKey(node.id,other.id);
  if(seen.has(direct))continue;
  const from=node.links,to=other.links;
  node.links=from.filter(link=>link.id!==other.id);
  other.links=to.filter(link=>link.id!==node.id);
  const path=shortestPath(graph,other.id,node.id);
  node.links=from;
  other.links=to;
  if(path.length<4)continue;
  const center=path.map(id=>graph.nodes.get(id).p);
  const route=makeRoute([...center,center[0]]);
  if(route.length<102||route.length>680)continue;
  const edges=[direct,...path.slice(1).map((id,i)=>edgeKey(path[i],id))];
  // Allow brief shared junctions without putting vehicles on the same lane for long stretches.
  if(edges.filter(key=>seen.has(key)).length>edges.length*.05)continue;

  const rounded=roundCorners(center);
  const lane=offsetLane(rounded,1.5);
  const fits=points=>points.every((point,index)=>safe(point,points[(index+1)%points.length]));
  const points=[lane,rounded,center].find(fits);
  if(!points)continue;
  edges.forEach(key=>seen.add(key));
  const circuit={...makeRoute([...points,points[0]]),loop:true};
  const nearest=nearestOnRoute(circuit,spawn);
  routes.push({route:circuit,near:nearest.distance,along:nearest.along});
  if(routes.length>=23)break;
 }
 return routes;
}
