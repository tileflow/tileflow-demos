import * as THREE from 'three';
import {Marker,type Map as MapLibreMap} from 'maplibre-gl';
import {makeCritter,CRITTERS,type CritterKind} from './critters';

type Coordinate=[number,number];

export function createStartMarker(map:MapLibreMap, onPlace:(point:Coordinate)=>void){
 const pin=document.createElement('div');
 pin.className='start-marker';
 pin.tabIndex=0;
 const portrait=document.createElement('div');
 portrait.className='start-marker-portrait';
 const label=document.createElement('span');
 label.className='start-marker-caption';
 label.textContent='Drag me';
 pin.append(portrait,label);

 const marker=new Marker({element:pin,anchor:'bottom',draggable:true,clickTolerance:5});
 marker.on('dragend',()=>{
  const point=marker.getLngLat();
  onPlace([point.lng,point.lat]);
 });
 pin.addEventListener('click',event=>event.stopPropagation());
 pin.addEventListener('keydown',event=>{
  const offsets:Record<string,[number,number]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};
  const shift=offsets[event.key];
  if(!shift)return;
  event.preventDefault();
  event.stopPropagation();
  const point=map.project(marker.getLngLat());
  const next=map.unproject([point.x+shift[0],point.y+shift[1]]);
  onPlace([next.lng,next.lat]);
 });

 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));
 renderer.setSize(68,68,false);
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.domElement.setAttribute('aria-hidden','true');
 portrait.append(renderer.domElement);
 const scene=new THREE.Scene();
 scene.add(new THREE.HemisphereLight('#ffffff','#9d83a6',2.1));
 const sun=new THREE.DirectionalLight('#fff5df',2.2);
 sun.position.set(9,12,10);
 scene.add(sun);
 const camera=new THREE.OrthographicCamera(-5,5,5,-5,.1,50);
 let model:THREE.Object3D|undefined;
 let shown=false;

 function clearModel(){
  if(!model)return;
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
  model.traverse(object=>{
   if(!(object instanceof THREE.Mesh))return;
   geometries.add(object.geometry);
   for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
  });
  for(const geometry of geometries)geometry.dispose();
  for(const material of materials)material.dispose();
  scene.remove(model);
  model=undefined;
 }

 return {
  setLocation(point:Coordinate){
   marker.setLngLat(point);
   if(!shown){marker.addTo(map);shown=true;}
  },
  setCritter(kind:CritterKind){
   clearModel();
   pin.setAttribute('aria-label',CRITTERS[kind].label+' starting point. Drag or use the arrow keys to move it.');
   const critter=makeCritter(kind);
   critter.animate(0,0,false,false,false,false,true,0,0,0,0,false);
   model=critter.root;
   scene.add(model);
   const bounds=new THREE.Box3().setFromObject(model);
   const center=bounds.getCenter(new THREE.Vector3());
   const size=bounds.getSize(new THREE.Vector3());
   const radius=Math.max(size.x,size.y,size.z)*.59;
   camera.left=-radius;
   camera.right=radius;
   camera.top=radius;
   camera.bottom=-radius;
   camera.position.copy(center).add(new THREE.Vector3(13,9,17));
   camera.lookAt(center);
   camera.updateProjectionMatrix();
   renderer.render(scene,camera);
  },
  setLoading(loading:boolean){marker.setDraggable(!loading);pin.classList.toggle('loading',loading);},
  hide(){marker.remove();shown=false;},
  dispose(){marker.remove();clearModel();renderer.dispose();},
 };
}
