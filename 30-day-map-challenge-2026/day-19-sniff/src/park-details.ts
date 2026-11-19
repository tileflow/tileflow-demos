import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {pointInRing,segmentProjection} from './walking.mjs';
import {makeParkFountains,type ParkFountain} from './game-objects';

type Ground = number[];
type Rings = Ground[][];
type Furniture = {kind:'bench'|'lamp'|'fountain';point:Ground;height:number};
type Detail = {kind:'bench'|'lamp'|'hedge'|'tree';point:Ground;angle:number;height:number};
type Segment = {a:Ground;b:Ground;width:number;path:boolean};
type ParkRegion = {
 center:Ground;
 lines:{points:Ground[];width:number;grade?:number;parkPath?:boolean}[];
 greenAreas:Rings[];
 water:Rings[];
 parkTrees:Ground[];
 parkFurniture:Furniture[];
 buildings?:{ring:Ground[];holesLocal?:Ground[][]}[];
};

const range=168,cellSize=24,planningRange=414;
const segmentGap=(p:Ground,a:Ground,b:Ground)=>{
 const dx=b[0]-a[0],dz=b[1]-a[1],px=p[0]-a[0],pz=p[1]-a[1];
 const t=Math.max(0,Math.min(1,(px*dx+pz*dz)/(dx*dx+dz*dz||1)));
 return (px-t*dx)**2+(pz-t*dz)**2;
};
const gap=(a:Ground,b:Ground)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const key=(x:number,z:number)=>x+':'+z;
const value=(point:Ground)=>Math.abs(Math.sin(point[0]*125.931+point[1]*311.713)*47652.54)%1;

class SpatialIndex<T>{
 private cells=new Map<string,T[]>();
 constructor(private origin:Ground){}
 add(item:T,west:number,south:number,east:number,north:number){
  const x0=Math.floor(Math.max(west,this.origin[0]-planningRange)/cellSize);
  const z0=Math.floor(Math.max(south,this.origin[1]-planningRange)/cellSize);
  const x1=Math.floor(Math.min(east,this.origin[0]+planningRange)/cellSize);
  const z1=Math.floor(Math.min(north,this.origin[1]+planningRange)/cellSize);
  for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
   const name=key(x,z),list=this.cells.get(name);
   if(list)list.push(item);
   else this.cells.set(name,[item]);
  }
 }
 at([x,z]:Ground){return this.cells.get(key(Math.floor(x/cellSize),Math.floor(z/cellSize)))??[];}
}

function polygons(rings:Rings[],center:Ground,padding=0){
 const index=new SpatialIndex<Rings>(center);
 for(const polygon of rings){
  const outer=polygon[0];
  if(!outer?.length)continue;
  const x=outer.map(p=>p[0]),z=outer.map(p=>p[1]);
  index.add(polygon,Math.min(...x)-padding,Math.min(...z)-padding,Math.max(...x)+padding,Math.max(...z)+padding);
 }
 return index;
}

function contains(p:Ground,[outer,...holes]:Rings){
 return pointInRing(p,outer)&&!holes.some(hole=>pointInRing(p,hole));
}

function greenAt(p:Ground,[outer,...holes]:Rings,radius:number){
 if(!contains(p,[outer,...holes]))return false;
 for(const ring of [outer,...holes])for(let i=1;i<ring.length;i++){
  if(segmentGap(p,ring[i-1],ring[i])<radius**2)return false;
 }
 return true;
}

function plan(region:ParkRegion){
 const {center,lines,greenAreas,water,buildings=[],parkTrees=[],parkFurniture=[]}=region;
 const parks=polygons(greenAreas,center,5),lakes=polygons(water,center);
 const walls=polygons(buildings.map(b=>[b.ring,...b.holesLocal??[]]),center);
 const roads=new SpatialIndex<Segment>(center),trees=new SpatialIndex<Ground>(center);
 const paths:Segment[]=[];
 for(const line of lines){
  if(line.grade)continue;
  for(let i=1;i<line.points.length;i++){
   const a=line.points[i-1],b=line.points[i],padding=Math.max(17,line.width/2+5);
   const segment={a,b,width:line.width,path:!!line.parkPath};
   roads.add(segment,Math.min(a[0],b[0])-padding,Math.min(a[1],b[1])-padding,
    Math.max(a[0],b[0])+padding,Math.max(a[1],b[1])+padding);
   if(line.parkPath)paths.push(segment);
  }
 }
 for(const p of parkTrees)trees.add(p,p[0]-9,p[1]-9,p[0]+9,p[1]+9);
 const details:Detail[]=[],fountains:ParkFountain[]=[];
 const furnishedPools=new Set<Rings>();
 const positioned=new SpatialIndex<Detail>(center);
 const add=(detail:Detail)=>{
  const [x,z]=detail.point;
  positioned.add(detail,x-15,z-15,x+15,z+15);
  details.push(detail);
 };
 const dry=(p:Ground)=>!lakes.at(p).some(shape=>contains(p,shape))&&!walls.at(p).some(shape=>contains(p,shape));
 const clearRoad=(p:Ground,radius:number,mapped=false)=>!roads.at(p).some(road=>{
  const width=mapped&&road.path?1.2:road.width/2;
  return segmentGap(p,road.a,road.b)<(width+radius)**2;
 });
 const room=(p:Ground,kind:Detail['kind'],spacing:number)=>!positioned.at(p).some(d=>gap(d.point,p)<(d.kind===kind?spacing:2.15));

 for(const {kind,point,height} of parkFurniture){
  if(gap(point,center)>planningRange-1)continue;
  if(kind==='fountain'){
   const pool=lakes.at(point).find(polygon=>contains(point,polygon));
   if(walls.at(point).some(polygon=>contains(point,polygon))||
    (pool?furnishedPools.has(pool):!clearRoad(point,1.35))||
    fountains.some(fountain=>gap(fountain.point,point)<2.8))continue;
   let waterRoom=4.5;
   if(pool){
    for(const ring of pool)for(let i=1;i<ring.length;i++)waterRoom=Math.min(waterRoom,Math.sqrt(segmentGap(point,ring[i-1],ring[i])));
    if(waterRoom<.65)continue;
    furnishedPools.add(pool);
   }
   const reach=pool?Math.min(3.15,waterRoom*.73):.68;
   fountains.push({point,reach,lift:1.25+reach*.71,base:pool?.06:.35});
   continue;
  }
  const edge=parks.at(point).some(shape=>contains(point,shape)||
   shape[0].some((b,i,a)=>i>0&&segmentGap(point,a[i-1],b)<9));
  if(!edge||!dry(point)||!clearRoad(point,kind==='lamp'?.22:.3,true)||!room(point,kind,kind==='lamp'?11:7.4)||
   trees.at(point).some(tree=>gap(tree,point)<1.15))continue;
  let angle=0,nearest=16;
  for(const road of roads.at(point)){
   const hit=segmentProjection(point,road.a,road.b);
   if(hit.distance>=nearest||!road.path)continue;
   nearest=hit.distance;
   angle=-Math.atan2(hit.tangent[1],hit.tangent[0]);
   if((hit.point[0]-point[0])*Math.sin(angle)+(hit.point[1]-point[1])*Math.cos(angle)<0)angle+=Math.PI;
  }
  add({kind,point,angle,height:height>2?Math.min(height,6):3.55});
 }

 // Decorative planting stays inside map-sourced green surfaces and away from fixtures.
 for(const {a,b,width} of paths){
  const length=gap(a,b);
  if(length<4)continue;
  const dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length;
  for(let step=3;step<length-1;step+=7.2){
   const anchor=[a[0]+dx*step,a[1]+dz*step],seed=value(anchor);
   if(gap(anchor,center)>planningRange-8||seed>.74)continue;
   const side=seed<.37?1:-1,offset=width/2+1.55;
   const point=[anchor[0]-side*dz*offset,anchor[1]+side*dx*offset];
   if(!parks.at(point).some(shape=>greenAt(point,shape,.95))||!dry(point)||!clearRoad(point,.82)||
    !room(point,'hedge',8)||trees.at(point).some(tree=>gap(tree,point)<2.4))continue;
   add({kind:'hedge',point,angle:-Math.atan2(dz,dx),height:.67+seed*.47});
   if(seed<.23){
    const tree=[point[0]-side*dz*4.2,point[1]+side*dx*4.2];
    if(parks.at(tree).some(shape=>greenAt(tree,shape,2.6))&&dry(tree)&&clearRoad(tree,2.35)&&
     room(tree,'tree',15)&&!trees.at(tree).some(mapped=>gap(mapped,tree)<7.5)){
     add({kind:'tree',point:tree,angle:seed*21,height:5.2+seed*6});
    }
   }
  }
 }
 return {details,fountains};
}

export function createParkDetails(scene:THREE.Scene){
 const group=new THREE.Group();
 group.name='Park details';
 group.visible=false;
 scene.add(group);
 const fountainWater=makeParkFountains();
 group.add(fountainWater.root);
 const dummy=new THREE.Object3D(),shade=new THREE.Color();
 const matte=new THREE.MeshStandardMaterial({roughness:.84});
 const glass=new THREE.MeshStandardMaterial({roughness:.45,emissive:'#ffe4ba',emissiveIntensity:.22});
 const batch=(name:string,geometry:THREE.BufferGeometry,material:THREE.Material)=>{
  const mesh=new THREE.InstancedMesh(geometry,material,768);
  mesh.name=name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled=false;
  mesh.count=0;
  group.add(mesh);
  return mesh;
 };
 const boxes=batch('Park bench pieces',new RoundedBoxGeometry(1,1,1,1,.13),matte);
 const posts=batch('Park posts and bark',new THREE.CylinderGeometry(.45,.5,1,7),matte);
 const leaves=batch('Park layered foliage',new THREE.IcosahedronGeometry(1,2),matte);
 const lamps=batch('Park lantern glass',new THREE.SphereGeometry(1,10,7),glass);
 const pieces=[boxes,posts,leaves,lamps];
 let details:Detail[]=[],fountains:ParkFountain[]=[],nearFountains:ParkFountain[]=[],last:Ground|undefined;

 const part=(mesh:THREE.InstancedMesh,d:Detail,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:string,turn=0)=>{
  if(mesh.count>=768)return;
  const c=Math.cos(d.angle),s=Math.sin(d.angle),index=mesh.count++;
  dummy.position.set(d.point[0]+x*c+z*s,y,d.point[1]-x*s+z*c);
  dummy.scale.set(sx,sy,sz);
  dummy.rotation.set(0,d.angle+turn,0);
  dummy.updateMatrix();
  mesh.setMatrixAt(index,dummy.matrix);
  mesh.setColorAt(index,shade.set(color));
 };
 function render(d:Detail){
  const seed=value(d.point);
  const metal='#334951';
  if(d.kind==='bench'){
   const wood=seed>.5?'#b87948':'#c48852';
   for(const x of [-.86,.86]){
    part(boxes,d,x,.26,.03,.16,.5,.56,metal);
    part(boxes,d,x,.67,-.26,.12,.73,.12,metal);
   }
   for(const z of [-.22,.01,.24])part(boxes,d,0,.54,z,2.26,.115,.186,wood);
   for(const y of [.81,1.03])part(boxes,d,0,y,-.3,2.26,.158,.11,wood);
  }else if(d.kind==='lamp'){
   const h=d.height;
   part(posts,d,0,.15,0,.47,.3,.47,metal);
   part(posts,d,0,(h-.54)/2,0,.168,h-.54,.168,metal);
   part(posts,d,0,h-.67,0,.44,.09,.44,'#53706c');
   part(lamps,d,0,h-.36,0,.262,.31,.262,'#fff8df');
   part(posts,d,0,h-.09,0,.47,.09,.47,metal);
  }else if(d.kind==='hedge'){
   for(let i=0;i<4;i++){
    const shift=(i-1.5)*.57;
    const tint=['#537e40','#709a4f','#8bad5c','#5b8b48'][(i+Math.floor(seed*4))%4];
    part(leaves,d,shift,d.height*.52,(i%2-.5)*.36,.55,d.height*.65,.66,tint,seed*8+i);
   }
  }else{
   const h=d.height;
   part(posts,d,0,h*.29,0,.46,h*.58,.43,'#785840');
   const tints=['#53834a','#60964d','#75a952','#90b760','#a2c36d'];
   for(let i=0;i<5;i++){
    const angle=i*Math.PI*.72;
    const reach=i===4?.25:h*.13;
    part(leaves,d,Math.cos(angle)*reach,h*(.64+i*.075),Math.sin(angle)*reach,h*.24,h*.23,h*.22,tints[i],seed*8+i*.9);
   }
  }
 }
 return {
  setRegion(region:ParkRegion){
   ({details,fountains}=plan(region));
   last=undefined;
  },
  update(position:Ground,overview=false,time=0,reduced=false){
   group.visible=!overview;
   if(overview)return;
   if(!last||gap(last,position)>=6){
    last=[...position];
    for(const mesh of pieces)mesh.count=0;
    const nearby=details.map(detail=>({detail,distance:gap(detail.point,position)}))
     .filter(item=>item.distance<range).sort((a,b)=>a.distance-b.distance).slice(0,105);
    for(const {detail} of nearby)render(detail);
    nearFountains=fountains.map(fountain=>({fountain,distance:gap(fountain.point,position)}))
     .filter(item=>item.distance<range).sort((a,b)=>a.distance-b.distance).slice(0,8).map(item=>item.fountain);
    for(const fountain of nearFountains){
     if(fountain.base<.3)continue;
     const basin:Detail={point:fountain.point,kind:'lamp',angle:0,height:0};
     part(posts,basin,0,.13,0,2.1,.26,2.1,'#bebcaa');
     part(posts,basin,0,.27,0,1.99,.13,1.99,'#e9dfc5');
     part(posts,basin,0,.337,0,1.72,.035,1.72,'#46a9c6');
    }
    for(const mesh of pieces){
     mesh.instanceMatrix.needsUpdate=true;
     if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    }
   }
   fountainWater.update(nearFountains,time,reduced);
  },
  dispose(){
   group.removeFromParent();
   fountainWater.dispose();
   for(const mesh of pieces){mesh.geometry.dispose();mesh.dispose();}
   matte.dispose();glass.dispose();
  },
 };
}
