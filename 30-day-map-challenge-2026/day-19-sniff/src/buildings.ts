import * as THREE from 'three';
import {toLocal,distance} from './streets.mjs';
import {pointInRing,segmentProjection} from './walking.mjs';
import type {createExploration} from './exploration.mjs';

export const AROMAS:Record<string,{color:string;label:string}>={
 bread:{color:'#ffc343',label:'Warm bread'},coffee:{color:'#f09d69',label:'Fresh coffee'},flowers:{color:'#ef80b3',label:'Flowers'},linen:{color:'#a799f2',label:'Fresh linen'},food:{color:'#ff8b70',label:'Kitchen aromas'},
};
export type Building={id:number;outline:number[][];holes?:number[][][];center:number[];height:number;minHeight?:number;extrude?:boolean;category:string|null;pois:{name:string;category:string;coordinate:number[];id:number;venueType?:string}[]};
// Warm masonry, painted brick and aged metal. Glass stays matte in the toy-sized streets.
const palette=[
 ['#d7ac8f','#a6715b','#596e78','#f1d2ac'],
 ['#c1b6a3','#787787','#5c6a7c','#e7d9bd'],
 ['#e0c48d','#ab895c','#677f78','#f5dfae'],
 ['#adbfaf','#648783','#507477','#d7dfc6'],
 ['#c79f91','#8f6765','#536f80','#e9c1a5'],
 ['#c5c6b2','#8e9a80','#5f7979','#e1dfbc'],
];

const facadeUV:THREE.UVGenerator={
 generateTopUV(_geometry,vertices,...indices){
  return indices.map(i=>new THREE.Vector2(vertices[3*i],vertices[3*i+1]));
 },
 generateSideWallUV(_geometry,vertices,a,b,c,d){
  const width=Math.hypot(vertices[b*3]-vertices[a*3],vertices[b*3+1]-vertices[a*3+1]);
  const bays=width<2.8?0:Math.max(1,Math.round(width/3.7));
  // Every wall gets equal bays with a full masonry margin at its corners.
  return [a,b,c,d].map((i,j)=>new THREE.Vector2(j===1||j===2?bays:0,vertices[3*i+2]));
 },
};

function makeFacadeMaterial(height:number,index:number){
 const [wall,,glass,trim]=palette[index];
 const material=new THREE.MeshStandardMaterial({color:wall,roughness:.9});
 material.onBeforeCompile=shader=>{
  shader.uniforms.facadeGlass={value:new THREE.Color(glass)};
  shader.uniforms.facadeTrim={value:new THREE.Color(trim)};
  shader.uniforms.facadeDimensions={value:new THREE.Vector3(height,3.2+(index%3)*.25,.18+(index%3)*.018)};
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>',`#include <common>
    varying vec2 facadeUV;`)
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    facadeUV = uv;`);
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>
    varying vec2 facadeUV;
    uniform vec3 facadeGlass;
    uniform vec3 facadeTrim;
    uniform vec3 facadeDimensions;
    float facadeRectangle(vec2 centreDistance, vec2 halfSize, vec2 blur) {
     vec2 coverage = 1.0 - smoothstep(halfSize - blur, halfSize + blur, centreDistance);
     return coverage.x * coverage.y;
    }
   `)
   .replace('#include <map_fragment>',`#include <map_fragment>
    float wallHeight = facadeUV.y;
    vec2 floorUV = vec2(facadeUV.x, wallHeight / facadeDimensions.y);
    vec2 pixel = min(vec2(0.22), max(vec2(0.006), fwidth(floorUV)));
    vec2 cell = fract(floorUV);
    vec2 dist = abs(cell - vec2(0.5, 0.54));
    float readable = 1.0 - smoothstep(0.11, 0.25, max(pixel.x, pixel.y));
    float band = smoothstep(0.57, 0.83, wallHeight)
     * (1.0 - smoothstep(facadeDimensions.x - 0.70, facadeDimensions.x - 0.55, wallHeight));
    float details = readable * band;
    float frame = facadeRectangle(dist, vec2(facadeDimensions.z + 0.037, 0.25), pixel) * details;
    float pane = facadeRectangle(dist, vec2(facadeDimensions.z, 0.204), pixel) * details;
    float bar = (1.0 - smoothstep(0.018 - pixel.x, 0.018 + pixel.x, dist.x)) * 0.35;
    vec3 brick = diffuseColor.rgb * mix(0.80, 1.0, smoothstep(0.4, 0.95, wallHeight));
    float coping = smoothstep(facadeDimensions.x - 0.56, facadeDimensions.x - 0.40, wallHeight);
    brick = mix(brick, facadeTrim, coping * 0.62);
    brick = mix(brick, facadeTrim * 0.83, frame * 0.86);
    vec3 glazing = mix(facadeGlass, facadeTrim, 0.11 + 0.16 * cell.y + bar);
    diffuseColor.rgb = mix(brick, glazing, pane * 0.87);
   `);
 };
 material.customProgramCacheKey=()=>'scent-facade-1';
 return material;
}

type Point = [number,number];
type RoofEdge = {outline:Point[]; inset:Point[]; flip:boolean};
type RoofFootprint = {rings:Point[][]; area:number; min:Point; max:Point};

function roofRing(points:number[][]):Point[]{
 const ring:Point[]=[];
 for(const [x,y] of points){
  if(!Number.isFinite(x)||!Number.isFinite(y))continue;
  const point:Point=[x,-y];
  if(!ring.length||distance(ring[ring.length-1],point)>.002)ring.push(point);
 }
 if(ring.length>1&&distance(ring[0],ring[ring.length-1])<=.002)ring.pop();
 return ring;
}

function signedArea(ring:Point[]){
 let twiceArea=0;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++)twiceArea+=ring[j][0]*ring[i][1]-ring[i][0]*ring[j][1];
 return twiceArea/2;
}

const sideOf=(a:Point,b:Point,p:Point)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);

function crosses(a:Point,b:Point,c:Point,d:Point){
 const first=sideOf(a,b,c),second=sideOf(a,b,d),third=sideOf(c,d,a),fourth=sideOf(c,d,b);
 if(first*second<0&&third*fourth<0)return true;
 // Touching a boundary or another inset edge makes roofing the strip ambiguous.
 const touches=(p:Point,q:Point,r:Point,area:number)=>Math.abs(area)<1e-7&&
  r[0]>=Math.min(p[0],q[0])-.001&&r[0]<=Math.max(p[0],q[0])+.001&&
  r[1]>=Math.min(p[1],q[1])-.001&&r[1]<=Math.max(p[1],q[1])+.001;
 return touches(a,b,c,first)||touches(a,b,d,second)||touches(c,d,a,third)||touches(c,d,b,fourth);
}

function roofFootprint(rings:Point[][]):RoofFootprint{
 const outer=rings[0];
 const min:Point=[Infinity,Infinity],max:Point=[-Infinity,-Infinity];
 for(const [x,y] of outer){
  min[0]=Math.min(min[0],x);min[1]=Math.min(min[1],y);
  max[0]=Math.max(max[0],x);max[1]=Math.max(max[1],y);
 }
 return {rings,area:Math.abs(signedArea(outer)),min,max};
}

function overlappingRoofs(a:RoofFootprint,b:RoofFootprint){
 if(a.min.some((value,axis)=>Math.min(a.max[axis],b.max[axis])-Math.max(value,b.min[axis])<.03))return false;
 const strictlyInside=(point:Point,{rings:[outer,...holes]}:RoofFootprint)=>
  pointInRing(point,outer)&&!holes.some(hole=>pointInRing(point,hole))&&
  [outer,...holes].every(ring=>ring.every((p,i)=>segmentProjection(point,p,ring[(i+1)%ring.length]).distance>.015));
 const containsEdge=(first:RoofFootprint,second:RoofFootprint)=>first.rings.some(ring=>ring.some((p,i)=>{
  const q=ring[(i+1)%ring.length];
  return strictlyInside(p,second)||strictlyInside([(p[0]+q[0])/2,(p[1]+q[1])/2],second);
 }));
 if(containsEdge(a,b)||containsEdge(b,a))return true;
 return a.rings.some(ring=>ring.some((p,i)=>{
  const q=ring[(i+1)%ring.length];
  return b.rings.some(other=>other.some((r,j)=>{
   const s=other[(j+1)%other.length];
   return sideOf(p,q,r)*sideOf(p,q,s)<-1e-9&&sideOf(r,s,p)*sideOf(r,s,q)<-1e-9;
  }));
 }));
}

function intersectsRing(a:Point,b:Point,ring:Point[]){
 return ring.some((c,i)=>crosses(a,b,c,ring[(i+1)%ring.length]));
}

function roofEdges(rings:Point[][]):RoofEdge[]{
 const outer=rings[0];
 if(outer.length<3||rings.reduce((count,ring)=>count+ring.length,0)>96)return [];
 const area=signedArea(outer);
 if(Math.abs(area)<5)return [];
 const thickness=Math.min(.93,Math.max(.36,Math.sqrt(Math.abs(area))*.032));
 const edges:RoofEdge[]=[];
 const contours=rings.filter(ring=>ring.length>=3);
 for(const [index,outline] of contours.entries()){
  const ringArea=signedArea(outline);
  if(Math.abs(ringArea)<1)return [];
  const sign=Math.sign(ringArea)*(index===0?1:-1);
  const inward=(a:Point,b:Point):Point=>{
   const size=distance(a,b);
   return [sign*(a[1]-b[1])/size,sign*(b[0]-a[0])/size];
  };
  const inset:Point[]=[];
  for(let i=0;i<outline.length;i++){
   const point=outline[i],before=outline[(i+outline.length-1)%outline.length],after=outline[(i+1)%outline.length];
   const a=inward(before,point),b=inward(point,after);
   const dot=a[0]*b[0]+a[1]*b[1];
   if(dot<-.8)break;
   const shift=thickness/(1+dot);
   inset.push([point[0]+(a[0]+b[0])*shift,point[1]+(a[1]+b[1])*shift]);
  }
  if(inset.length!==outline.length||Math.sign(signedArea(inset))!==Math.sign(ringArea))return [];
  const valid=inset.every((a,i)=>{
   const next=(i+1)%inset.length,b=inset[next];
   if(distance(a,b)<.03||!pointInRing(a,outer)||rings.slice(1).some(hole=>pointInRing(a,hole)))return false;
   if(rings.some(ring=>intersectsRing(a,b,ring))||edges.some(({inset:ring})=>intersectsRing(a,b,ring)))return false;
   return !inset.some((c,j)=>j!==i&&j!==next&&(j+1)%inset.length!==i&&
    crosses(a,b,c,inset[(j+1)%inset.length]));
  });
  if(!valid)return [];
  edges.push({outline,inset,flip:sign<0});
 }
 // Each courtyard must remain inside the inset exterior and clear of its neighbours.
 const [exterior,...courtyards]=edges;
 for(const [i,{inset}] of courtyards.entries()){
  if(!pointInRing(inset[0],exterior.inset))return [];
  if(courtyards.slice(0,i).some(hole=>pointInRing(inset[0],hole.inset)||pointInRing(hole.inset[0],inset)))return [];
 }
 return edges;
}

function addRoofCoping(geometry:THREE.ExtrudeGeometry,rings:Point[][],height:number,bevel:number){
 const edges=roofEdges(rings);
 const [cap,wall]=geometry.groups;
 const base=geometry.getAttribute('position');
 const top=height+bevel;
 if(!edges.length||!cap||!wall){
  geometry.setAttribute('roofFinish',new THREE.Float32BufferAttribute(new Float32Array(base.count),1));
  return [top];
 }
 const depth=Math.min(.57,height*.11);
 const positions:number[]=[],normals:number[]=[],uvs:number[]=[],finish:number[]=[];
 const surface=new THREE.Vector3(),other=new THREE.Vector3();
 type Vertex=[number,number,number];
 function quad(points:[Vertex,Vertex,Vertex,Vertex],kind:number,flip:boolean){
  const [a,b,c]=points;
  surface.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
  other.set(c[0]-a[0],c[1]-a[1],c[2]-a[2]);
  surface.cross(other).normalize();
  if(flip)surface.negate();
  for(const index of flip?[0,2,1,0,3,2]:[0,1,2,0,2,3]){
   const [x,y,z]=points[index];
   positions.push(x,y,z);normals.push(surface.x,surface.y,surface.z);uvs.push(x,y);finish.push(kind);
  }
 }
 for(const {outline,inset,flip} of edges)
  for(let i=0;i<outline.length;i++){
   const j=(i+1)%outline.length,a=inset[i],b=inset[j];
   quad([[...outline[i],top],[...outline[j],top],[...b,top],[...a,top]],1,flip);
   quad([[...b,top-depth],[...a,top-depth],[...a,top],[...b,top]],2,flip);
  }
 const origin=cap.count;
 const attribute=(name:string,addition:number[],width:number)=>{
  const old=geometry.getAttribute(name).array as Float32Array;
  const insertion=origin*width;
  const data=new Float32Array(old.length+addition.length);
  data.set(old.subarray(0,insertion));
  data.set(addition,insertion);
  data.set(old.subarray(insertion),insertion+addition.length);
  return new THREE.BufferAttribute(data,width);
 };
 const position=attribute('position',positions,3);
 for(let i=0;i<origin;i++)if(position.getZ(i)>height/2)position.setZ(i,position.getZ(i)-depth);
 geometry.setAttribute('position',position);
 geometry.setAttribute('normal',attribute('normal',normals,3));
 geometry.setAttribute('uv',attribute('uv',uvs,2));
 const finishes=new Float32Array(position.count);
 finishes.set(finish,origin);
 geometry.setAttribute('roofFinish',new THREE.BufferAttribute(finishes,1));
 cap.count+=finish.length;
 wall.start+=finish.length;
 return [top,top-depth];
}

function makeRoofMaterial(index:number){
 const [,roof,,trim]=palette[index];
 const material=new THREE.MeshStandardMaterial({color:roof,roughness:.88});
 material.onBeforeCompile=shader=>{
  shader.uniforms.roofCoping={value:new THREE.Color(trim).lerp(new THREE.Color('#f8eee0'),.48)};
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>',`#include <common>
    attribute float roofFinish;
    varying float vRoofFinish;
    varying vec2 roofMeters;`)
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    vRoofFinish = roofFinish;
    roofMeters = uv;`);
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>
    uniform vec3 roofCoping;
    varying float vRoofFinish;
    varying vec2 roofMeters;`)
   .replace('#include <map_fragment>',`#include <map_fragment>
    vec2 panels = roofMeters / vec2(4.6, 2.4);
    vec2 grid = min(fract(panels), 1.0 - fract(panels));
    vec2 soft = max(fwidth(panels), vec2(0.004));
    vec2 seams = 1.0 - smoothstep(vec2(0.009), vec2(0.009) + soft, grid);
    float detail = 1.0 - smoothstep(0.06, 0.24, max(soft.x, soft.y));
    diffuseColor.rgb *= 1.0 - max(seams.x * 0.034, seams.y * 0.092) * detail;
    diffuseColor.rgb = mix(diffuseColor.rgb, roofCoping * mix(1.0, 0.76, step(1.5, vRoofFinish)), step(0.5, vRoofFinish));
   `);
 };
 material.customProgramCacheKey=()=>'scent-roof-1';
 return material;
}

export function createScentBuildings(scene:THREE.Scene,buildings:Building[],onDiscover:(b:Building)=>void,field:ReturnType<typeof createExploration>){
 const scentSites=(data:Building[])=>data.filter(b=>b.category&&b.pois.length).map(b=>({b,points:b.pois.map(p=>toLocal(p.coordinate))}));
 let scents=scentSites(buildings);
 const makeItem=(b:Building)=>{
  if(b.extrude===false)return;
  const [outer,...holes]=[b.outline,...(b.holes??[])].map(contour=>roofRing(contour.map(toLocal)));
  const rings=[outer,...holes.filter(hole=>hole.length>=3)];
  const base=b.minHeight??0,depth=b.height-base;
  if(rings[0].length<3||Math.abs(signedArea(rings[0]))<.02||!Number.isFinite(depth)||depth<=0)return;
  const ring=rings[0].map(([x,y])=>[x,-y]);
  ring.push(ring[0]);
  const shape=new THREE.Shape(rings[0].map(([x,y])=>new THREE.Vector2(x,y)));
  for(const hole of rings.slice(1))if(hole.length>=3)shape.holes.push(new THREE.Path(hole.map(([x,y])=>new THREE.Vector2(x,y))));
  const bevel=Math.min(.22,depth*.2);
  const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:1,steps:1,curveSegments:1,UVGenerator:facadeUV});
  const levels=addRoofCoping(geometry,rings,depth,bevel);
  geometry.computeBoundingBox();
  const variant=Math.abs(b.id)%palette.length;
  const wall=makeFacadeMaterial(depth,variant),roof=makeRoofMaterial(variant);
  const mesh=new THREE.Mesh(geometry,[roof,wall]);mesh.rotation.x=-Math.PI/2;mesh.position.y=base+.1;scene.add(mesh);
  return {b,ring,wall,roof,mesh,depth,levels,footprint:roofFootprint(rings),opacity:1};
 };
 type BuildingItem=NonNullable<ReturnType<typeof makeItem>>;
 const items=new Map<number,BuildingItem>();
 const add=(building:Building)=>{
  const item=makeItem(building);
  if(item)items.set(building.id,item);
 };
 const separateRoofs=()=>{
  // Broadest footprint stays at its mapped height, and smaller overlapping parts sit just above it.
  const sorted=[...items.values()].sort((a,b)=>b.footprint.area-a.footprint.area||a.b.id-b.b.id);
  const byHeight=new Map<number,BuildingItem[]>();
  for(const item of sorted){
   const bucket=Math.floor(item.b.height);
   const nearby=[...(byHeight.get(bucket-1)??[]),...(byHeight.get(bucket)??[]),...(byHeight.get(bucket+1)??[])];
   const overlaps=nearby.filter(other=>Math.abs(other.b.height-item.b.height)<1&&overlappingRoofs(item.footprint,other.footprint));
   const clashes=(scale:number)=>overlaps.some(other=>item.levels.some(level=>
    other.levels.some(otherLevel=>Math.abs(item.mesh.position.y+level*scale-other.mesh.position.y-otherLevel*other.mesh.scale.z)<.055)));
   let lift=0;
   while(clashes(1+lift/item.depth))lift+=.17;
   item.mesh.scale.z=1+lift/item.depth;
   const group=byHeight.get(bucket)??[];
   group.push(item);byHeight.set(bucket,group);
  }
 };
 buildings.forEach(add);separateRoofs();
 const sightlines=Array.from({length:3},()=>new THREE.Raycaster());
 const sightBounds=new THREE.Box3(),sightStart=new THREE.Vector3();
 const remove=(i:BuildingItem)=>{scene.remove(i.mesh);i.mesh.geometry.dispose();i.wall.dispose();i.roof.dispose();};
 let last=0;
 return {
  occluders(samples:{point:THREE.Vector3;eye:THREE.Vector3;opacity:number}[],dog:number[],avatarSamples:number){
   const opacities=new Map<number,number>();
   const avatarBlockers=Array.from({length:avatarSamples},()=>[] as number[]);
   sightBounds.makeEmpty();
   samples.forEach(({point,eye},index)=>{
    const ray=sightlines[index]??(sightlines[index]=new THREE.Raycaster());
    const direction=point.clone().sub(eye),span=direction.length();
    // Front-sided façades and roof undersides must be tested from the viewing side.
    ray.near=Math.max(.07,span-350);ray.far=span-.07;
    ray.set(eye,direction.normalize());
    sightBounds.expandByPoint(ray.ray.at(ray.near,sightStart));
    sightBounds.expandByPoint(point);
   });
   for(const item of items.values()){
    if(!item.mesh.visible)continue;
    const {min,max}=item.footprint;
    // Cull by the camera rays' actual span and the mesh's footprint, including its bevel.
    let blocked=false;
    if(max[0]+.3>=sightBounds.min.x&&min[0]-.3<=sightBounds.max.x&&-min[1]+.3>=sightBounds.min.z&&-max[1]-.3<=sightBounds.max.z){
     item.mesh.updateMatrixWorld();
     for(let index=0;index<samples.length;index++){
      if(index>=avatarSamples&&blocked)break;
      if(!sightlines[index].intersectObject(item.mesh,false).length)continue;
      blocked=true;
      if(index<avatarSamples)avatarBlockers[index].push(item.b.id);
      else opacities.set(item.b.id,samples[index].opacity);
     }
    }
    const closeToAvatar=dog[0]>=min[0]-2.7&&dog[0]<=max[0]+2.7&&dog[1]>=-max[1]-2.7&&dog[1]<=-min[1]+2.7;
    if(!blocked&&closeToAvatar&&(item.b.minHeight??0)<2.7&&item.ring.some((point,index)=>index>0&&segmentProjection(dog,item.ring[index-1],point).distance<2.7)){
     opacities.set(item.b.id,.58);
    }
   }
   for(const [index,blockers] of avatarBlockers.entries()){
    if(!blockers.length)continue;
    // Limit the combined opacity of overlapping roofs and façades along each sightline.
    const opacity=Math.min(samples[index].opacity,1-Math.pow(.78,1/blockers.length));
    for(const id of blockers)opacities.set(id,Math.min(opacities.get(id)??1,opacity));
   }
   return opacities;
  },
  sync(next:Building[]){
   scents=scentSites(next);
   const ids=new Set(next.map(b=>b.id));
   let changed=false;
   for(const [id,item] of items)if(!ids.has(id)){remove(item);items.delete(id);changed=true;}
   for(const building of next)if(!items.has(building.id)){add(building);changed=true;}
   if(changed)separateRoofs();
  },
  clear(){for(const item of items.values())remove(item);items.clear();scents=[];},
  update(t:number,position:number[],range:number,exploring:boolean,discovered:Set<number>,reduced=false,occluded=new Map<number,number>()){
   const dt=Math.min(.05,Math.max(0,t-last));last=t;
   if(exploring)for(const {b,points} of scents){
    if(!discovered.has(b.id)&&distance(b.center,position)<500&&points.some(point=>distance(point,position)<range)){
     discovered.add(b.id);onDiscover(b);
    }
   }
   for(const item of items.values()){
    const near=distance(item.b.center,position);
    const groundVisible=(point:number[])=>field.sample(point[0],point[1])>.01;
    item.mesh.visible=near<340&&(near<130||groundVisible(item.b.center)||item.ring.some(groundVisible));
    if(near>500)continue;
    const target=occluded.get(item.b.id)??1;
    if(target<=.12)item.opacity=Math.min(item.opacity,target*1.6);
    const blend=reduced?1:1-Math.exp(-dt*(target<item.opacity?15:6));
    item.opacity+=(target-item.opacity)*blend;
    const transparent=item.opacity<.995;
    for(const material of [item.wall,item.roof]){
     if(material.transparent!==transparent){material.transparent=transparent;material.needsUpdate=true;}
     material.opacity=item.opacity;material.depthWrite=!transparent;
    }
   }
  }
 };
}
