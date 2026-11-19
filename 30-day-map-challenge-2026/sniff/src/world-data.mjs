import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {toLocal,toLngLat,distance} from './streets.mjs';
import {makeStreetGraph} from './network.mjs';
const Z=15,N=2**Z,cache=new Map(),detailCache=new Map();let descriptor,detailDescriptor;
const tileAt=p=>[(p[0]+180)/360*N,(1-Math.asinh(Math.tan(p[1]*Math.PI/180))/Math.PI)/2*N];
export function category(p){
 const type=`${p.type??''} ${p.icon??''}`.toLowerCase();
 const name=String(p.name??'').toLowerCase();
 const cuisine=String(p.cuisine??'').toLowerCase().replaceAll('_',' ');
 const foodBusiness=/food-drink|retail/.test(String(p.class));
 if(/bakery|pastry/.test(type)||foodBusiness&&/bakery|panader[ií]a|pasteler[ií]a|p[aâ]tisserie|boulangerie|パン屋/.test(name))return 'bread';
 if(/ice_cream|ice cream|gelato/.test(type)||foodBusiness&&/ice[ -]cream|gelato|helader[ií]a|sorvete|アイスクリーム/.test(name))return 'iceCream';
 const eatery=/restaurant|fast_food|food_court|casual_eatery/.test(type);
 if(eatery||foodBusiness){
  const detail=`${type} ${cuisine} ${name}`;
  if(/pizza|pizzer[ií]a|ピザ/.test(detail))return 'pizza';
  if(/ramen|noodle|ラーメン|らーめん/.test(detail))return 'ramen';
  if(/burger|hamb[uú]rguer|hamburguesa|バーガー/.test(detail))return 'burger';
 }
 if(/cafe|coffee/.test(type))return 'coffee';
 if(eatery)return 'food';
 return null;
}
function venueType(properties,kind){
 if(kind==='bread')return 'bakery';
 if(kind==='coffee')return 'cafe';
 if(kind==='iceCream')return 'iceCream';
 return ['fast_food','fast_food_restaurant'].includes(properties.type)?'fastFood':'restaurant';
}
const hash=s=>{let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
const inside=(p,ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
function edgeDistance(p,ring){let result=Infinity;for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));result=Math.min(result,distance(p,[a[0]+t*dx,a[1]+t*dz]));}return result;}
function pointCoordinates(geometry){
 if(geometry.type==='Point')return [geometry.coordinates];
 return geometry.type==='MultiPoint'?geometry.coordinates:[];
}
async function getEntrances(x,y,worldDescriptor){
 x=(x%N+N)%N;
 if(y<0||y>=N)return [];
 const key=`${x}/${y}`;
 if(detailCache.has(key))return detailCache.get(key);
 const task=(async()=>{
  const worldMeta=await worldDescriptor;
  const release=worldMeta.tileflow?.world;
  if(release?.releaseSources&&!release.releaseSources.includes('world-detail'))return [];
  const selector=release?new URLSearchParams({worldReleaseId:release.releaseId,worldDescriptorSha256:release.descriptorSha256}):'';
  detailDescriptor??=fetch(`https://api.tileflow.dev/tiles/world-detail/tiles.json${selector?'?'+selector:''}`,{signal:AbortSignal.timeout(2000)})
   .then(response=>{
    if(response.ok)return response.json();
    if(response.status===404)return null;
    throw Error('World Detail is unavailable');
   })
   .catch(error=>{detailDescriptor=undefined;throw error;});
  const detailMeta=await detailDescriptor;
  if(!detailMeta?.tiles?.length)return [];
  const url=detailMeta.tiles[0].replace('{z}',Z).replace('{x}',x).replace('{y}',y);
  const response=await fetch(url,{signal:AbortSignal.timeout(2000)});
  if(response.status===204||response.status===404)return [];
  if(!response.ok)throw Error('World entrance data is unavailable');
  const tile=new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer())));
  const layer=tile.layers.building_entrance,points=[];
  for(let i=0;i<(layer?.length??0);i++){
   const feature=layer.feature(i);
   if(feature.type===1)points.push(...pointCoordinates(feature.toGeoJSON(x,y,Z).geometry));
  }
  return points;
 })().catch(()=>{detailCache.delete(key);return [];});
 detailCache.set(key,task);
 while(detailCache.size>32)detailCache.delete(detailCache.keys().next().value);
 return task;
}
function isGreenSpace(layer,p){
 if(p.access==='private'||p.access==='no')return false;
 if(layer==='landcover')return p.class==='grass';
 return p.class==='park'&&['park','recreation_ground','village_green'].includes(p.type)||
  p.class==='garden'&&p.type==='garden'||p.class==='grass'&&['grass','meadow'].includes(p.type);
}
function usableGreenArea(ring,[x,z]){
 let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity,twiceArea=0;
 for(let i=1;i<ring.length;i++){
  const [px,pz]=ring[i],previous=ring[i-1];
  west=Math.min(west,px);south=Math.min(south,pz);
  east=Math.max(east,px);north=Math.max(north,pz);
  twiceArea+=previous[0]*pz-previous[1]*px;
 }
 const sprayRadius=4.8;
 if(Math.min(east-west,north-south)<2*sprayRadius||Math.abs(twiceArea)/2<Math.PI*sprayRadius**2)return false;
 // A large park may cover the centre even when its vertices lie outside the region.
 return Math.hypot(Math.max(west-x,0,x-east),Math.max(south-z,0,z-north))<700;
}
function environmentArea(ring){
 const total=ring.length-1;
 const center=ring.slice(0,total).reduce((point,vertex)=>[point[0]+vertex[0]/total,point[1]+vertex[1]/total],[0,0]);
 return inside(center,ring)?center:ring[0];
}
function waterEdges(ring,x,y){
 const points=[];
 let remaining=55;
 for(let i=1;i<ring.length;i++){
  const a=ring[i-1],b=ring[i],start=tileAt(a),end=tileAt(b);
  // Ignore edges introduced by vector-tile clipping.
  if([x-1,x,x+1,x+2].some(bound=>Math.abs(start[0]-bound)<.02&&Math.abs(end[0]-bound)<.02)
   ||[y-1,y,y+1,y+2].some(bound=>Math.abs(start[1]-bound)<.02&&Math.abs(end[1]-bound)<.02))continue;
  const latScale=Math.cos(Math.PI*(a[1]+b[1])/360);
  const length=Math.hypot((b[0]-a[0])*111320*latScale,(b[1]-a[1])*111320);
  while(remaining<=length){
   const t=remaining/length,point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],tile=tileAt(point);
   if(tile[0]>=x&&tile[0]<x+1&&tile[1]>=y&&tile[1]<y+1)points.push(point);
   remaining+=110;
  }
  remaining-=length;
 }
 return points;
}
const buildingBucketSize=40;
const buildingBucket=(x,z)=>`${x}:${z}`;
function buildingBuckets(buildings){
 const buckets=new Map();
 for(const b of buildings){
  for(let x=Math.floor(b.min[0]/buildingBucketSize);x<=Math.floor(b.max[0]/buildingBucketSize);x++){
   for(let z=Math.floor(b.min[1]/buildingBucketSize);z<=Math.floor(b.max[1]/buildingBucketSize);z++){
    const key=buildingBucket(x,z);
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(b);
   }
  }
 }
 return buckets;
}
function nearbyBuildings(point,buckets){
 const x=Math.floor(point[0]/buildingBucketSize),z=Math.floor(point[1]/buildingBucketSize),nearby=new Set();
 for(let dx=-1;dx<=1;dx++){
  for(let dz=-1;dz<=1;dz++){
   for(const building of buckets.get(buildingBucket(x+dx,z+dz))??[])nearby.add(building);
  }
 }
 return nearby;
}
/** A nearby entrance belongs to the footprint only when neighboring façades cannot explain it. */
export function matchBuildingEntrances(points,buildings,buckets=buildingBuckets(buildings)){
 /** @type {Map<number,number[][]>} */
 const entrances=new Map();
 const seen=new Set();
 for(const point of points){
  const key=point.map(p=>Math.round(p*4)).join(':');
  if(seen.has(key))continue;
  seen.add(key);
  let closest,closestDistance=Infinity,nextDistance=Infinity;
  for(const building of nearbyBuildings(point,buckets)){
   const gap=edgeDistance(point,building.ring);
   if(gap<closestDistance){
    nextDistance=closestDistance;
    closestDistance=gap;
    closest=building;
   }else nextDistance=Math.min(nextDistance,gap);
  }
  if(!closest?.pois.length||closestDistance>2.2||nextDistance-closestDistance<.65)continue;
  const candidates=entrances.get(closest.id)??[];
  candidates.push(point);
  entrances.set(closest.id,candidates);
 }
 return entrances;
}
function environmentPoints(tiles,center){
 /** @type {Map<string,{id:string,kind:'park'|'trees'|'coast',point:number[],name:string}>} */
 const cells=new Map();
 for(const tile of tiles){
  for(const spot of tile?.environment??[]){
   const point=toLocal(spot.coordinate);
   if(distance(point,center)>700)continue;
   const key=`${spot.kind}:${Math.floor(point[0]/105)}:${Math.floor(point[1]/105)}`;
   const current=cells.get(key);
   if(current&&(current.name||!spot.name))continue;
   const id=`${spot.kind}:${spot.coordinate.map(n=>n.toFixed(5)).join(':')}`;
   cells.set(key,{id,point,kind:spot.kind,name:spot.name});
  }
 }
 return [...cells.values()];
}
async function loadTileJobs(jobs,load){
 const results=[];
 let cursor=0;
 await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
  while(cursor<jobs.length){
   const index=cursor++,[x,y]=jobs[index];
   results[index]=await load(x,y);
  }
 }));
 return results;
}
async function loadOptionalEntrances(jobs,worldDescriptor){
 let timedOut=false,timer;
 const points=[];
 const deadline=new Promise(resolve=>{
  timer=setTimeout(()=>{timedOut=true;resolve(null);},2400);
 });
 const loading=loadTileJobs(jobs,async(x,y)=>{
  if(timedOut)return;
  const entrances=await getEntrances(x,y,worldDescriptor);
  if(!timedOut)points.push(...entrances);
 });
 await Promise.race([loading,deadline]);
 clearTimeout(timer);
 return points;
}
async function getTile(x,y){x=(x%N+N)%N;if(y<0||y>=N)return null;const key=`${x}/${y}`;if(cache.has(key))return cache.get(key);
 const task=(async()=>{descriptor??=fetch('https://api.tileflow.dev/tiles/world/tiles.json').then(r=>{if(!r.ok)throw Error('World is unavailable');return r.json();}).catch(e=>{descriptor=undefined;throw e;});const meta=await descriptor;const url=meta.tiles[0].replace('{z}',Z).replace('{x}',x).replace('{y}',y);const response=await fetch(url);if(!response.ok)throw Error(`World tile ${response.status}`);const vt=new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer())));const output={roads:[],streetLabels:[],places:[],areas:[],water:[],buildings:[],pois:[],environment:[],greenAreas:[],parkTrees:[],parkFurniture:[]};
 for(const name of ['road','road_label','place_label','sidewalk','water','building','poi_label','landuse','landcover','tree','street_furniture']){const layer=vt.layers[name];if(!layer)continue;for(let i=0;i<layer.length;i++){const f=layer.feature(i),p=f.properties;
  if(name==='road'||name==='sidewalk'){
   if(p.class==='transit'||/motorway|trunk|rail|subway|ferry/.test(String(p.type))||p.foot==='no'||p.access==='private'||p.indoor||p.underground)continue;
   const geo=f.toGeoJSON(x,y,Z).geometry;
   if(f.type===2){
    const lines=geo.type==='LineString'?[geo.coordinates]:geo.coordinates;
    const type=String(p.type),roadClass=String(p.class);
    const fallback=/footway|path|steps|cycleway/.test(type)?4:/primary|secondary|tertiary/.test(type)?18:/service/.test(type)?7:11;
    const width=Math.max(3,Math.min(35,Number(p.width)||Number(p.lanes)*3.2||fallback));
    const parkPath=['footway','path','pedestrian'].includes(type);
    const vehicleRoad=name==='road'&&!['path','pedestrian','construction','ferry','rail'].includes(roadClass)
     &&!parkPath&&!['cycleway','steps','sidewalk','corridor','platform','bridleway'].includes(type)
     &&[p.access,p.vehicle,p.motor_vehicle,p.motorcar].every(access=>access!=='no'&&access!=='private');
    for(const coordinates of lines)output.roads.push({coordinates,grade:Number(p.layer)||0,width,parkPath,vehicleRoad});
   }
   if(f.type===3&&(name==='sidewalk'||/pedestrian|footway|path|living_street/.test(String(p.type)))){const polygons=geo.type==='Polygon'?[geo.coordinates]:geo.coordinates;for(const rings of polygons)output.areas.push(rings);}
  }
  if(name==='place_label'&&f.type===1&&typeof p.name==='string'&&['settlement','settlement_subdivision'].includes(p.class)){
   const geometry=f.toGeoJSON(x,y,Z).geometry;
   output.places.push({name:String(p.parent||p.name),coordinate:geometry.coordinates});
  }
  if(name==='road_label'&&f.type===2&&typeof p.name==='string'&&p.name.trim()&&!p.underground&&!p.layer&&p.class!=='transit'){
   const geometry=f.toGeoJSON(x,y,Z).geometry;
   const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.coordinates;
   for(const coordinates of lines)output.streetLabels.push({name:p.name.trim(),coordinates});
  }
  if(name==='water'&&f.type===3){
   const geo=f.toGeoJSON(x,y,Z).geometry,polygons=geo.type==='Polygon'?[geo.coordinates]:geo.coordinates;
   output.water.push(...polygons);
   if(['ocean','river','lake'].includes(p.class)){
    const label=typeof p.name==='string'?p.name.trim():'';
    for(const [ring] of polygons)for(const coordinate of waterEdges(ring,x,y))output.environment.push({kind:'coast',coordinate,name:label});
   }
  }
  if(name==='building'&&f.type===3){
   const geo=f.toGeoJSON(x,y,Z).geometry,polygons=geo.type==='Polygon'?[geo.coordinates]:geo.coordinates;
   const height=Math.max(3,Math.min(160,Number(p.height)||12));
   const minHeight=Math.max(0,Math.min(height-.1,Number(p.min_height)||0));
   for(const rings of polygons)if(rings[0]?.length>=4)output.buildings.push({rings,height,minHeight,extrude:p.extrude!==false});
  }
  if(name==='poi_label'&&f.type===1){
   const kind=category(p),park=p.class==='park-nature'&&['park','garden','nature_reserve'].includes(p.type);
   if(!kind&&!park)continue;
   const label=String(p.name??'').trim();
   const coordinates=pointCoordinates(f.toGeoJSON(x,y,Z).geometry);
   for(const coordinate of coordinates){
    if(park)output.environment.push({kind:'park',coordinate,name:label});
    if(kind){
     const id=coordinates.length===1&&f.id!==undefined?f.id:hash(JSON.stringify(coordinate)+label);
     output.pois.push({id,coordinate,name:label,category:kind,venueType:venueType(p,kind),sourceType:String(p.type??''),cuisine:String(p.cuisine??'')});
    }
   }
  }
  if((name==='landuse'||name==='landcover')&&f.type===3){
   const kind=p.type==='beach'?'coast':['park','garden'].includes(p.class)?'park':['wood','forest'].includes(p.class)||p.type==='forest'?'trees':null;
   const green=isGreenSpace(name,p);
   if(!kind&&!green)continue;
   const geo=f.toGeoJSON(x,y,Z).geometry,polygons=geo.type==='Polygon'?[geo.coordinates]:geo.coordinates;
   for(const rings of polygons){
    const [ring]=rings;
    if(ring.length<4)continue;
    if(green)output.greenAreas.push(rings);
    if(kind)output.environment.push({kind,coordinate:environmentArea(ring),name:String(p.name??'').trim()});
   }
  }
  if(name==='tree'&&f.type===1){
   for(const coordinate of pointCoordinates(f.toGeoJSON(x,y,Z).geometry)){
    output.environment.push({kind:'trees',coordinate,name:''});
    output.parkTrees.push(coordinate);
   }
  }
  if(name==='street_furniture'&&f.type===1){
   const kind=p.type==='bench'?'bench':p.type==='street_lamp'?'lamp':p.type==='fountain'?'fountain':undefined;
   if(!kind||p.underground||Number(p.layer)||[true,'yes','room'].includes(p.indoor))continue;
   for(const coordinate of pointCoordinates(f.toGeoJSON(x,y,Z).geometry))output.parkFurniture.push({kind,coordinate,height:Number(p.height)||0});
  }
 }}return output;})();cache.set(key,task);task.catch(()=>cache.delete(key));while(cache.size>32)cache.delete(cache.keys().next().value);return task;
}
/** Fetch a generous road buffer before the dog reaches the edge; rendering stays local. */
export async function loadNeighbourhood(coordinate){
 const center=toLocal(coordinate),lo=tileAt(toLngLat([center[0]-1000,center[1]-1000])),hi=tileAt(toLngLat([center[0]+1000,center[1]+1000]));
 const jobs=[];for(let x=Math.floor(lo[0]);x<=Math.floor(hi[0]);x++)for(let y=Math.floor(lo[1]);y<=Math.floor(hi[1]);y++)jobs.push([x,y]);
 const tiles=loadTileJobs(jobs,getTile);
 const entranceLo=tileAt(toLngLat([center[0]-670,center[1]-670])),entranceHi=tileAt(toLngLat([center[0]+670,center[1]+670]));
 const detailJobs=jobs.filter(([x,y])=>x>=Math.floor(entranceLo[0])&&x<=Math.floor(entranceHi[0])&&y>=Math.floor(entranceLo[1])&&y<=Math.floor(entranceHi[1]));
 const detail=loadOptionalEntrances(detailJobs,descriptor);
 const results=await tiles;
 const lines=[],streetLabels=[],areas=[],water=[],buildings=new Map(),pois=new Map();
 /** @type {number[][][][]} */
 const greenAreas=[];
 const treePoints=new Map(),furniturePoints=new Map();
 let placeName='',placeDistance=3500;
 for(const tile of results){if(!tile)continue;
  for(const place of tile.places){
   const gap=distance(toLocal(place.coordinate),center);
   if(gap<placeDistance){placeName=place.name;placeDistance=gap;}
  }
  for(const {coordinates,...road} of tile.roads){const points=coordinates.map(toLocal);if(points.some(p=>distance(p,center)<1250))lines.push({...road,points});}for(const area of tile.areas){const rings=area.map(ring=>ring.map(toLocal));if(rings[0]?.some(p=>distance(p,center)<1250))areas.push(rings);}
  for(const label of tile.streetLabels){
   const points=label.coordinates.map(toLocal);
   if(points.some(p=>distance(p,center)<1250))streetLabels.push({name:label.name,points});
  }
  for(const rings of tile.water)water.push(rings.map(r=>r.map(toLocal)));
  for(const polygon of tile.greenAreas){
   const outer=polygon[0].map(toLocal);
   if(usableGreenArea(outer,center))greenAreas.push([outer,...polygon.slice(1).map(ring=>ring.map(toLocal))]);
  }
  for(const coordinate of tile.parkTrees){
   const point=toLocal(coordinate);
   if(distance(point,center)<510)treePoints.set(point.map(value=>Math.round(value*2)).join(':'),point);
  }
  for(const item of tile.parkFurniture){
   const point=toLocal(item.coordinate);
   if(distance(point,center)<475)furniturePoints.set(item.kind+point.map(value=>Math.round(value*2)).join(':'),{kind:item.kind,point,height:item.height});
  }
  for(const b of tile.buildings){
   const [outline,...holes]=b.rings;
   const ring=outline.map(toLocal),min=[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1]))],max=[Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))];
   const c=[(min[0]+max[0])/2,(min[1]+max[1])/2];
   if(distance(c,center)>650)continue;
   const ll=toLngLat(c),key=`${ll[0].toFixed(6)}:${ll[1].toFixed(6)}`;
   // A footprint, a plinth and an elevated roof can have the same centre.
   const partId=()=>hash(`${key}:${b.extrude}:${b.minHeight}:${b.height}:${JSON.stringify(b.rings)}`);
   let id=b.minHeight>0||!b.extrude?partId():hash(key);
   if(b.extrude&&b.minHeight===0){
    const existing=buildings.get(id);
    if(existing&&(existing.height!==b.height||JSON.stringify([existing.outline,...existing.holes])!==JSON.stringify(b.rings)))id=partId();
   }
   if(!buildings.has(id))buildings.set(id,{id,outline,holes,center:c,height:b.height,minHeight:b.minHeight,extrude:b.extrude,holesLocal:holes.map(r=>r.map(toLocal)),category:null,pois:[],ring,min,max});
  }
  for(const p of tile.pois)if(distance(toLocal(p.coordinate),center)<900)pois.set(p.id,p);
 }
 const buckets=buildingBuckets(buildings.values());
 for(const p of pois.values()){
  const point=toLocal(p.coordinate);
  let best,bestDistance=8;
  for(const b of nearbyBuildings(point,buckets)){
   const d=inside(point,b.ring)&&!b.holesLocal.some(h=>inside(point,h))?0:edgeDistance(point,b.ring);
   if(d<bestDistance||d===bestDistance&&best&&b.minHeight<best.minHeight){best=b;bestDistance=d;}
  }
  if(best)best.pois.push(p);
 }
 const priority=['bread','iceCream','coffee','ramen','pizza','burger','food'];for(const b of buildings.values())b.category=priority.find(c=>b.pois.some(p=>p.category===c))??null;
 const graph=makeStreetGraph(lines);if(!graph.nodes.size)throw Error('No mapped walkable streets here. Try another nearby place.');
 const entrancePoints=(await detail).map(toLocal).filter(point=>distance(point,center)<660);
 const entrances=matchBuildingEntrances(entrancePoints,buildings.values(),buckets);
 const environment=environmentPoints(results,center);
 return {graph,lines,streetLabels,placeName,areas,water,greenAreas,buildings:[...buildings.values()],center,entrances,environment,parkTrees:[...treePoints.values()],parkFurniture:[...furniturePoints.values()]};
}
