import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
const material=(color:string,extra:THREE.MeshStandardMaterialParameters={})=>new THREE.MeshStandardMaterial({color,roughness:.45,...extra});
const sphere=(parent:THREE.Object3D,mat:THREE.Material,x:number,y:number,z:number,sx:number,sy=sx,sz=sx)=>{const m=new THREE.Mesh(new THREE.SphereGeometry(1,16,12),mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);parent.add(m);return m;};
export function makeStar(){const shape=new THREE.Shape();for(let i=0;i<10;i++){const a=i*Math.PI/5+Math.PI/2,r=i%2?.48:1;const p=[Math.cos(a)*r,Math.sin(a)*r];i?shape.lineTo(p[0],p[1]):shape.moveTo(p[0],p[1]);}shape.closePath();const geometry=new THREE.ExtrudeGeometry(shape,{depth:.26,bevelEnabled:true,bevelSize:.09,bevelThickness:.1,bevelSegments:3,curveSegments:6});geometry.translate(0,0,-.13);const g=new THREE.Group();g.add(new THREE.Mesh(geometry,material('#ffcd35',{metalness:.25,roughness:.3})));for(const x of [-.22,.22])sphere(g,material('#795017'),x,.1,.25,.055,.09,.035);return g;}
export function makePoop(){const g=new THREE.Group(),brown=material('#965038'),points=[];for(let i=0;i<=100;i++){const u=i/100,a=u*Math.PI*5,r=(1-u)*1.55;points.push(new THREE.Vector3(Math.cos(a)*r,.65+u*2.4,Math.sin(a)*r));}g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),100,.48,12,false),brown));sphere(g,brown,0,.35,0,1.7,.55,1.6);const flies=new THREE.Group();for(let i=0;i<3;i++){const fly=new THREE.Group();sphere(fly,material('#38323e'),0,0,0,.12);for(const side of [-1,1])sphere(fly,material('#e7f0ff',{transparent:true,opacity:.8}),side*.13,.05,0,.15,.035,.08);flies.add(fly);}g.add(flies);return {root:g,flies};}
export function makeCar(color='#ff8064'){
 const g=new THREE.Group(),body=material(color,{roughness:.32}),glass=material('#8bd3df',{metalness:.15,roughness:.18}),cream=material('#fff3d8'),dark=material('#4e4762');
 const rounded=(mat:THREE.Material,p:number[],s:number[],radius=.22)=>{const m=new THREE.Mesh(new RoundedBoxGeometry(s[0],s[1],s[2],3,radius),mat);m.position.set(...p as [number,number,number]);g.add(m);return m;};
 rounded(dark,[0,.85,0],[2.65,.55,5.8]);rounded(body,[0,1.5,0],[2.9,1.4,6.5],.4);rounded(glass,[0,2.65,-.35],[2.5,1.65,3.15],.4);rounded(body,[0,3.4,-.4],[2.6,.28,3.2],.15);
 rounded(body,[0,2.65,-.35],[.14,1.65,3.2],.04);for(const x of [-1.28,1.28]){rounded(body,[x,2.65,-.4],[.12,1.65,.2],.04);rounded(body,[x,1.9,-.45],[.08,.07,.42],.03);rounded(body,[x*1.15,2.15,1.2],[.4,.25,.45],.1);}
 for(const side of [-1,1])for(const z of [-2.05,2.05]){const tyre=new THREE.Mesh(new THREE.CylinderGeometry(.69,.69,.34,20),dark);tyre.rotation.z=Math.PI/2;tyre.position.set(side*1.42,.75,z);g.add(tyre);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.36,.36,.37,16),cream);hub.rotation.z=Math.PI/2;hub.position.copy(tyre.position);g.add(hub);}
 for(const x of [-.87,.87]){rounded(material('#fff2b7',{emissive:'#ffe397',emissiveIntensity:.25}),[x,1.65,3.24],[.65,.42,.12],.09);rounded(material('#ed6a78'),[x,1.65,-3.24],[.65,.3,.12],.08);}rounded(cream,[0,1,3.24],[2.3,.22,.18],.08);rounded(dark,[0,1.47,3.28],[.75,.19,.07],.05);rounded(cream,[0,1,-3.24],[2.3,.22,.18],.08);return g;
}
export function makeSmoke(){const root=new THREE.Group(),mat=material('#c4d96e',{transparent:true,opacity:.38,depthWrite:false}),puffs=Array.from({length:5},()=>sphere(root,mat,0,0,0,1));return {root,puffs};}

export function makeBus(color='#ffd05a'){
 const g=new THREE.Group(),body=material(color),glass=material('#8fdce7',{roughness:.25}),cream=material('#fff4d8'),dark=material('#473d60');
 const box=(mat:THREE.Material,p:number[],s:number[])=>{const m=new THREE.Mesh(new THREE.BoxGeometry(...s as [number,number,number]),mat);m.position.set(...p as [number,number,number]);g.add(m);return m;};
 box(body,[0,2.3,0],[4.2,3,12]);box(cream,[0,4.4,0],[4.25,.4,12.1]);box(cream,[0,1.9,0],[4.25,.24,12.05]);box(glass,[0,3,5.98],[3.65,1.7,.08]);box(glass,[0,3,-5.98],[3.65,1.7,.08]);
 for(const side of [-1,1])for(let i=0;i<5;i++)box(glass,[side*2.12,3.1,-4.5+i*2.2],[.08,1.65,1.7]);
 for(const side of [-1,1])for(const z of [-4.1,4.1]){const tyre=new THREE.Mesh(new THREE.CylinderGeometry(.95,.95,.5,20),dark);tyre.rotation.z=Math.PI/2;tyre.position.set(side*2.1,.95,z);g.add(tyre);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.52,16),cream);hub.rotation.z=Math.PI/2;hub.position.copy(tyre.position);g.add(hub);}
 for(const x of [-1.35,1.35])box(cream,[x,1.7,6.05],[.7,.5,.12]);box(dark,[0,1,-6.1],[3.6,.4,.2]);box(material('#8a72de'),[0,4.75,-.5],[2.7,.35,4.8]);box(dark,[0,4.05,6.02],[2.2,.44,.12]);box(cream,[0,4.05,6.1],[1.05,.13,.06]);return g;
}

const box=(parent:THREE.Object3D,mat:THREE.Material,p:number[],s:number[])=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...s as [number,number,number]),mat);mesh.position.set(...p as [number,number,number]);parent.add(mesh);return mesh;};
export function makeBarrier(width=10){
 const g=new THREE.Group(),orange=material('#ff9956'),cream=material('#fff5dc'),dark=material('#6c6385');
 for(const x of [-width/2+.6,width/2-.6]){box(g,dark,[x,.25,0],[1.5,.5,2.6]);box(g,orange,[x,1.7,0],[.45,3.1,.45]);}
 for(const y of [1.3,2.5]){box(g,cream,[0,y,0],[width,.7,.55]);for(let x=-width/2+.8;x<width/2;x+=1.7){const stripe=box(g,orange,[x,y,.3],[.65,.7,.07]);stripe.rotation.z=-.25;}}
 for(const x of [-width/2+.6,width/2-.6])sphere(g,material('#ffca47',{emissive:'#ffad21',emissiveIntensity:.35}),x,3.45,0,.35);
 return g;
}
function makeWorkVehicle(color:string){
 const truck=new THREE.Group();
 const gold=material(color),dark=material('#4c425a'),glass=material('#8ad3df'),cream=material('#fff0c8');
 const warm=material('#d0a07b'),lights=material('#ffad46',{emissive:'#ff8e27',emissiveIntensity:.4});
 const rounded=(mat:THREE.Material,position:[number,number,number],size:[number,number,number],radius:number)=>{
  const model=new THREE.Mesh(new RoundedBoxGeometry(...size,2,radius),mat);
  model.position.set(...position);truck.add(model);
 };
 rounded(dark,[0,.92,0],[3.15,.58,7.5],.14);
 rounded(gold,[0,2.13,2.45],[3.15,2.65,2.62],.26);
 rounded(glass,[0,2.88,3.72],[2.58,1.22,.1],.05);
 rounded(gold,[0,1.5,-1.38],[3.42,.93,4.72],.18);
 for(const side of [-1,1]){
  rounded(glass,[side*1.55,2.92,2.48],[.1,1.08,1.84],.05);
  rounded(gold,[side*1.58,2.11,-1.46],[.24,1,4.56],.11);
  rounded(cream,[side*1.35,1.46,3.83],[.62,.44,.11],.05);
  for(const z of [-2.46,2.62]){
   const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.75,.75,.44,14),dark);
   wheel.rotation.z=Math.PI/2;wheel.position.set(side*1.56,.78,z);truck.add(wheel);
   const hub=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,.46,12),cream);
   hub.rotation.z=wheel.rotation.z;hub.position.copy(wheel.position);truck.add(hub);
  }
 }
 for(let i=0;i<9;i++){
  const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.54+i%3*.12),warm);
  rock.position.set((i%3-1)*.77,2.02,-.32-Math.floor(i/3)*1.02);
  rock.rotation.set(i*.8,i*1.7,i*.92);truck.add(rock);
 }
 rounded(lights,[0,3.65,2.4],[.66,.34,.39],.15);
 return truck;
}

function makeRoadClosedSign(){
 const canvas=document.createElement('canvas');
 canvas.width=512;canvas.height=216;
 const context=canvas.getContext('2d')!;
 context.fillStyle='#251b35';
 context.beginPath();context.roundRect(2,2,508,212,25);context.fill();
 context.fillStyle='#ffe9b2';
 context.beginPath();context.roundRect(12,12,488,192,17);context.fill();
 context.fillStyle='#ce363e';
 context.beginPath();context.roundRect(20,20,472,176,11);context.fill();
 context.fillStyle='#fff7dc';
 context.textAlign='center';context.textBaseline='middle';
 context.font='900 70px Nunito, system-ui, sans-serif';
 context.fillText('ROAD CLOSED',256,78,446);
 context.fillRect(45,123,422,5);
 context.font='900 43px Nunito, system-ui, sans-serif';
 context.fillText('NO ENTRY',256,159);
 const texture=new THREE.CanvasTexture(canvas);
 texture.colorSpace=THREE.SRGBColorSpace;
 const sign=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthWrite:false}));
 sign.scale.set(12,5.06,1);
 sign.renderOrder=5;
 return sign;
}

export function makeWorksSite(width:number,offset=0){
 const root=new THREE.Group(),fence=new THREE.Group();
 fence.position.x=offset;
 root.add(fence);
 const navy=material('#465373'),panel=material('#667c9f'),stripe=material('#ff6a54');
 const cream=material('#fff2d8'),light=material('#ffb64b',{emissive:'#ff8a25',emissiveIntensity:.55});
 const sections=Math.max(2,Math.round(width/3));
 const panelWidth=width/sections;
 for(let i=0;i<sections;i++){
  const center=-width/2+panelWidth*(i+.5);
  box(fence,panel,[center,2.85,0],[panelWidth-.13,5.7,.36]);
  for(let x=center-panelWidth/2+.28;x<center+panelWidth/2-.19;x+=.44){
   box(fence,navy,[x,2.85,0],[.11,5.6,.49]);
  }
  for(const face of [-1,1]){
   box(fence,stripe,[center,4.35,face*.25],[panelWidth-.16,.77,.10]);
   const warning=box(fence,cream,[center,4.35,face*.31],[.68,.78,.07]);
   warning.rotation.z=-.29;
  }
 }
 for(let i=0;i<=sections;i++){
  const x=-width/2+panelWidth*i;
  box(fence,navy,[x,.24,0],[.78,.48,1.25]);
  box(fence,navy,[x,3.1,0],[.34,6.2,.54]);
  box(fence,light,[x,6.32,0],[.53,.27,.54]);
 }
 for(const y of [.62,5.8])box(fence,navy,[0,y,0],[width,.31,.57]);

 const truck=makeWorkVehicle('#f4b74f');
 truck.position.z=2.1;truck.rotation.y=Math.PI/2;
 const utility=makeWorkVehicle('#ef845b');
 utility.scale.setScalar(.69);utility.position.z=-2.05;utility.rotation.y=-Math.PI/2;
 root.add(truck,utility);
 for(const side of [-1,1])for(const depth of [-3.25,3.25]){
  const x=side*Math.min(4.15,width/2-.5),z=depth;
  box(root,navy,[x,.12,z],[.84,.24,.84]);
  const cone=new THREE.Mesh(new THREE.CylinderGeometry(.06,.37,1.1,12),stripe);
  cone.position.set(x,.68,z);root.add(cone);
  const band=new THREE.Mesh(new THREE.CylinderGeometry(.19,.25,.22,12),cream);
  band.position.set(x,.68,z);root.add(band);
 }
 const sign=makeRoadClosedSign();
 sign.position.set(offset,7.55,0);
 root.add(sign);
 return root;
}

export function makePothole(){
 const root=new THREE.Group(),count=18;
 const edge=Array.from({length:count},(_,i)=>{
  const angle=i/count*Math.PI*2,radius=2.85+Math.sin(i*3.2)*.32+Math.cos(i*1.73)*.22;
  return [Math.cos(angle)*radius,Math.sin(angle)*radius*.81];
 });
 // The raised broken asphalt wraps a dark, lower bowl over the map surface.
 const rings=[
  {radius:1.17,height:.02,color:'#8d807c'},
  {radius:1,height:.48,color:'#a38f88'},
  {radius:.83,height:.32,color:'#60535f'},
  {radius:.56,height:.045,color:'#3b3549'},
  {radius:0,height:.041,color:'#332d40'},
 ];
 const positions:number[]=[],colors:number[]=[],indices:number[]=[];
 for(const ring of rings){
  const tint=new THREE.Color(ring.color);
  edge.forEach(([x,z],i)=>{
   const broken=ring.height>.1?Math.sin(i*2.6)*.1:0;
   positions.push(x*ring.radius,ring.height+broken,z*ring.radius);
   const shade=.88+.12*Math.sin(i*2.2);
   colors.push(tint.r*shade,tint.g*shade,tint.b*shade);
  });
 }
 for(let ring=0;ring<rings.length-1;ring++)for(let i=0;i<count;i++){
  const outer=ring*count+i,outerNext=ring*count+(i+1)%count;
  const inner=outer+count,innerNext=outerNext+count;
  indices.push(outer,inner,innerNext,outer,innerNext,outerNext);
 }
 const bowl=new THREE.BufferGeometry();
 bowl.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 bowl.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 bowl.setIndex(indices);bowl.computeVertexNormals();
 root.add(new THREE.Mesh(bowl,material('#ffffff',{vertexColors:true,roughness:.95})));

 const crack=material('#695764',{roughness:1,side:THREE.DoubleSide}),grit=material('#b29b87',{roughness:.9});
 for(const i of [0,4,8,11,15]){
  const [x,z]=edge[i],angle=Math.atan2(z,x),length=i%2?1.23:.86;
  const vertices=[
   x*1.07,.035,z*1.07, x*1.08+.15*Math.sin(angle),.035,z*1.08-.15*Math.cos(angle),
   x*1.15+.33*Math.cos(angle),.034,z*1.15+.33*Math.sin(angle),
   x*1.15+.28*Math.cos(angle),.034,z*1.15+.34*Math.sin(angle),
   x*1.17+length*Math.cos(angle+.24),.032,z*1.17+length*Math.sin(angle+.24),
  ];
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setIndex([0,1,2,0,2,3,3,2,4]);
  geometry.computeVertexNormals();
  root.add(new THREE.Mesh(geometry,crack));
  const pebble=new THREE.Mesh(new THREE.DodecahedronGeometry(.36+(i%3)*.07),grit);
  pebble.scale.set(1,.54,.78);
  pebble.position.set(x*1.16,.19,z*1.19);
  pebble.rotation.y=i*1.3;
  root.add(pebble);
 }
 return root;
}
function makeComicShout(word:string){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
 const context=canvas.getContext('2d')!;
 const width=canvas.width,height=canvas.height;
 context.translate(width/2,height*.43);
 context.beginPath();
 for(let i=0;i<28;i++){
  const a=Math.PI*i/14,r=i%2?.84:1;
  const tail=i===6||i===8?30:0;
  const x=Math.cos(a)*r*232,y=Math.sin(a)*r*93+tail;
  i===0?context.moveTo(x,y):context.lineTo(x,y);
 }
 context.closePath();context.fillStyle='#fff1bd';context.fill();
 context.lineJoin='round';context.strokeStyle='#513964';context.lineWidth=12;context.stroke();
 context.font='900 92px Nunito, system-ui, sans-serif';context.textAlign='center';context.textBaseline='middle';
 context.fillStyle='#653460';context.fillText(word,0,4,375);
 const texture=new THREE.CanvasTexture(canvas);
 texture.colorSpace=THREE.SRGBColorSpace;
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthWrite:false,transparent:true}));
 sprite.scale.set(12,6,1);sprite.renderOrder=5;
 return sprite;
}

export function makeCrowd(){
 const root=new THREE.Group();
 const shirts=['#ff9c80','#9d89df','#71c9cf','#ed96b9'].map(color=>material(color));
 const skins=['#d9a476','#f2c59b','#a96e51'].map(color=>material(color));
 const dark=material('#5d4b6a'),wood=material('#b48a63'),cream=material('#ffe49c'),rose=material('#f5d0e3');
 const people=Array.from({length:7},(_,i)=>{
  const person=new THREE.Group(),x=(i%3-1)*2.7,z=(Math.floor(i/3)-1)*2.2;
  const shirt=shirts[i%shirts.length],skin=skins[i%skins.length],arms:THREE.Group[]=[],legs:THREE.Group[]=[];
  box(person,shirt,[0,2.35,0],[1.25,1.7,.85]);
  sphere(person,skin,0,3.9,0,.7);sphere(person,dark,0,4.22,-.15,.68,.45,.6);
  for(const side of [-1,1]){
   sphere(person,dark,side*.22,3.98,.6,.08,.075,.08);
   const leg=new THREE.Group();leg.position.set(side*.34,1.55,0);
   box(leg,dark,[0,-.57,0],[.43,1.15,.5]);box(leg,dark,[0,-1.22,.18],[.5,.35,.76]);
   person.add(leg);legs.push(leg);
   const arm=new THREE.Group();arm.position.set(side*.67,2.94,0);
   box(arm,shirt,[0,-.47,0],[.4,1,.47]);sphere(arm,skin,0,-1,0,.24);
   arm.rotation.z=side*.34;person.add(arm);arms.push(arm);
  }
  if(i%2===0){
   const rightArm=arms[1];
   box(rightArm,wood,[0,.43,.18],[.12,2.8,.12]);
   box(rightArm,i%4?cream:rose,[0,1.93,.18],[2.1,1.4,.17]);
   const star=makeStar();star.scale.setScalar(.42);star.position.set(0,1.93,.29);rightArm.add(star);
  }
  root.add(person);return {person,legs,arms,x,z};
 });
 const shouts=['HEY!','GRR!','NOW!'].map(makeComicShout);
 for(const shout of shouts){shout.visible=false;root.add(shout);}
 let lastChant=-1;
 return {root,update(t:number,reduced:boolean,near:boolean,offset:number){
  const time=t+offset;
  for(const [index,{person,legs,arms,x,z}] of people.entries()){
   const phase=time*4.5+index*.83;
   person.position.set(x+(reduced?0:Math.sin(time*1.1+index)*.72),reduced?0:Math.abs(Math.sin(phase))*.16,z+(reduced?0:Math.cos(time*.92+index)*.9));
   person.rotation.y=(index%3-1)*.25+(reduced?0:Math.sin(time*1.3+index)*.3);
   legs.forEach((leg,i)=>leg.rotation.x=reduced?0:Math.sin(phase+i*Math.PI)*.42);
   arms.forEach((arm,i)=>{
    const sign=i===1&&index%2===0;
    arm.rotation.x=reduced?0:Math.sin(phase*(sign?.52:1)+i*Math.PI)*(sign?.32:.59);
    arm.rotation.z=(i===0?-.3:.3)+(reduced?0:Math.sin(phase*.48)*.13);
   });
  }
  const chant=Math.floor(time/4.2),progress=(time%4.2)/1.32;
  for(const [i,shout] of shouts.entries()){
   shout.visible=near&&i===chant%shouts.length&&progress<1;
   if(!shout.visible)continue;
   const bump=reduced?1:Math.min(1,progress*7)*(.9+Math.sin(progress*Math.PI)*.12);
   shout.scale.set(12*bump,6*bump,1);
   shout.position.set((chant%3-1)*2.8,8.8+(reduced?0:progress*2.5),-.3);
   shout.material.opacity=reduced?1:Math.min(1,progress*8,(1-progress)*4);
  }
  if(near&&progress<.7&&lastChant!==chant){lastChant=chant;return true;}
  return false;
 }};
}

export function makeSprinkler(){
 const root=new THREE.Group();
 const brass=material('#df8747'),navy=material('#294661'),sky=material('#47b8df');
 const cylinder=(radius:number,height:number,y:number,mat:THREE.Material)=>{
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,height,12),mat);
  mesh.position.y=y;root.add(mesh);
 };
 cylinder(1.05,.25,.14,navy);
 cylinder(.82,.27,.36,brass);
 cylinder(.33,.67,.75,navy);
 const head=box(root,sky,[0,1.21,0],[1.28,.36,.55]);
 const tip=box(head,brass,[.65,0,0],[.16,.29,.39]);
 tip.rotation.z=-.18;

 const warningMaterial=new THREE.MeshBasicMaterial({color:'#ffc352',transparent:true,opacity:.6,depthWrite:false});
 const warning=new THREE.Mesh(new THREE.RingGeometry(4.55,4.8,40),warningMaterial);
 warning.rotation.x=-Math.PI/2;
 warning.position.y=.045;
 warning.visible=false;
 root.add(warning);

 const spray=new THREE.Group();
 spray.visible=false;
 root.add(spray);
 const water=new THREE.MeshStandardMaterial({
  color:'#63cef8',transparent:true,opacity:.48,depthWrite:false,roughness:.17,
  emissive:'#4d9dcc',emissiveIntensity:.27,
 });
 const highlight=new THREE.MeshBasicMaterial({color:'#dbfdff',transparent:true,opacity:.87,depthWrite:false});
 const rippleMaterial=new THREE.MeshBasicMaterial({
  color:'#baf4ff',transparent:true,opacity:.68,depthWrite:false,side:THREE.DoubleSide,
 });
 const mistMaterial=new THREE.MeshBasicMaterial({color:'#b6f2fd',transparent:true,opacity:.23,depthWrite:false});
 const dropMaterial=new THREE.MeshStandardMaterial({
  color:'#c2f2ff',emissive:'#5baccd',emissiveIntensity:.36,roughness:.13,
 });
 const tiers=[
  {count:8,start:.46,end:4.12,lift:3.24,offset:0,thickness:.27},
  {count:5,start:.3,end:2.34,lift:3.76,offset:.29,thickness:.21},
 ];
 type Tier=typeof tiers[number];
 const arcHeight=(tier:Tier,u:number)=>1.2*(1-u)+.16*u+tier.lift*Math.sin(u*Math.PI);
 const arcRadius=(tier:Tier,u:number)=>tier.start+(tier.end-tier.start)*u;
 const batch=(geometry:THREE.BufferGeometry,mat:THREE.Material,count:number,order:number,dynamic=false)=>{
  const mesh=new THREE.InstancedMesh(geometry,mat,count);
  mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,1.8,0),5.9);
  mesh.renderOrder=order;
  if(dynamic)mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  spray.add(mesh);
  return mesh;
 };
 const angles:{tier:Tier;angle:number}[]=[];
 const matrix=new THREE.Matrix4();
 for(const tier of tiers){
  const arch=new THREE.CatmullRomCurve3(Array.from({length:8},(_,i)=>{
   const u=i/7;
   return new THREE.Vector3(arcRadius(tier,u),arcHeight(tier,u),0);
  }));
  const jets=batch(new THREE.TubeGeometry(arch,26,tier.thickness,6,false),water,tier.count,2);
  const cores=batch(new THREE.TubeGeometry(arch,26,tier.thickness*.38,5,false),highlight,tier.count,3);
  for(let i=0;i<tier.count;i++){
   const angle=i*Math.PI*2/tier.count+tier.offset;
   angles.push({tier,angle});
   matrix.makeRotationY(angle);
   jets.setMatrixAt(i,matrix);
   cores.setMatrixAt(i,matrix);
  }
  jets.instanceMatrix.needsUpdate=cores.instanceMatrix.needsUpdate=true;
 }

 const dropsPerArc=5;
 const drops=batch(new THREE.SphereGeometry(.18,8,6),dropMaterial,angles.length*dropsPerArc,4,true);
 const ripples=batch(new THREE.RingGeometry(.7,1,16).rotateX(-Math.PI/2),rippleMaterial,angles.length*2,3,true);
 const mist=batch(new THREE.IcosahedronGeometry(1,0),mistMaterial,angles.length*2,4,true);
 const particle=new THREE.Object3D();
 const amber=new THREE.Color('#ffba46'),blue=new THREE.Color('#6ddcff');
 let burstStart=0,wasActive=false;
 return {root,update(time:number,active:boolean,anticipating:boolean,reduced:boolean){
  warning.visible=active||anticipating;
  spray.visible=active;
  if(warning.visible){
   warningMaterial.color.copy(active?blue:amber);
   warningMaterial.opacity=anticipating&&!active&&!reduced?.59+.29*Math.sin(time*10):.72;
  }
  if(active&&(!wasActive||time<burstStart))burstStart=time;
  wasActive=active;
  head.rotation.y=active?(reduced?0:time*.53):0;
  if(!active)return;
  spray.rotation.y=head.rotation.y;
  spray.scale.y=reduced?1:Math.min(1,.64+(time-burstStart)*3.7);
  for(const [index,{tier,angle}] of angles.entries()){
   const cos=Math.cos(angle),sin=Math.sin(angle);
   for(let i=0;i<dropsPerArc;i++){
    const phase=(.06+i/dropsPerArc+index*.071+(reduced?0:time*1.65))%1;
    const radius=arcRadius(tier,phase),scatter=.16*Math.sin(index*23+i*1.4);
    particle.position.set(cos*radius+sin*scatter,arcHeight(tier,phase)+.19*Math.sin(i+index),-sin*radius+cos*scatter);
    const size=.71+.38*Math.sin(i*1.22+index*1.27)**2;
    particle.scale.set(size,size*(1.35+.48*(1-phase)),size);
    particle.updateMatrix();
    drops.setMatrixAt(index*dropsPerArc+i,particle.matrix);
   }
   for(let i=0;i<2;i++){
    const phase=reduced?.3+i*.31:(time*1.85+index*.113+i*.5)%1;
    const spread=.16+.49*phase;
    particle.position.set(cos*tier.end,.08+i*.025,-sin*tier.end);
    particle.scale.set(spread,1,spread);
    particle.updateMatrix();
    ripples.setMatrixAt(index*2+i,particle.matrix);
    const reach=tier.end-.34+i*.31+.27*phase;
    const side=(i-.5)*.5;
    const size=(.1+phase*.26)*(1-phase*.49);
    particle.position.set(cos*reach+sin*side,.18+.57*Math.sin(phase*Math.PI),-sin*reach+cos*side);
    particle.scale.set(size*1.3,size*.8,size*1.3);
    particle.updateMatrix();
    mist.setMatrixAt(index*2+i,particle.matrix);
   }
  }
  drops.instanceMatrix.needsUpdate=ripples.instanceMatrix.needsUpdate=mist.instanceMatrix.needsUpdate=true;
 }};
}

export type ParkFountain = {point:number[];reach:number;lift:number;base:number};

export function makeParkFountains(){
 const root=new THREE.Group();
 root.name='Continuous park fountain water';
 const capacity=8,arcs=7,dropsPerArc=4;
 const profile=(u:number)=>.22*(1-u)+.045*u+.84*Math.sin(u*Math.PI);
 const stream=new THREE.CatmullRomCurve3(Array.from({length:8},(_,index)=>{
  const u=index/7;
  return new THREE.Vector3(.12+.88*u,profile(u),0);
 }));
 const water=new THREE.MeshStandardMaterial({
  color:'#86d9f5',roughness:.14,transparent:true,opacity:.73,depthWrite:false,
  emissive:'#80c9e4',emissiveIntensity:.25,
 });
 const glints=new THREE.MeshStandardMaterial({
  color:'#e7fcff',roughness:.18,emissive:'#86dbf7',emissiveIntensity:.3,
 });
 const wake=new THREE.MeshBasicMaterial({color:'#cdedfa',transparent:true,opacity:.57,depthWrite:false,side:THREE.DoubleSide});
 const batch=(name:string,geometry:THREE.BufferGeometry,material:THREE.Material,count:number,order:number)=>{
  const mesh=new THREE.InstancedMesh(geometry,material,count);
  mesh.name=name;
  mesh.count=0;
  mesh.frustumCulled=false;
  mesh.renderOrder=order;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(mesh);
  return mesh;
 };
 const jets=batch('Fountain water arches',new THREE.TubeGeometry(stream,22,.068,6,false),water,(arcs+1)*capacity,2);
 const drops=batch('Fountain droplets',new THREE.SphereGeometry(1,8,6),glints,arcs*dropsPerArc*capacity,3);
 const ripples=batch('Fountain surface ripples',new THREE.RingGeometry(.89,1,20).rotateX(-Math.PI/2),wake,2*capacity,3);
 const meshes=[jets,drops,ripples],transform=new THREE.Object3D();
 const stamp=(mesh:THREE.InstancedMesh,x:number,y:number,z:number,sx:number,sy:number,sz:number,angle=0)=>{
  transform.position.set(x,y,z);
  transform.scale.set(sx,sy,sz);
  transform.rotation.set(0,angle,0);
  transform.updateMatrix();
  mesh.setMatrixAt(mesh.count++,transform.matrix);
 };
 let lastSites:readonly ParkFountain[]|undefined,lastTime=0,lastReduced=false;
 return {root,update(sites:readonly ParkFountain[],time:number,reduced:boolean){
  if(lastSites===sites&&lastReduced===reduced&&(reduced||lastTime===time))return;
  lastSites=sites;lastReduced=reduced;lastTime=time;
  for(const mesh of meshes)mesh.count=0;
  for(const {point:[x,z],reach,lift,base} of sites.slice(0,capacity)){
   const size=.08+.023*reach;
   stamp(jets,x,base+.02,z,.1,lift*1.28,1.55,.7);
   for(let i=0;i<arcs;i++){
    const angle=i*Math.PI*2/arcs+.1,cos=Math.cos(angle),sin=Math.sin(angle);
    stamp(jets,x,base,z,reach,lift,1,angle);
    for(let j=0;j<dropsPerArc;j++){
     const u=(.05+j/dropsPerArc+i*.075+(reduced?0:time*1.22))%1;
     const radius=(.12+.88*u)*reach;
     const bead=size*(.77+.12*Math.sin(i*2+j*2.4));
     stamp(drops,x+cos*radius,base+profile(u)*lift+.04,z-sin*radius,bead*.88,bead*1.65,bead*.88);
    }
   }
   for(let i=0;i<2;i++){
    const u=reduced?.35+i*.36:(time*.84+i*.5)%1;
    const ripple=reach*(.21+u*.90);
    stamp(ripples,x,base+.022+i*.007,z,ripple,1,ripple);
   }
  }
  for(const mesh of meshes)mesh.instanceMatrix.needsUpdate=true;
 },dispose(){
  root.removeFromParent();
  for(const mesh of meshes){mesh.geometry.dispose();mesh.dispose();}
  water.dispose();glints.dispose();wake.dispose();
 }};
}

export function makeTrash(){
 const root=new THREE.Group();
 const dark=material('#334155'),body=material('#698891'),lid=material('#e38d5b');
 const paper=material('#ffdc9a'),bag=material('#73576d');
 box(root,dark,[0,.25,0],[2.02,.5,1.67]);
 box(root,body,[0,1.25,0],[2.12,2.25,1.78]);
 box(root,dark,[0,2.28,0],[2.26,.3,1.94]);
 for(const x of [-.72,0,.72])box(root,dark,[x,1.25,.905],[.1,1.63,.1]);
 for(const x of [-.95,.95]){
  const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,.18,10),dark);
  wheel.rotation.z=Math.PI/2;wheel.position.set(x,.31,-.57);root.add(wheel);
 }
 const cap=box(root,lid,[0,2.81,-.22],[2.34,.27,2]);
 cap.rotation.x=.35;
 box(cap,dark,[0,.17,.45],[.52,.15,.15]);
 for(const [index,x] of [-.61,.55].entries()){
  const parcel=new THREE.Mesh(new THREE.DodecahedronGeometry(.51,0),bag);
  parcel.position.set(x,2.51,.25);parcel.scale.set(1,.71,.79);
  parcel.rotation.y=index;root.add(parcel);
 }
 const carton=box(root,paper,[.11,2.61,.55],[.53,.58,.39]);
 carton.rotation.z=.38;

 const marks:number[]=[];
 for(let i=0;i<6;i++){
  const a=i*Math.PI/3;
  for(const [angle,radius] of [[a,4.18],[a,4.38],[a+.31,4.38],[a,4.18],[a+.31,4.38],[a+.31,4.18]]){
   marks.push(radius*Math.cos(angle),.037,radius*Math.sin(angle));
  }
 }
 const footprint=new THREE.BufferGeometry();
 footprint.setAttribute('position',new THREE.Float32BufferAttribute(marks,3));
 root.add(new THREE.Mesh(footprint,new THREE.MeshBasicMaterial({
  color:'#e5b367',transparent:true,opacity:.73,depthWrite:false,side:THREE.DoubleSide,
 })));

 const odor=material('#f3d184',{roughness:.7,emissive:'#aa7944',emissiveIntensity:.28});
 const curl=new THREE.CatmullRomCurve3([
  new THREE.Vector3(-.3,0,0),new THREE.Vector3(.16,.42,.07),
  new THREE.Vector3(-.18,.83,.15),new THREE.Vector3(.3,1.26,.02),
 ]);
 const curlGeometry=new THREE.TubeGeometry(curl,12,.115,5,false);
 const wisps=Array.from({length:3},(_,i)=>{
  const wisp=new THREE.Mesh(curlGeometry,odor);
  wisp.rotation.y=i*Math.PI*2/3;
  root.add(wisp);
  return wisp;
 });
 const flyGeometry=new THREE.SphereGeometry(.13,6,4);
 const flies=Array.from({length:3},()=>{
  const fly=new THREE.Mesh(flyGeometry,dark);
  fly.scale.set(.85,1.3,1);
  root.add(fly);
  return fly;
 });

 return {root,update(time:number,reduced:boolean){
  for(const [i,wisp] of wisps.entries()){
   const angle=i*Math.PI*2/3;
   const sway=reduced?0:Math.sin(time*2+i)*.18;
   wisp.position.set(Math.cos(angle)*(1.08+sway),3.04+i*.14+sway,Math.sin(angle)*(1.08+sway));
   wisp.scale.setScalar(.76+i*.11);
  }
  for(const [i,fly] of flies.entries()){
   const angle=i*Math.PI*2/3+(reduced?0:time*1.8);
   const radius=2.5+i*.37;
   fly.position.set(Math.cos(angle)*radius,1.75+i*.43+(reduced?0:Math.sin(time*5+i)*.32),Math.sin(angle)*radius);
  }
 }};
}

const up=new THREE.Vector3(0,1,0);

function rod(parent:THREE.Object3D,mat:THREE.Material,from:number[],to:number[],radius:number){
 const delta=new THREE.Vector3(to[0]-from[0],to[1]-from[1],to[2]-from[2]);
 const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,delta.length(),8),mat);
 mesh.position.set((from[0]+to[0])/2,(from[1]+to[1])/2,(from[2]+to[2])/2);
 mesh.quaternion.setFromUnitVectors(up,delta.normalize());
 parent.add(mesh);
}

function makeWheel(parent:THREE.Group,z:number,radius:number,tyre:THREE.Material,rim:THREE.Material,spoked:boolean){
 const pivot=new THREE.Group(),wheel=new THREE.Group();
 pivot.position.set(0,radius+.04,z);
 pivot.rotation.y=Math.PI/2;
 pivot.add(wheel);
 parent.add(pivot);
 const tread=new THREE.Mesh(new THREE.TorusGeometry(radius*.9,radius*.1,6,20),tyre);
 wheel.add(tread);
 const disc=new THREE.Mesh(new THREE.TorusGeometry(radius*.74,radius*.065,5,20),rim);
 wheel.add(disc);
 if(spoked){
  for(let i=0;i<3;i++){
   const spoke=box(wheel,rim,[0,0,0],[.06,radius*1.45,.055]);
   spoke.rotation.z=i*Math.PI/3;
  }
 }else box(wheel,rim,[0,radius*.53,.06],[.12,.095,.04]);
 const hub=new THREE.Mesh(new THREE.CylinderGeometry(radius*.19,radius*.19,radius*.31,10),rim);
 hub.rotation.x=Math.PI/2;
 wheel.add(hub);
 return wheel;
}

function riderHead(parent:THREE.Group,skin:THREE.Material,helmet:THREE.Material,y:number,z:number){
 sphere(parent,skin,0,y,z,.37,.4,.39);
 const cap=new THREE.Mesh(new THREE.SphereGeometry(.45,12,8,0,Math.PI*2,0,Math.PI*.55),helmet);
 cap.scale.set(1,.88,1.12);
 cap.position.set(0,y+.10,z-.04);
 parent.add(cap);
 box(parent,helmet,[0,y+.10,z+.34],[.59,.11,.28]);
}

export function makeBike(){
 const root=new THREE.Group();
 const frame=material('#a174e5'),dark=material('#303147'),metal=material('#ffe9cf');
 const jersey=material('#ffc752'),skin=material('#b97956'),helmet=material('#e97265');
 const radius=.86,rear=-1.48,front=1.44;
 const wheels=[makeWheel(root,rear,radius,dark,metal,true),makeWheel(root,front,radius,dark,metal,true)];
 const crank=[0,1.01,-.14],saddle=[0,2.04,-.53],head=[0,1.82,1.12],back=[0,.90,rear];
 for(const [from,to] of [[saddle,crank],[crank,head],[head,saddle],[back,crank],[back,saddle],[head,[0,.90,front]]])rod(root,frame,from,to,.11);
 rod(root,metal,head,[0,2.43,1.20],.095);
 rod(root,metal,[-.54,2.43,1.21],[.54,2.43,1.21],.075);
 box(root,dark,[0,2.25,-.59],[.57,.16,.63]);
 const jerseyBody=box(root,jersey,[0,2.84,-.32],[.70,1.02,.63]);
 jerseyBody.rotation.x=.53;
 riderHead(root,skin,helmet,3.51,.05);
 for(const side of [-1,1]){
  const hip=[side*.25,2.42,-.6],knee=[side*.33,1.79,.10],foot=[side*.34,1.15,-.14];
  rod(root,dark,hip,knee,.17);
  rod(root,dark,knee,foot,.13);
  box(root,metal,[side*.35,1.1,-.04],[.25,.16,.35]);
  rod(root,jersey,[side*.32,3.11,-.08],[side*.43,2.73,.67],.11);
  rod(root,skin,[side*.43,2.73,.67],[side*.48,2.44,1.21],.087);
 }
 return {root,update(t:number,speed:number,reduced:boolean){
  const spin=reduced?0:t*speed/radius;
  for(const wheel of wheels)wheel.rotation.z=spin;
 }};
}

export function makeScooter(){
 const root=new THREE.Group();
 const trim=material('#4cd8bb'),dark=material('#34394d'),cream=material('#f4e9cf');
 const jacket=material('#59bfdb'),skin=material('#e2ab80'),helmet=material('#ff8066');
 const radius=.42;
 const wheels=[makeWheel(root,-1.18,radius,dark,cream,false),makeWheel(root,1.25,radius,dark,cream,false)];
 box(root,trim,[0,.54,-.05],[.72,.19,2.17]);
 box(root,dark,[0,.67,-.14],[.59,.10,1.63]);
 rod(root,trim,[0,.48,1.25],[0,2.66,.89],.12);
 rod(root,dark,[-.55,2.68,.89],[.55,2.68,.89],.075);
 box(root,cream,[0,2.55,1.04],[.38,.24,.16]);
 box(root,helmet,[0,.57,-1.17],[.37,.15,.10]);
 const torso=box(root,jacket,[0,2.64,-.23],[.71,1.02,.55]);
 torso.rotation.x=.16;
 riderHead(root,skin,helmet,3.48,-.12);
 for(const side of [-1,1]){
  const toe=side<0?.16:-.53;
  rod(root,dark,[side*.22,2.16,-.30],[side*.23,1.45,toe-.10],.16);
  rod(root,dark,[side*.23,1.45,toe-.10],[side*.21,.77,toe],.13);
  box(root,cream,[side*.21,.76,toe+.06],[.25,.18,.44]);
  rod(root,jacket,[side*.33,2.84,-.14],[side*.43,2.60,.35],.11);
  rod(root,skin,[side*.43,2.60,.35],[side*.47,2.68,.89],.084);
 }
 return {root,update(t:number,speed:number,reduced:boolean){
  const spin=reduced?0:t*speed/radius;
  for(const wheel of wheels)wheel.rotation.z=spin;
 }};
}

export function makePedestrian(variant:number){
 const root=new THREE.Group();
 const outer=material(['#f17179','#f4a254','#8a87dc','#61a9bf'][variant%4]);
 const trousers=material('#425477'),shoe=material('#40384d'),bagColor=material('#f3d18a');
 const skin=material(['#c68562','#a66d52','#f6bf91'][variant%3]),hair=material('#51374d');
 const body=new THREE.Group(),head=new THREE.Group();
 root.add(body);
 box(body,outer,[0,2.13,0],[.98,1.04,.64]);
 sphere(body,skin,0,2.73,.02,.23,.24,.22);
 head.position.set(0,3.03,.04);
 body.add(head);
 sphere(head,skin,0,0,0,.44,.46,.43);
 sphere(head,hair,0,.19,-.13,.45,.33,.39);
 for(const side of [-1,1])sphere(head,shoe,side*.14,.03,.385,.06,.06,.035);

 const arms:THREE.Group[]=[],legs:THREE.Group[]=[];
 for(const side of [-1,1]){
  const arm=new THREE.Group(),leg=new THREE.Group();
  arm.position.set(side*.56,2.51,0);
  leg.position.set(side*.24,1.69,0);
  box(arm,outer,[0,-.32,0],[.28,.68,.34]);
  sphere(arm,skin,0,-.79,.035,.13,.17,.13);
  box(leg,trousers,[0,-.65,0],[.33,1.39,.40]);
  box(leg,shoe,[0,-1.52,.14],[.35,.32,.54]);
  body.add(arm,leg);
  arms.push(arm);
  legs.push(leg);
 }
 const bag=box(body,bagColor,[.42,1.92,-.36],[.53,.60,.23]);
 bag.rotation.z=.16;
 rod(body,bagColor,[-.40,2.57,.34],[.41,1.81,.34],.05);

 return {root,update(time:number,active:boolean,anticipating:boolean,reduced:boolean){
  const step=time*10;
  const stride=active&&!reduced?Math.sin(step)*.47:0;
  body.position.y=active&&!reduced?Math.abs(Math.sin(step))*.11:0;
  head.rotation.y=anticipating?(reduced?.4:Math.sin(time*5)*.66):0;
  for(const [index,leg] of legs.entries()){
   const side=index===0?-1:1;
   leg.rotation.x=side*stride;
   arms[index].rotation.x=-side*stride*.81;
   arms[index].rotation.z=side*.11;
  }
 }};
}
