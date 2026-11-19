import * as THREE from 'three';
import {makePoop,makeCar,makeBus,makeBarrier,makeWorksSite,makePothole,makeCrowd,makeSprinkler,makeTrash,makeBike,makeScooter,makePedestrian} from './game-objects';
import {hazardPosition,pedestrianCycle,sprinklerCycle,VEHICLE_SCALE} from './game.mjs';
import {makeAroma} from './objects';
import {createFoodSteam} from './dog-effects';
import {makeEnvironmentScent,makeVenueProp} from './venue-props';

type Venue={point:number[];facing:number};
type Food={id:number;kind:string;point:number[];venue?:Venue};
type EnvironmentSite={point:number[];kind:string};
type Visibility={venueVisible?:(item:Food)=>boolean};
type FoodSteam=ReturnType<typeof createFoodSteam>;
type HazardData={
 id:string;
 kind:string;
 width?:number;
 works?:boolean;
 fenceOffset?:number;
 color?:string;
 speed?:number;
 route?:unknown;
};
type HazardModel={
 root:THREE.Group;
 flies?:THREE.Group;
 crowd?:ReturnType<typeof makeCrowd>;
 sprinkler?:ReturnType<typeof makeSprinkler>;
 trash?:ReturnType<typeof makeTrash>;
 rider?:ReturnType<typeof makeBike>;
 pedestrian?:ReturnType<typeof makePedestrian>;
};
type HazardInstance={data:HazardData;phase:number;model?:HazardModel;lastPoseAt?:number};
type VisibleHazard={hazard:HazardInstance;sample:{p:number[];heading:number};range:number};

function makeHazardModel(h:HazardData,phase:number):HazardModel{
 if(h.kind==='poop')return makePoop();
 if(h.kind==='barrier')return {root:h.works?makeWorksSite(h.width??10,h.fenceOffset):makeBarrier(h.width)};
 if(h.kind==='pothole')return {root:makePothole()};
 if(h.kind==='crowd'){
  const crowd=makeCrowd();
  return {root:crowd.root,crowd};
 }
 if(h.kind==='sprinkler'){
  const sprinkler=makeSprinkler();
  return {root:sprinkler.root,sprinkler};
 }
 if(h.kind==='trash'){
  const trash=makeTrash();
  return {root:trash.root,trash};
 }
 if(h.kind==='bike'||h.kind==='scooter'){
  const rider=h.kind==='bike'?makeBike():makeScooter();
  return {root:rider.root,rider};
 }
 if(h.kind==='pedestrian'){
  const pedestrian=makePedestrian(Math.round(phase/.12));
  return {root:pedestrian.root,pedestrian};
 }
 const vehicle=h.kind==='bus'?makeBus(h.color):makeCar(h.color);
 vehicle.scale.setScalar(VEHICLE_SCALE);
 return {root:vehicle};
}

function hazardPhase(id:string){
 let hash=0;
 for(const character of id)hash=Math.imul(hash,31)+character.charCodeAt(0)|0;
 return ((hash>>>0)%1000)*.12;
}
const steamHeights:Record<string,number>={coffee:2.5,bread:2.4,food:.9,pizza:.8,ramen:1.3,burger:2.2};
const release=(model:THREE.Object3D)=>{
 // Visitors, vehicles, and their comic sprites own these resources. Food meshes share prototypes.
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
 model.traverse(object=>{
  if(object instanceof THREE.InstancedMesh)object.dispose();
  if(object instanceof THREE.Mesh){
   geometries.add(object.geometry);
   for(const mat of Array.isArray(object.material)?object.material:[object.material])materials.add(mat);
  }
  if(object instanceof THREE.Sprite){
   object.material.map?.dispose();
   materials.add(object.material);
  }
 });
 geometries.forEach(geometry=>geometry.dispose());
 materials.forEach(mat=>mat.dispose());
};

const shadowSizes:Record<string,readonly [number,number]> = {
 bus:[6.3,16.2],car:[4.9,9.35],bike:[2.15,5.8],scooter:[2,4.3],
 pedestrian:[2.15,1.8],crowd:[9.8,7.5],trash:[3.6,3.2],poop:[4.3,4],sprinkler:[2.95,2.95],
};

function createContactShadows(parent:THREE.Group){
 const pose=new THREE.Object3D();
 let mesh:THREE.InstancedMesh|undefined,texture:THREE.DataTexture|undefined;
 let capacity=0,count=0;

 function grow(){
  if(!mesh){
   const size=32,pixels=new Uint8Array(size*size*4).fill(255);
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=(x+.5)*2/size-1,dy=(y+.5)*2/size-1;
    pixels[(y*size+x)*4+3]=Math.round(101*Math.max(0,1-dx*dx-dy*dy)**2.45);
   }
   texture=new THREE.DataTexture(pixels,size,size);
   texture.minFilter=texture.magFilter=THREE.LinearFilter;
   texture.needsUpdate=true;
  }
  const geometry=mesh?.geometry??new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);
  const material=mesh?.material??new THREE.MeshBasicMaterial({
   color:'#283a4a',map:texture,transparent:true,depthWrite:false,
  });
  capacity=capacity?capacity*2:64;
  const next=new THREE.InstancedMesh(geometry,material,capacity);
  next.count=0;
  next.frustumCulled=false;
  next.renderOrder=-2;
  next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if(mesh){
   next.instanceMatrix.array.set(mesh.instanceMatrix.array);
   parent.remove(mesh);
   mesh.dispose();
  }
  mesh=next;
  parent.add(next);
 }

 return {
  clear(){count=0;if(mesh)mesh.count=0;},
  add(x:number,z:number,yaw:number,width:number,length:number){
   if(count===capacity)grow();
   pose.position.set(x,.035,z);
   pose.rotation.y=yaw;
   pose.scale.set(width,1,length);
   pose.updateMatrix();
   mesh!.setMatrixAt(count++,pose.matrix);
  },
  flush(){
   if(!mesh)return;
   mesh.count=count;
   if(count>0)mesh.instanceMatrix.needsUpdate=true;
  },
  dispose(){
   if(!mesh)return;
   parent.remove(mesh);
   mesh.geometry.dispose();
   (mesh.material as THREE.Material).dispose();
   mesh.dispose();
   texture?.dispose();
  },
 };
}

export function createGameWorld(scene:THREE.Scene){
 const root=new THREE.Group(),hazardRoot=new THREE.Group(),venueRoot=new THREE.Group();
 scene.add(root);
 root.add(hazardRoot,venueRoot);
 const shadows=createContactShadows(root);
 const hazards=new Map<string,HazardInstance>();
 const objects=new Map<number,{data:Food;root:THREE.Group;model:THREE.Group;steam?:FoodSteam;lift:number;shadow:[number,number];prop?:THREE.Group}>();
 let environment: {data:EnvironmentSite;model:ReturnType<typeof makeEnvironmentScent>}|undefined;
 const clearEnvironment=()=>{
  if(!environment)return;
  root.remove(environment.model.group);
  release(environment.model.group);
  environment=undefined;
 };
 const removeHazard=(id:string,hazard:HazardInstance)=>{
  if(hazard.model){
   hazardRoot.remove(hazard.model.root);
   release(hazard.model.root);
  }
  hazards.delete(id);
 };
 const clearHazards=()=>{
  for(const [id,hazard] of hazards)removeHazard(id,hazard);
 };

 function updateHazard({hazard,sample,range}:VisibleHazard,t:number,reduced:boolean){
  const model=hazard.model!;
  model.root.visible=true;
  model.root.position.set(sample.p[0],model.rider||model.pedestrian ? .06 : .2,sample.p[1]);
  const elapsed=t-(hazard.lastPoseAt??-Infinity);
  if(model.pedestrian&&!reduced&&elapsed>=0&&elapsed<.28){
   const swivel=sample.heading-model.root.rotation.y;
   model.root.rotation.y+=Math.atan2(Math.sin(swivel),Math.cos(swivel))*(1-Math.exp(-13*elapsed));
  }else model.root.rotation.y=sample.heading;
  hazard.lastPoseAt=t;
  const footprint=shadowSizes[hazard.data.kind];
  if(footprint)shadows.add(sample.p[0],sample.p[1],model.root.rotation.y,...footprint);
  else if(hazard.data.kind==='barrier'&&!hazard.data.works){
   shadows.add(sample.p[0],sample.p[1],sample.heading,(hazard.data.width??10)+1.4,3.8);
  }
  model.rider?.update(t,hazard.data.speed??7,reduced);
  if(model.pedestrian){
   const {active,anticipating}=pedestrianCycle(hazard.data,t);
   model.pedestrian.update(t+hazard.phase,active,anticipating,reduced);
   return false;
  }
  model.flies?.children.forEach((fly,i)=>{
   const a=(reduced?0:t*3)+i*2.1;
   fly.position.set(Math.cos(a)*2,3.5+Math.sin(a*1.3)*.5,Math.sin(a)*2);
  });
  if(model.sprinkler){
   const {active,anticipating}=sprinklerCycle(hazard.data,t);
   model.sprinkler.update(t,active,anticipating,reduced);
  }
  model.trash?.update(t+hazard.phase,reduced);
  return model.crowd?.update(t,reduced,range<54,hazard.phase)??false;
 }
 const removeObject=(id:number)=>{
  const item=objects.get(id);
  if(!item)return;
  root.remove(item.root);
  if(item.steam)release(item.steam.group);
  if(item.prop){
   venueRoot.remove(item.prop);
   release(item.prop);
  }
  objects.delete(id);
 };
 return {
  setEnvironmentScent(site:EnvironmentSite|null){
   if(!site){clearEnvironment();return;}
   if(environment?.data.kind===site.kind){environment.data=site;return;}
   clearEnvironment();
   const model=makeEnvironmentScent(site.kind);
   environment={data:site,model};
   root.add(model.group);
  },
  setHazards(data:HazardData[]){
   const desired=new Map(data.map(h=>[h.id,h]));
   for(const [id,hazard] of hazards){
    const next=desired.get(id);
    if(!next||next.kind!==hazard.data.kind||next.works!==hazard.data.works)removeHazard(id,hazard);
   }
   for(const [id,h] of desired){
    const current=hazards.get(id);
    if(current)current.data=h;
    else hazards.set(id,{data:h,phase:hazardPhase(id)});
   }
  },
  setObjects(data:Food[]){
   const next=new Map(data.map(item=>[item.id,item]));
   for(const [id,item] of objects){
    if(next.get(id)?.kind!==item.data.kind)removeObject(id);
   }
   for(const item of data){
    const old=objects.get(item.id);
    if(old){old.data=item;continue;}
    const group=new THREE.Group(),model=makeAroma(item.kind);
    model.scale.setScalar(1.5);
    const bounds=new THREE.Box3().setFromObject(model),lift=-bounds.min.y+.25;
    const size=bounds.getSize(new THREE.Vector3());
    const shadow:[number,number]=[size.x*1.32+1.2,size.z*1.32+1.2];
    model.position.y=lift;
    group.add(model);
    const steam=steamHeights[item.kind]!==undefined?createFoodSteam():undefined;
    if(steam)group.add(steam.group);
    root.add(group);
    objects.set(item.id,{data:item,root:group,model,steam,lift,shadow});
   }
  },
  update(t:number,mode:string,position:number[],reduced:boolean,collected:Set<number>,needed:Set<string>,foodVisible:(item:Food)=>boolean=()=>true,visibility:Visibility={}){
   root.visible=mode!=='end';
   hazardRoot.visible=mode==='play';
   shadows.clear();
   let chant=false;
   if(hazardRoot.visible){
    const pending:VisibleHazard[]=[];
    for(const hazard of hazards.values()){
     const sample=hazardPosition(hazard.data,t);
     const range=Math.hypot(sample.p[0]-position[0],sample.p[1]-position[1]);
     const limit=hazard.data.route?330:(hazard.data.kind==='crowd'||hazard.data.kind==='pedestrian')?170:265;
     if(range>=limit){
      if(hazard.model)hazard.model.root.visible=false;
      continue;
     }
     const visible={hazard,sample,range};
     if(hazard.model)chant=updateHazard(visible,t,reduced)||chant;
     else pending.push(visible);
    }
    // Hydrate the closest hazards first. Crowds and construction use more geometry.
    let budget=3;
    for(const visible of pending.sort((a,b)=>a.range-b.range)){
     const hazard=visible.hazard;
     const weight=hazard.data.works||hazard.data.kind==='crowd'?2:1;
     if(weight>budget)continue;
     budget-=weight;
     hazard.model=makeHazardModel(hazard.data,hazard.phase);
     hazardRoot.add(hazard.model.root);
     chant=updateHazard(visible,t,reduced)||chant;
     if(budget===0)break;
    }
   }
   if(environment){
    const {data,model}=environment;
    model.group.visible=Math.hypot(data.point[0]-position[0],data.point[1]-position[1])<85;
    if(model.group.visible){
     model.group.position.set(data.point[0],0,data.point[1]);
     model.update(t,reduced);
    }
   }
   venueRoot.visible=mode==='play'||mode==='explore';
   for(const item of objects.values()){
    const data=item.data,venue=data.venue;
    const showVenue=venueRoot.visible&&venue&&visibility.venueVisible?.(data)
     &&Math.hypot(venue.point[0]-position[0],venue.point[1]-position[1])<105;
    if(showVenue){
     if(!item.prop){
      item.prop=makeVenueProp(data.kind);
      venueRoot.add(item.prop);
     }
     item.prop.position.set(venue.point[0],0,venue.point[1]);
     item.prop.rotation.y=venue.facing;
    }
    if(item.prop)item.prop.visible=!!showVenue;
    item.root.visible=!collected.has(data.id)&&Math.hypot(data.point[0]-position[0],data.point[1]-position[1])<350&&foodVisible(data);
    if(!item.root.visible)continue;
    item.root.position.set(data.point[0],0,data.point[1]);
    item.model.position.y=item.lift+(reduced?0:(Math.sin(t*2+data.id%10)+1)*.18);
    if(item.steam){
     const emphasize=mode==='play'&&needed.has(data.kind);
     item.steam.group.scale.y=emphasize?1.18:1;
     item.steam.update(t+data.id%10,steamHeights[data.kind],reduced);
    }
    item.model.rotation.y=reduced?.4:Math.sin(t*.7+data.id%7)*.3;
    shadows.add(data.point[0],data.point[1],item.model.rotation.y,...item.shadow);
   }
   shadows.flush();
   return chant;
  },
  clear(){clearHazards();clearEnvironment();shadows.clear();},
  dispose(){clearHazards();clearEnvironment();shadows.dispose();for(const id of objects.keys())removeObject(id);scene.remove(root);}
 };
}
