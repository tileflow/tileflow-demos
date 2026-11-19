import * as THREE from 'three';
import {makeHeart,SNIFF_BEATS,SNIFF_BREATH,SNIFF_CYCLE} from './objects';

/** Each inhalation pulls a short curved wisp and a few air specks into the muzzle. */
export function createSniffEffect(){
 const group=new THREE.Group();
 group.visible=false;
 const lead=.08,travel=SNIFF_BREATH+lead-.02;
 const speckGeometry=new THREE.OctahedronGeometry(1);
 const lanes=[-1,1].map(side=>{
  const warm=side===1;
  const curve=new THREE.CatmullRomCurve3([
   new THREE.Vector3(side*1.52,-.24,warm?2.95:3.72),
   new THREE.Vector3(side*1.87,-.11,warm?2.02:2.59),
   new THREE.Vector3(side*1.18,.26,warm?1.32:1.63),
   new THREE.Vector3(side*.44,.11,.71),
   new THREE.Vector3(side*.11,.09,.18),
  ]);
  const material=new THREE.ShaderMaterial({
   transparent:true,depthWrite:false,
   uniforms:{
    tint:{value:new THREE.Color(warm?'#ffd388':'#ab76ef')},
    tip:{value:0},strength:{value:0},
   },
   vertexShader:`varying vec2 airUV;
    void main(){airUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
   fragmentShader:`varying vec2 airUV;
    uniform vec3 tint;uniform float tip;uniform float strength;
    void main(){
     float tail=tip-airUV.x;
     float flow=smoothstep(-0.035,0.095,tail)*(1.0-smoothstep(0.23,0.53,tail));
     float edge=smoothstep(0.0,0.14,airUV.x)*(1.0-smoothstep(0.86,1.0,airUV.x));
     gl_FragColor=vec4(tint,edge*flow*strength);
     #include <colorspace_fragment>
    }`,
  });
  const ribbon=new THREE.Mesh(new THREE.TubeGeometry(curve,18,warm?.092:.125,6,false),material);
  const specks=[.08,.25].map((lag,index)=>{
   const mat=new THREE.MeshBasicMaterial({color:warm?'#fff5d3':'#e5ccff',transparent:true,depthWrite:false});
   const mesh=new THREE.Mesh(speckGeometry,mat);
   group.add(mesh);
   return {mesh,lag,size:index===0?.13:.085};
  });
  group.add(ribbon);
  return {curve,material,ribbon,specks,warm};
 });
 return {group,update(age:number,active:boolean,reduced:boolean){
  group.visible=active;
  if(!active)return;
  const phase=age%SNIFF_CYCLE;
  let progress:number|undefined;
  for(const beat of SNIFF_BEATS){
   const value=(phase-beat+lead)/travel;
   if(value<0||value>=1)continue;
   progress=value;
   break;
  }
  for(const {curve,material,ribbon,specks,warm} of lanes){
   ribbon.visible=reduced||progress!==undefined;
   if(reduced){
    material.uniforms.tip.value=.63+(warm?-.07:.12);
    material.uniforms.strength.value=.76;
   }else if(progress!==undefined){
    material.uniforms.tip.value=progress*1.30+(warm?-.09:.04);
    material.uniforms.strength.value=Math.min(1,progress*8,(1-progress)*8)*(warm?.83:.92);
   }
   for(const {mesh,lag,size} of specks){
    const u=(progress??-1)*1.27-lag-(warm?.08:0);
    mesh.visible=!reduced&&u>0&&u<1;
    if(!mesh.visible)continue;
    curve.getPointAt(u,mesh.position);
    mesh.position.y+=.095*Math.sin(u*Math.PI);
    const fade=Math.min(1,u*9,(1-u)*7);
    mesh.material.opacity=fade;
    mesh.scale.setScalar(size*(.7+.3*fade));
    mesh.rotation.set(u*4,u*4,u*2);
   }
  }
 }};
}

/** Screen-facing 3D recovery meter that follows the dog's projected head. */
export function createRestMeter(){
 const group=new THREE.Group(),heart=makeHeart('#ff719b'),pink=new THREE.MeshStandardMaterial({color:'#ff719b',roughness:.35}),pale=new THREE.MeshStandardMaterial({color:'#e1d6ed',roughness:.5}),ink=new THREE.MeshStandardMaterial({color:'#8061b5',roughness:.45});heart.scale.setScalar(9);heart.position.x=-9;group.add(heart);
 const beads=Array.from({length:16},(_,i)=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(1.7,10,8),pale);const a=i/16*Math.PI*2+Math.PI/2;mesh.position.set(-9+Math.cos(a)*17,Math.sin(a)*17,0);group.add(mesh);return mesh;});
 const segments=[[0,7,0],[4,3.5,1],[4,-3.5,1],[0,-7,0],[-4,-3.5,1],[-4,3.5,1],[0,0,0]].map(([x,y,v])=>{const m=new THREE.Mesh(new THREE.BoxGeometry(v?2:7,v?5:2,2),ink);m.position.set(24+x,y,0);group.add(m);return m;});const numbers:Record<number,number[]>={1:[1,2],2:[0,1,6,4,3],3:[0,1,6,2,3]};
 return {group,update(progress:number,remaining:number,full:boolean,t:number,reduced:boolean){beads.forEach((m,i)=>{m.material=full||i/16<progress?pink:pale;});segments.forEach((m,i)=>m.visible=!full&&(numbers[Math.max(1,Math.min(3,remaining))]??[]).includes(i));heart.scale.setScalar(9*(reduced?1:1+Math.sin(t*5)*.05));(heart.material as THREE.MeshStandardMaterial).color.set(full?'#ff719b':'#f597bc');},dispose(){group.traverse(o=>{const m=o as THREE.Mesh;m.geometry?.dispose();});pink.dispose();pale.dispose();ink.dispose();(heart.material as THREE.Material).dispose();}};
}

/** Small rising ribbons, so food is readable without labels or ground discs. */
export function createFoodSteam(){const group=new THREE.Group(),ribbons:THREE.Mesh[]=[];for(let i=0;i<3;i++){const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,0,0),new THREE.Vector3(.25,.7,.08),new THREE.Vector3(-.2,1.4,0),new THREE.Vector3(.1,2.1,-.1)]);const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,16,.07,5,false),new THREE.MeshBasicMaterial({color:'#fff7dc',transparent:true,opacity:.7,depthWrite:false}));group.add(mesh);ribbons.push(mesh);}return {group,update(t:number,base:number,reduced:boolean){ribbons.forEach((mesh,i)=>{const u=reduced?.4:(t*.45+i/3)%1;mesh.position.set((i-1)*.65,base+u*1.7,Math.sin(i*2)*.35);mesh.scale.set(1+u*.35,.55+u*.55,1);(mesh.material as THREE.MeshBasicMaterial).opacity=reduced?.6:Math.sin(u*Math.PI)*.8;});}};}

export function createWaterSplash(){
 const group=new THREE.Group();
 group.visible=false;
 const geometry=new THREE.SphereGeometry(.24,7,5);
 const material=new THREE.MeshStandardMaterial({color:'#8edffc',roughness:.18,metalness:.12,transparent:true,depthWrite:false});
 const drops=Array.from({length:8},()=>{
  const mesh=new THREE.Mesh(geometry,material);
  group.add(mesh);
  return mesh;
 });
 return {group,update(age:number,reduced:boolean){
  const life=age/.72;
  group.visible=!reduced&&life>=0&&life<1;
  if(!group.visible)return;
  material.opacity=Math.min(1,(1-life)*1.8);
  for(const [index,drop] of drops.entries()){
   const angle=index*2.4,reach=1.6+life*(2.2+(index%3)*.65);
   const arc=Math.sin(life*Math.PI);
   drop.position.set(Math.cos(angle)*reach,1.6-life*1.4+arc*(2.1+index%3),Math.sin(angle)*reach);
   drop.scale.set(.9,1.25+.6*arc,.9);
  }
 }};
}
