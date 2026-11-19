import {distance,makeRoute,nearest,sampleRoute,shortestPath} from './streets.mjs';
import {carriesRoadTraffic,collectTrafficCircuits} from './traffic.mjs';
import {pointInRing,segmentProjection} from './walking.mjs';
import {ENCOUNTER_RETAIN_DISTANCE} from './hazard-population.mjs';

const colors=['#f97367','#aa84ea','#50c2cd','#f493b7','#f8b65a','#688de0'];
const gradeZero=line=>Math.abs(line.grade??0)<.1;

const positionId=(kind,point)=>kind+'-'+point.map(value=>Math.round(value/2)).join(':');
const sprinklerRadius=4.8;
const trashRadius=4.5;
const binSetback=1.6;
const crossingRadius=1.65;
const hardBarrierSites=new Set([.025,.47,.875]);

function overlaps(a,b,c,d,margin){
 return Math.min(a[0],b[0])-margin<=Math.max(c[0],d[0])&&Math.max(a[0],b[0])+margin>=Math.min(c[0],d[0])&&
  Math.min(a[1],b[1])-margin<=Math.max(c[1],d[1])&&Math.max(a[1],b[1])+margin>=Math.min(c[1],d[1]);
}

function lineGap(a,b,c,d){
 const side=(x,y,p)=>(y[0]-x[0])*(p[1]-x[1])-(y[1]-x[1])*(p[0]-x[0]);
 const cuts=side(a,b,c)*side(a,b,d)<=0&&side(c,d,a)*side(c,d,b)<=0;
 if(cuts&&overlaps(a,b,c,d,0))return 0;
 return Math.min(segmentProjection(a,c,d).distance,segmentProjection(b,c,d).distance,
  segmentProjection(c,a,b).distance,segmentProjection(d,a,b).distance);
}

function waterClearance(areas){
 const bodies=areas.filter(rings=>rings[0]?.length>=4).map(([outer,...holes])=>{
  const xs=outer.map(point=>point[0]),zs=outer.map(point=>point[1]);
  const bounds=[[Math.min(...xs),Math.min(...zs)],[Math.max(...xs),Math.max(...zs)]];
  const edges=[outer,...holes].flatMap(ring=>ring.map((point,i)=>[point,ring[(i+1)%ring.length]]));
  const submerged=point=>pointInRing(point,outer)&&!holes.some(hole=>pointInRing(point,hole));
  return {bounds,edges,submerged};
 });
 return (a,b,margin)=>!bodies.some(({bounds,edges,submerged})=>{
  if(!overlaps(a,b,...bounds,margin))return false;
  if(submerged(a)||submerged(b))return true;
  return edges.some(([c,d])=>overlaps(a,b,c,d,margin)&&lineGap(a,b,c,d)<=margin);
 });
}

function buildTraffic(lines,surface,position,difficulty,minRange,maxRange,retained,aboveWater){
 const isRegional=minRange>=85;
 const nearbyVehicle=vehicleProximity(retained);
 const circuits=collectTrafficCircuits(lines,surface,position).filter(({route,near})=>{
  if(route.points.some((point,i)=>i>0&&!aboveWater(route.points[i-1],point,3.3)))return false;
  if(!isRegional)return true;
  if(near<minRange||near>maxRange)return false;
  const samples=Math.ceil(route.length/14);
  let overlap=0;
  for(let i=0;i<samples;i++){
   if(nearbyVehicle(sampleRoute(route,route.length*i/samples).p))overlap++;
   if(overlap>samples*.25)return false;
  }
  return true;
 });
 const preferred=isRegional?minRange+35:26;
 const ranking=circuits.sort((a,b)=>Math.abs(a.near-preferred)-Math.abs(b.near-preferred));
 const limit=isRegional?(difficulty===3?12:10):[10,18,22,34][difficulty];
 const tracks=ranking.slice(0,limit).map((circuit,index)=>{
  const {length}=circuit.route;
  const slots=difficulty===0?(length>=280?2:1):difficulty===1?(length>=180?2:1):
   Math.min(difficulty===2?3:4,1+Math.floor(length/(difficulty===2?102:85)));
  return {circuit,index,slots,count:1};
 });
 let available=limit-tracks.length;
 for(let slot=1;slot<4&&available;slot++)for(const track of tracks){
  if(!available)break;
  if(slot>=track.slots)continue;
  track.count++;
  available--;
 }

 return tracks.flatMap(({circuit,index,count})=>{
  const {route,along}=circuit;
  const bus=index===0&&!isRegional&&route.length>=138;
  const kinds=Array.from({length:count},(_,slot)=>{
   if(slot===0){
    if(bus)return 'bus';
    if(difficulty>0&&index%7===4)return 'bike';
    if(difficulty>0&&index%7===5)return 'scooter';
    return 'car';
   }
   if(difficulty===0)return 'car';
   if(slot===1)return ['car','bike','scooter','car'][index%4];
   return ['bike','scooter','car'][(index+slot-2)%3];
  });
  // Shared travel speed fixes headways on loops that carry several vehicle types.
  const pace=bus?6.5:kinds.some(kind=>kind==='bike'||kind==='scooter')?6.8:difficulty===3?9.4:8.5;
  const min=route.points.reduce(([x,z],[a,b])=>[Math.min(x,a),Math.min(z,b)],[Infinity,Infinity]);
  const max=route.points.reduce(([x,z],[a,b])=>[Math.max(x,a),Math.max(z,b)],[-Infinity,-Infinity]);
  const id=positionId('vehicle',[...min,...max,route.length]);
  return kinds.map((kind,slot)=>{
   const offset=-18-index%4*11+slot*route.length/count;
   const phase=(along+offset+route.length)%route.length;
   const start=sampleRoute(route,phase);
   return {id:id+':'+slot,kind,color:kind==='bus'?'#f4ba48':colors[(index+slot)%colors.length],
    point:start.p,route,phase,speed:pace,heading:start.heading};
  });
 });
}

function foodApproaches(graph,position,food){
 const start=nearest(graph,position);
 if(!start)return [];
 const nearby=food.filter(item=>distance(item.point,position)<170)
  .sort((a,b)=>distance(a.point,position)-distance(b.point,position)).slice(0,6);
 return nearby.flatMap(item=>{
  const goal=graph.nodes.get(item.nodeId)??nearest(graph,item.point);
  if(!goal)return [];
  const points=shortestPath(graph,start.id,goal.id).map(id=>graph.nodes.get(id).p);
  return points.slice(1).map((point,i)=>[points[i],point]);
 });
}

function crossesClosure(from,to,closure,padding=0){
 const {a,b,radius}=closure,limit=radius+padding;
 if(segmentProjection(closure.point,from,to).distance>closure.width+limit)return false;
 if(segmentProjection(from,a,b).distance<limit||segmentProjection(to,a,b).distance<limit||
    segmentProjection(a,from,to).distance<limit||segmentProjection(b,from,to).distance<limit)return true;
 const dx=b[0]-a[0],dz=b[1]-a[1];
 const side=p=>(p[0]-a[0])*dz-(p[1]-a[1])*dx;
 const start=side(from),end=side(to);
 if(start*end>=0)return false;
 const t=start/(start-end);
 return segmentProjection([from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t],a,b).distance<limit;
}

function closureDetour(graph,surface,closure,before,after){
 const blocks=point=>segmentProjection(point,closure.a,closure.b).distance<closure.radius;
 const nodes=[before,after].map(point=>nearest(graph,point));
 if(nodes.some((node,i)=>!node||distance(node.p,[before,after][i])>6||blocks(node.p)))return false;
 if(nodes[0].id===nodes[1].id)return false;
 const visited=new Set([nodes[0].id]),queue=[nodes[0]];
 for(let index=0;index<queue.length;index++){
  const node=queue[index];
  if(node.id===nodes[1].id)return true;
  for(const {id} of node.links){
   if(visited.has(id))continue;
   const next=graph.nodes.get(id);
   if(distance(next.p,closure.point)>232||blocks(next.p))continue;
   if(crossesClosure(node.p,next.p,closure))continue;
   if(!surface.canTravel(node.p,next.p))continue;
   visited.add(id);queue.push(next);
  }
 }
 return false;
}

function makeClosure(spot,graph,surface,spawn,food,traffic,aboveWater){
 if(spot.vehicleConflict||spot.width<8.2||spot.range<42)return;
 const x=Math.cos(spot.heading),z=-Math.sin(spot.heading);
 const at=(side,depth)=>[spot.point[0]+x*side-z*depth,spot.point[1]+z*side+x*depth];
 // A full closure only belongs where a wall joins each end of the fence.
 const reachesWall=sign=>{
  for(let side=4.1;side<=17;side+=.7){
   if([-5,-4,-3,-2,-1,0,1,2,3,4,5].every(depth=>!surface.canStand(at(side*sign,depth))))return side*sign;
  }
 };
 const left=reachesWall(-1),right=reachesWall(1);
 if(left===undefined||right===undefined)return;
 const truckFits=[-3.6,3.6].every(side=>[-3.7,3.7].every(depth=>surface.canStand(at(side,depth))));
 if(!truckFits)return;
 const radius=4.35,a=at(left,0),b=at(right,0);
 const impact=point=>segmentProjection(point,a,b).distance<radius+1;
 if(impact(spawn)||food.some(item=>impact(item.point)))return;
 if(!aboveWater(a,b,5)||!aboveWater(at(0,-7),at(0,7),4.35))return;
 const closure={...spot,radius,a,b,width:right-left,fenceOffset:(left+right)/2};
 if(traffic.some(vehicle=>vehicle.route.points.some((point,i,points)=>i>0&&crossesClosure(points[i-1],point,closure,2.3))))return;
 if(!closureDetour(graph,surface,closure,at(0,-8),at(0,8)))return;
 return {...closure,works:true,kind:'barrier',height:7.5};
}

function vehicleProximity(vehicles){
 const cells=new Map(),size=12;
 for(const route of new Set(vehicles.map(vehicle=>vehicle.route))){
  for(let metres=0;metres<route.length;metres+=6){
   const {p}=sampleRoute(route,metres);
   const key=p.map(value=>Math.floor(value/size)).join(':');
   const cell=cells.get(key)??[];
   cell.push(p);
   cells.set(key,cell);
  }
 }
 return (point,clearance=7.5)=>{
  const [x,z]=point.map(value=>Math.floor(value/size));
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
   const cell=cells.get(`${x+dx}:${z+dz}`);
   if(cell?.some(sample=>distance(point,sample)<clearance))return true;
  }
  return false;
 };
}

function canBypass(spot,surface,clearance){
 const {point,heading}=spot;
 const x=Math.cos(heading),z=-Math.sin(heading);
 const at=(side,along)=>[point[0]+x*side-z*along,point[1]+z*side+x*along];
 return [-clearance,clearance].some(offset=>{
  const before=at(offset,-9),after=at(offset,9);
  return surface.canStand(before)&&surface.canTravel(at(0,-9),before)&&
   surface.canTravel(before,after)&&surface.canTravel(after,at(0,9));
 });
}

const phaseAt=(point,period)=>((point[0]*.173+point[1]*.287)%period+period)%period;

function roadClearance(roadLines,position,far){
 const roadCells=new Map(),cellSize=24;
 for(const road of roadLines){
  const halfWidth=Math.max(1.5,(road.width??7)/2),radius=halfWidth+sprinklerRadius;
  for(let i=1;i<road.points.length;i++){
   const a=road.points[i-1],b=road.points[i];
   if(segmentProjection(position,a,b).distance>far+radius)continue;
   const minX=Math.floor((Math.min(a[0],b[0])-radius)/cellSize);
   const maxX=Math.floor((Math.max(a[0],b[0])+radius)/cellSize);
   const minZ=Math.floor((Math.min(a[1],b[1])-radius)/cellSize);
   const maxZ=Math.floor((Math.max(a[1],b[1])+radius)/cellSize);
   const segment={a,b,halfWidth};
   for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){
    const key=`${x}:${z}`,cell=roadCells.get(key)??[];
    cell.push(segment);
    roadCells.set(key,cell);
   }
  }
 }
 return (point,margin)=>{
  const [x,z]=point;
  const roads=roadCells.get(`${Math.floor(x/cellSize)}:${Math.floor(z/cellSize)}`);
  return !roads?.some(({a,b,halfWidth})=>segmentProjection(point,a,b).distance<halfWidth+margin);
 };
}

function greenSpots(areas,surface,position,far,eligible,offRoad,aboveWater){
 const samples=[];
 for(const rings of areas){
  const [outline,...holes]=rings;
  if(!outline?.length)continue;
  const xs=outline.map(point=>point[0]),zs=outline.map(point=>point[1]);
  const minX=Math.max(Math.min(...xs),position[0]-far),maxX=Math.min(Math.max(...xs),position[0]+far);
  const minZ=Math.max(Math.min(...zs),position[1]-far),maxZ=Math.min(Math.max(...zs),position[1]+far);
  for(let x=Math.ceil(minX/10)*10;x<maxX;x+=10)for(let z=Math.ceil(minZ/10)*10;z<maxZ;z+=10){
   const point=[x,z],range=distance(point,position);
   if(!pointInRing(point,outline)||holes.some(ring=>pointInRing(point,ring))||!eligible(point,range))continue;
   const nearBoundary=rings.some(ring=>ring.some((next,i)=>i>0&&
    segmentProjection(point,ring[i-1],next).distance<sprinklerRadius));
   if(nearBoundary||!offRoad(point,sprinklerRadius)||!aboveWater(point,point,sprinklerRadius))continue;
   if(!surface.canStand(point))continue;
   samples.push({point,heading:0,range,vehicleConflict:false,approachGap:35});
  }
 }
 return samples;
}

function pavementSpots(areas,surface,position,far,eligible,offRoad,aboveWater){
 const samples=[];
 for(const [outline,...holes] of areas){
  if(!outline?.length)continue;
  for(let i=1;i<outline.length;i++){
   const a=outline[i-1],b=outline[i],length=distance(a,b);
   if(length<3||segmentProjection(position,a,b).distance>far+binSetback)continue;
   const dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length,heading=Math.atan2(dx,dz);
   const count=Math.ceil(length/9);
   for(let index=0;index<count;index++)for(const side of [-1,1]){
    const along=length*(index+.5)/count;
    const point=[a[0]+dx*along+dz*binSetback*side,a[1]+dz*along-dx*binSetback*side];
    const range=distance(point,position);
    if(!pointInRing(point,outline)||holes.some(ring=>pointInRing(point,ring))||!eligible(point,range))continue;
    if(!offRoad(point,binSetback)||!aboveWater(point,point,trashRadius)||!surface.canStand(point))continue;
    samples.push({point,heading,range,vehicleConflict:false,approachGap:35});
   }
  }
 }
 return samples;
}

function crossingWidth(spot,surface,food,aboveWater){
 if(spot.roadWidth<7||spot.roadWidth>22)return;
 const x=Math.cos(spot.heading),z=-Math.sin(spot.heading);
 const at=offset=>[spot.point[0]+x*offset,spot.point[1]+z*offset];
 for(const apron of [1.5,1.0,0.65]){
  const half=spot.roadWidth/2+apron,a=at(-half),b=at(half);
  if(!aboveWater(a,b,crossingRadius)||!surface.canStand(a)||!surface.canTravel(a,b,0))continue;
  if(food.some(item=>segmentProjection(item.point,a,b).distance<11))continue;
  return half*2;
 }
}

/** Add a dense but escapable mix of encounters between the two radial bounds. */
export function buildEncounters(lines,graph,surface,position,food,{
 minRange=24,maxRange=285,difficulty=1,traffic:includeTraffic=true,allowClosures=true,allowCrowds=allowClosures,
 existing=[],greenAreas=[],pavementAreas=[],waterAreas=[],
}={}){
 const level=Math.max(0,Math.min(3,Math.round(difficulty)));
 const aboveWater=waterClearance(waterAreas);
 const retainedTraffic=existing.filter(hazard=>hazard.route);
 const traffic=includeTraffic?buildTraffic(lines,surface,position,level,minRange,maxRange,retainedTraffic,aboveWater):[];
 const vehicles=[...retainedTraffic,...traffic];
 const nearVehicle=vehicleProximity(vehicles);
 const approaches=foodApproaches(graph,position,food);
 const retained=existing.filter(hazard=>!hazard.route);
 const far=Math.max(minRange,maxRange);
 const placeRange=fraction=>minRange+(far-minRange)*fraction;
 const eligible=(point,range)=>range>minRange&&range<far&&
  !food.some(item=>distance(item.point,point)<11)&&!retained.some(hazard=>distance(hazard.point,point)<18);
 const ground=lines.filter(gradeZero);
 const spots=ground.filter(carriesRoadTraffic).flatMap(line=>{
  const route=makeRoute(line.points);
  if(route.length<13||line.width<7)return [];
  const count=Math.max(2,Math.ceil(route.length/13));
  const samples=[];
  for(let index=0;index<count;index++){
   const sample=sampleRoute(route,route.length*(index+.5)/count);
   const range=distance(sample.p,position);
   if(!eligible(sample.p,range)||!surface.canStand(sample.p))continue;
   let approachGap=35;
   if(range<placeRange(.55))for(const [start,end] of approaches){
    approachGap=Math.min(approachGap,segmentProjection(sample.p,start,end).distance);
    if(approachGap<1)break;
   }
   samples.push({point:sample.p,heading:sample.heading,roadWidth:line.width,
    width:Math.min(12,Math.max(6,line.width)),range,vehicleConflict:nearVehicle(sample.p),approachGap});
  }
  return samples;
 });
 const offRoad=roadClearance(ground,position,far);
 const greens=greenSpots(greenAreas,surface,position,far,eligible,offRoad,aboveWater);
 const pavement=pavementSpots(pavementAreas,surface,position,far,eligible,offRoad,aboveWater);
 const specialSites={sprinkler:greens,trash:pavement,crowd:[...spots,...pavement]};
 const hazards=[];
 const usedSpot=point=>hazards.some(hazard=>distance(hazard.point,point)<18);
 const add=(kind,fraction)=>{
  const target=placeRange(fraction);
  const score=spot=>Math.abs(spot.range-target)+(spot.vehicleConflict?24:0)+
   (fraction<.58?spot.approachGap*.62:0);
  const candidates=specialSites[kind]??spots;
  const ranked=candidates.filter(spot=>!usedSpot(spot.point)).sort((a,b)=>score(a)-score(b));
  if(kind==='works'){
   if(allowClosures&&level>0)for(const candidate of ranked.slice(0,64)){
    const closure=makeClosure(candidate,graph,surface,position,food,vehicles,aboveWater);
    if(!closure)continue;
    hazards.push({...closure,id:positionId('works',closure.point)});
    return;
   }
   add('barrier',fraction);
   return;
  }
  if(kind==='pedestrian'){
   for(const point of ranked){
    if([...retained,...hazards].some(hazard=>hazard.kind==='pedestrian'&&distance(hazard.point,point.point)<90))continue;
    const width=crossingWidth(point,surface,food,aboveWater);
    if(!width)continue;
    hazards.push({...point,id:positionId(kind,point.point),kind,width,radius:crossingRadius,phase:phaseAt(point.point,16)});
    return;
   }
   return;
  }
  const radius={crowd:6,poop:3.1,pothole:3.4,sprinkler:sprinklerRadius,trash:trashRadius,barrier:1.1}[kind];
  const barrierEnds=({point,heading,width})=>{
   const x=Math.cos(heading)*width/2,z=-Math.sin(heading)*width/2;
   return {a:[point[0]-x,point[1]-z],b:[point[0]+x,point[1]+z]};
  };
  const spot=ranked.find(candidate=>{
   const {point,vehicleConflict}=candidate;
   if(kind==='barrier'){
    const {a,b}=barrierEnds(candidate);
    return !vehicleConflict&&aboveWater(a,b,2);
   }
   if(!aboveWater(point,point,radius))return false;
   if(kind==='crowd')return !nearVehicle(point,9.5)&&canBypass(candidate,surface,7.5);
   if(kind==='trash')return !vehicleConflict&&canBypass(candidate,surface,6);
   return kind!=='poop'||!vehicleConflict;
  });
  if(!spot){
   if(kind==='barrier')add('pothole',fraction);
   return;
  }
  const hazard={...spot,id:positionId(kind,spot.point),kind,radius};
  if(kind==='sprinkler')hazard.phase=phaseAt(spot.point,8);
  if(kind==='barrier')Object.assign(hazard,{...barrierEnds(spot),height:3.6});
  hazards.push(hazard);
 };
 // Set aside space for the large encounters before placing the smaller obstacles.
 if(level!==3||allowClosures)add('works',.16);
 const hasNearbyCrowd=retained.some(hazard=>hazard.kind==='crowd'&&distance(hazard.point,position)<ENCOUNTER_RETAIN_DISTANCE);
 if(level>=1&&allowCrowds&&!hasNearbyCrowd)add('crowd',minRange>=85?.16:.27);
 const placements=[
  ['barrier',.025],['pothole',.045],['trash',.075,1],['sprinkler',.105],
  ['barrier',.205,1],['barrier',.225],['trash',.28],['pothole',.32],['pothole',.36,1],
  ['pedestrian',.41,1],['barrier',.47],['trash',.545],['sprinkler',.565,1],['pothole',.60],
  ['barrier',.64,1],['trash',.67],['poop',.695],['pothole',.725,1],['sprinkler',.795],
  ['trash',.835,1],['barrier',.875],['pothole',.95],['barrier',.98],
 ];
 for(const [kind,fraction,minLevel=0] of placements){
  if(level<minLevel||level===3&&kind==='barrier'&&!hardBarrierSites.has(fraction))continue;
  add(kind,fraction);
 }
 if(level>=2)for(const [kind,fraction] of [['trash',.12],['pothole',.31],['sprinkler',.58]])add(kind,fraction);
 if(level>=3)add('pedestrian',.69);
 return [...hazards,...traffic];
}
