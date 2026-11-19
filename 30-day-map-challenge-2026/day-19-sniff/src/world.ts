import * as THREE from 'three';
import {MercatorCoordinate,type Map as MapLibreMap,type CustomLayerInterface} from 'maplibre-gl';
import {ORIGIN,type makeRoute} from './streets.mjs';
import {createScentBuildings,type Building} from './buildings';
import {makeHeart} from './objects';
import {makeCritter,type CritterKind} from './critters';
import {createMapReveal} from './reveal';
import {advanceSniffBoost} from './exploration.mjs';
import {makeStar} from './game-objects';
import {createSniffEffect,createWaterSplash} from './dog-effects';
import {createParkDetails} from './park-details';


type Route=ReturnType<typeof makeRoute>;
export type Scent={id:string;name:string;subtitle:string;color:string;coordinate:number[];node:any;route:Route;icon:string;found:boolean;roof?:number[];buildingId?:number;placeName?:string};

export function createWorld(map:MapLibreMap,_scents:Scent[],buildings:Building[],onDiscover:(b:Building)=>void){
 const scene=new THREE.Scene(),camera=new THREE.Camera();
 const parks=createParkDetails(scene);
 scene.add(new THREE.HemisphereLight('#fff3dc','#7d9ca3',1.75));
 const sun=new THREE.DirectionalLight('#fff0d8',2.35);
 sun.position.set(-100,180,80);
 scene.add(sun);
 const reveal=createMapReveal(),city=createScentBuildings(scene,buildings,onDiscover,reveal.field),discovered=new Set<number>();
 let critterKind:CritterKind='dog',critter=makeCritter(critterKind);
 scene.add(critter.root);
 // The avatar and arrows use scene depth. Façades in their sightlines fade.
 const pickupEffect=new THREE.Group();scene.add(pickupEffect);
 const hearts=Array.from({length:3},(_,i)=>{const mesh=makeHeart(i===1?'#efa4a0':'#d97b88');pickupEffect.add(mesh);return mesh;});
 let reactionStart=-100,hurtStart=-100,splashStart=-100;
 const splash=createWaterSplash();scene.add(splash.group);
 let origin=MercatorCoordinate.fromLngLat(ORIGIN as [number,number]),s=origin.meterInMercatorCoordinateUnits();
 let local=new THREE.Matrix4().makeTranslation(origin.x,origin.y,0).multiply(new THREE.Matrix4().makeScale(s,-s,s)).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2));
 const sniffEffect=createSniffEffect();scene.add(sniffEffect.group);const dizzyStars=Array.from({length:3},()=>{const star=makeStar();star.scale.setScalar(.7);scene.add(star);return star;});
 let renderer:THREE.WebGLRenderer,last=0,disposed=false;
 let state={x:0,z:0,heading:0,moving:false,running:false,sprinting:false,sitting:false,sniff:0,sniffAge:0,sniffHeld:false,time:0,range:36,exploring:false,overview:false,fogStrength:1,trailPoints:[] as number[][],stun:0,healing:false,jump:0,jumpTime:0,reduced:false};
 let sniffBoost=0;
 const inverse=new THREE.Matrix4();
 const avatarBounds=new THREE.Box3();
 const screenBounds=new THREE.Box2();
 const avatarCentre=new THREE.Vector3(),avatarMuzzle=new THREE.Vector3(),corner=new THREE.Vector3();
 const screenCorner=new THREE.Vector2();
 const silhouetteSamples=[.15,.5,.85];
 const layer:CustomLayerInterface={id:'scent-trail-world',type:'custom',renderingMode:'3d',
  onAdd(_map,gl){renderer=new THREE.WebGLRenderer({canvas:map.getCanvas(),context:gl,antialias:true});renderer.autoClear=false;renderer.outputColorSpace=THREE.SRGBColorSpace;},
  render(_gl,input){if(disposed)return;
   const t=state.time,dt=Math.min(.05,Math.max(0,t-last));last=t;
   parks.update([state.x,state.z],state.overview,t,state.reduced);
   if(state.overview)return;
   const sniffing=state.exploring&&!state.sitting&&state.sniff>0&&state.stun<=0&&state.jump<1;
   sniffBoost=advanceSniffBoost(sniffBoost,dt,sniffing,state.sniffHeld,state.reduced);
   const revealRange=state.exploring?state.range+sniffBoost:36;
   if(t>0)reveal.reveal(state.x,state.z,revealRange);
   camera.projectionMatrix.fromArray(input.defaultProjectionData.mainMatrix as number[]).multiply(local);
   inverse.copy(camera.projectionMatrix).invert();
   const angle=map.getBearing()*Math.PI/180;
   const bounce=Math.max(0,1-(t-reactionStart)/.7);
   critter.root.position.set(state.x,.3+state.jump+(state.reduced||state.sitting?0:Math.sin(bounce*Math.PI)*2),state.z);
   critter.root.rotation.y=state.heading;
   critter.animate(t,dt,state.moving,state.running,state.sitting,sniffing,state.reduced,Math.max(0,1-(t-hurtStart)/1.5),state.stun,state.jumpTime,state.sniffAge,state.sprinting);
   critter.root.updateMatrixWorld(true);
   avatarBounds.setFromObject(critter.root);
   avatarBounds.getCenter(avatarCentre).applyMatrix4(camera.projectionMatrix);
   critter.muzzle.getWorldPosition(avatarMuzzle);
   screenBounds.makeEmpty();
   for(const x of [avatarBounds.min.x,avatarBounds.max.x])for(const y of [avatarBounds.min.y,avatarBounds.max.y])for(const z of [avatarBounds.min.z,avatarBounds.max.z]){
    corner.set(x,y,z).applyMatrix4(camera.projectionMatrix);
    screenBounds.expandByPoint(screenCorner.set(corner.x,corner.y));
   }
   const sightline=(point:THREE.Vector3,opacity:number)=>{
    const eye=point.clone().applyMatrix4(camera.projectionMatrix);
    eye.z=-1;eye.applyMatrix4(inverse);
    return {point,eye,opacity};
   };
   // Use the rendered avatar's bounds so façades covering its head or tail also fade.
   const sightlines=[sightline(avatarMuzzle,.12)];
   for(const row of silhouetteSamples)for(const column of silhouetteSamples){
    const x=THREE.MathUtils.lerp(screenBounds.min.x,screenBounds.max.x,column);
    const y=THREE.MathUtils.lerp(screenBounds.min.y,screenBounds.max.y,row);
    if(Math.abs(x)>1||Math.abs(y)>1)continue;
    sightlines.push(sightline(new THREE.Vector3(x,y,avatarCentre.z).applyMatrix4(inverse),.12));
   }
   const avatarSamples=sightlines.length;
   for(const [x,z] of state.trailPoints){
    const point=new THREE.Vector3(x,.18,z);
    const screen=point.clone().applyMatrix4(camera.projectionMatrix);
    if(Math.abs(screen.x)<=1&&Math.abs(screen.y)<=1)sightlines.push(sightline(point,.30));
   }
   const occluded=city.occluders(sightlines,[state.x,state.z],avatarSamples);
   city.update(t,[state.x,state.z],revealRange,state.exploring,discovered,state.reduced,occluded);
   dizzyStars.forEach((star,i)=>{star.visible=state.stun>0;const a=t*5+i*Math.PI*2/3;star.position.set(state.x+Math.cos(a)*3,8,state.z+Math.sin(a)*3);star.rotation.set(-Math.PI/3,a,0);});
   pickupEffect.position.set(state.x,0,state.z);
   splash.group.position.set(state.x,.2,state.z);
   splash.update(t-splashStart,state.reduced);
   hearts.forEach((heart,i)=>{const life=(t-reactionStart-i*.22)/1.2;heart.visible=!state.sitting&&life>=0&&life<1;heart.position.set(Math.sin(i*2.4)*2,6+Math.max(0,life)*5,Math.cos(i*2.4)*1.4);heart.rotation.y=-angle;heart.scale.setScalar(state.reduced?.8:Math.max(0,Math.sin(life*Math.PI))*1.25);});
   if(sniffing)sniffEffect.group.position.copy(avatarMuzzle);
   sniffEffect.group.rotation.y=state.heading;sniffEffect.update(state.sniffAge,sniffing,state.reduced);
   renderer.resetState();
   renderer.render(scene,camera);
   reveal.render(renderer,inverse,state.reduced?0:t,state.fogStrength);
   renderer.resetState();
  },
  onRemove(){disposed=true;parks.dispose();reveal.dispose();scene.traverse(obj=>{const m=obj as THREE.Mesh;m.geometry?.dispose();if(m.material)(Array.isArray(m.material)?m.material:[m.material]).forEach(a=>a.dispose());});renderer?.dispose();}
 };
 map.addLayer(layer);
 function resetDiscovery(){
  discovered.clear();reveal.reset();sniffBoost=0;reactionStart=hurtStart=splashStart=-100;
 }
 return {
  setCritter(kind:CritterKind){
   if(kind===critterKind)return;
   scene.remove(critter.root);
   const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
   critter.root.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    geometries.add(object.geometry);
    for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
   });
   geometries.forEach(geometry=>geometry.dispose());
   materials.forEach(material=>material.dispose());
   critterKind=kind;
   critter=makeCritter(kind);
   scene.add(critter.root);
   map.triggerRepaint();
  },
  isRevealed(point:number[],threshold=.6){return reveal.field.sample(point[0],point[1])>threshold;},
  project(point:number[]){
   const v=new THREE.Vector3(point[0],point[1],point[2]).applyMatrix4(camera.projectionMatrix);
   return [(v.x+1)/2*map.getCanvas().clientWidth,(1-v.y)/2*map.getCanvas().clientHeight];
  },
  hurt(){hurtStart=state.time;},
  splash(){splashStart=state.time;},
  setBuildings(next:Building[]){city.sync(next);},
  setParks:parks.setRegion,
  relocate(next:Building[]){
   city.clear();city.sync(next);resetDiscovery();
   origin=MercatorCoordinate.fromLngLat(ORIGIN as [number,number]);
   const scale=origin.meterInMercatorCoordinateUnits();
   local=new THREE.Matrix4().makeTranslation(origin.x,origin.y,0).multiply(new THREE.Matrix4().makeScale(scale,-scale,scale)).multiply(new THREE.Matrix4().makeRotationX(Math.PI/2));
  },
  update(next:Partial<typeof state>){state={...state,...next};map.triggerRepaint();},
  resetDiscovery,
  react(_kind:string){reactionStart=state.time;},scene,
 };
}
