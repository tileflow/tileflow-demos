import * as THREE from 'three';
import {jumpPose} from './game.mjs';

const soft=(color:string,extra:THREE.MeshStandardMaterialParameters={})=>new THREE.MeshStandardMaterial({color,roughness:.55,...extra});
function ball(parent:THREE.Object3D,mat:THREE.Material,p:number[],s:number[]){const m=new THREE.Mesh(new THREE.SphereGeometry(1,20,14),mat);m.position.set(p[0],p[1],p[2]);m.scale.set(s[0],s[1],s[2]);parent.add(m);return m;}
function tube(parent:THREE.Object3D,mat:THREE.Material,points:THREE.Vector3[],radius:number){const m=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),24,radius,8,false),mat);parent.add(m);return m;}

export function makeHeart(color='#e9898d'){
 const shape=new THREE.Shape();shape.moveTo(0,-.8);shape.bezierCurveTo(-1.6,.1,-1.1,1.35,0,.6);shape.bezierCurveTo(1.1,1.35,1.6,.1,0,-.8);
 const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.24,bevelEnabled:true,bevelSize:.13,bevelThickness:.13,bevelSegments:3,steps:1,curveSegments:16}),soft(color,{roughness:.35}));mesh.geometry.translate(0,0,-.12);return mesh;
}

function disk(parent:THREE.Object3D,radius:number,height:number,y:number,mat:THREE.Material){
 const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,height,28),mat);
 mesh.position.y=y;
 parent.add(mesh);
 return mesh;
}

function makeCroissant(group:THREE.Group){
 const lengthSegments=84,ringSegments=18;
 const positions:number[]=[],colors:number[]=[],indices:number[]=[];
 const caramel=new THREE.Color('#ad5b28'),glaze=new THREE.Color('#e49a41');
 const butter=new THREE.Color('#f6c078'),crease=new THREE.Color('#a85225'),tint=new THREE.Color();

 for(let i=0;i<=lengthSegments;i++){
  const t=2*i/lengthSegments-1;
  const angle=t*1.85;
  const centerX=1.46*Math.sin(angle),centerZ=.16-1.08*Math.cos(angle);
  const tangentX=1.46*Math.cos(angle),tangentZ=1.08*Math.sin(angle);
  const length=Math.hypot(tangentX,tangentZ);
  const outwardX=tangentZ/length,outwardZ=-tangentX/length;
  const tip=Math.abs(t);
  const baseRadius=.64*Math.pow(1-Math.pow(tip,1.75),.85);

  for(let j=0;j<ringSegments;j++){
   const around=j/ringSegments*Math.PI*2;
   const radial=Math.cos(around),vertical=Math.sin(around);
   // Curve the folds around the pastry. The raised edge catches the light beside each crease.
   const fold=Math.abs(t+.045*radial*(1-tip));
   const gap=Math.min(Math.abs(fold-.18),Math.abs(fold-.42),Math.abs(fold-.67));
   const groove=Math.max(0,1-gap/.046);
   const lip=Math.max(0,1-Math.min(Math.abs(fold-.22),Math.abs(fold-.46),Math.abs(fold-.71))/.065);
   const radius=baseRadius*(1+.085*lip-.12*groove*groove);
   const y=-.03+.21*tip*tip+radius*vertical*(vertical<0?.7:.94);
   positions.push(centerX+radius*radial*outwardX,y,centerZ+radius*radial*outwardZ);

   tint.copy(caramel).lerp(glaze,.58+.32*vertical);
   tint.lerp(butter,Math.max(0,vertical)*(.23+.26*lip));
   tint.lerp(crease,groove*groove*.58);
   colors.push(tint.r,tint.g,tint.b);
  }
 }

 for(let i=0;i<lengthSegments;i++)for(let j=0;j<ringSegments;j++){
  const a=i*ringSegments+j,b=i*ringSegments+(j+1)%ringSegments;
  const c=a+ringSegments,d=b+ringSegments;
  indices.push(a,b,c,b,d,c);
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 geometry.setIndex(indices);
 geometry.computeVertexNormals();
 const croissant=new THREE.Mesh(geometry,soft('#ffffff',{vertexColors:true,roughness:.49}));
 croissant.rotation.x=.28;
 group.add(croissant);
}

function makePizza(group:THREE.Group){
 const start=Math.PI*.265,end=Math.PI*.735;
 const wedge=(radius:number,depth:number,y:number,mat:THREE.Material)=>{
  const shape=new THREE.Shape().moveTo(0,0);
  shape.absarc(0,0,radius,start,end);
  shape.closePath();
  const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:.055,bevelSize:.055,bevelSegments:2,curveSegments:24}),mat);
  mesh.rotation.x=-Math.PI/2;
  mesh.position.set(0,y,1.05);
  group.add(mesh);
 };
 wedge(2.25,.19,0,soft('#d48640'));
 wedge(2.02,.05,.2,soft('#d94c3f'));
 wedge(1.94,.06,.26,soft('#ffcd6d'));
 const crust=soft('#f4a958');
 const crest=Array.from({length:12},(_,i)=>{
  const a=start+(end-start)*i/11;
  return new THREE.Vector3(2.2*Math.cos(a),.22,1.05-2.2*Math.sin(a));
 });
 tube(group,crust,crest,.17);
 const pepperoni=soft('#c44336');
 for(const [x,z] of [[0,-.15],[-.47,-.68],[.54,-.6],[.1,-.93]]){
  ball(group,pepperoni,[x,.38,z],[.18,.055,.18]);
  ball(group,soft('#f9a067'),[x-.04,.433,z+.06],[.026,.012,.024]);
 }
 const basil=soft('#528b4b');
 for(const [x,z] of [[-.24,-.47],[.23,.06],[.7,-.43]]){
  const leaf=ball(group,basil,[x,.37,z],[.09,.026,.18]);leaf.rotation.y=x*4;
 }
}

function makeRamen(group:THREE.Group){
 const bowl=new THREE.Mesh(new THREE.LatheGeometry([
  [0,-.55],[.62,-.55],[.77,-.45],[1.07,-.2],[1.28,.28],[1.25,.33],[1.17,.29],[1.12,.12],[.77,-.33],[0,-.34],
 ].map(p=>new THREE.Vector2(p[0],p[1])),32),soft('#5f8da2',{roughness:.32}));
 group.add(bowl);
 const rim=new THREE.Mesh(new THREE.TorusGeometry(1.23,.045,8,38),soft('#f8e0b9'));
 rim.rotation.x=-Math.PI/2;
 rim.position.y=.29;
 group.add(rim);
 disk(group,1.15,.09,.11,soft('#a65e32',{roughness:.42}));
 const noodles=soft('#fbd092');
 for(let j=0;j<4;j++){
  const points=Array.from({length:21},(_,i)=>{
   const a=i*.32+j*.7,r=.3+j*.16+Math.sin(i*1.9+j)*.065;
   return new THREE.Vector3(Math.cos(a)*r-.14,.22+Math.sin(i*.7)*.025,Math.sin(a)*r+.08);
  });
  tube(group,noodles,points,.05);
 }
 const egg=soft('#fff0d7'),yolk=soft('#f5a000');
 for(const [x,z] of [[.48,-.38],[.79,-.04]]){
  ball(group,egg,[x,.25,z],[.22,.1,.28]);
  ball(group,yolk,[x,.345,z],[.12,.04,.155]);
 }
 const seaweed=new THREE.Mesh(new THREE.BoxGeometry(.48,.55,.065),soft('#385747'));
 seaweed.position.set(-.31,.37,-.68);
 seaweed.rotation.set(.58,-.32,-.1);
 group.add(seaweed);
 for(const z of [.44,.61])tube(group,soft('#b88865'),[new THREE.Vector3(-1.04,.35,z),new THREE.Vector3(1.6,.53,z-.4)],.043);
}

function makeBurger(group:THREE.Group){
 const bun=soft('#ec9e47'),meat=soft('#754531'),lettuce=soft('#73ab56');
 ball(group,bun,[0,-.5,0],[1.13,.32,1.05]);
 disk(group,1.03,.3,-.26,meat);
 const cheese=soft('#ffd65f');
 const slice=new THREE.Mesh(new THREE.BoxGeometry(1.57,.08,1.57),cheese);
 slice.position.y=-.055;
 slice.rotation.y=Math.PI/4;
 group.add(slice);
 for(let i=0;i<14;i++){
  const a=i*Math.PI/7;
  const leaf=ball(group,lettuce,[Math.cos(a)*.98,.05+Math.sin(i*3)*.04,Math.sin(a)*.91],[.25,.12,.18]);
  leaf.rotation.y=a;
 }
 const tomato=soft('#e15c43');
 for(const x of [-.42,.42]){
  const tomatoSlice=disk(group,.62,.13,.155,tomato);tomatoSlice.position.x=x;
 }
 ball(group,bun,[0,.23,0],[1.16,.58,1.05]);
 const seeds=soft('#fff2cb');
 for(let i=0;i<13;i++){
  const a=i*2.4,r=.18+i*.044;
  const seed=ball(group,seeds,[Math.cos(a)*r,.23+.58*Math.sqrt(1-r*r)+.016,Math.sin(a)*r],[.073,.024,.029]);
  seed.rotation.y=a;
 }
}

function makeIceCream(group:THREE.Group){
 const cone=new THREE.Mesh(new THREE.CylinderGeometry(.56,.065,1.65,20),soft('#daa35e'));
 cone.position.y=-.41;
 group.add(cone);
 const waffle=soft('#bd8354');
 for(const direction of [-1,1])for(let lane=0;lane<5;lane++){
  const points=Array.from({length:9},(_,i)=>{
   const u=i/8,a=lane*Math.PI*2/5+direction*u*2,r=.068+u*.494;
   return new THREE.Vector3(Math.sin(a)*r,-1.235+u*1.65,Math.cos(a)*r);
  });
  tube(group,waffle,points,.021);
 }
 const berry=soft('#f3a3b4');
 ball(group,berry,[0,.6,0],[.69,.59,.66]);
 ball(group,soft('#ffe8bb'),[.12,1.2,-.05],[.53,.5,.53]);
 for(let i=0;i<9;i++){
  const a=i*2.4;
  ball(group,i%2?berry:soft('#a85774'),[Math.cos(a)*.5,.58+Math.sin(i*3)*.3,Math.sin(a)*.54],[.063,.043,.046]);
 }
}

function makePaella(group:THREE.Group){
 const pan=soft('#52436d',{roughness:.36}),edge=soft('#786698',{metalness:.28,roughness:.42});
 const profile=[[0,-.3],[1,-.3],[1.2,-.22],[1.31,-.02],[1.31,.1],[1.23,.1],[1.18,-.01],[.96,-.18],[0,-.18]];
 group.add(new THREE.Mesh(new THREE.LatheGeometry(profile.map(([x,y])=>new THREE.Vector2(x,y)),36),pan));
 const rim=new THREE.Mesh(new THREE.TorusGeometry(1.27,.045,8,36),edge);
 rim.rotation.x=-Math.PI/2;rim.position.y=.09;group.add(rim);
 disk(group,1.17,.15,.045,soft('#f8b941'));
 for(const side of [-1,1]){
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.26,.07,8,18),edge);
  handle.rotation.x=Math.PI/2;handle.scale.set(.8,1.15,1);handle.position.set(side*1.37,.005,0);group.add(handle);
 }
 const grains=new THREE.InstancedMesh(new THREE.SphereGeometry(1,7,5),soft('#ffde75'),56);
 const helper=new THREE.Object3D();
 for(let i=0;i<grains.count;i++){
  const a=i*2.4,r=Math.sqrt((i+.5)/grains.count)*1.11;
  helper.position.set(Math.sin(a)*r,.128,Math.cos(a)*r);
  helper.scale.set(.094,.026,.04);helper.rotation.y=a;helper.updateMatrix();grains.setMatrixAt(i,helper.matrix);
 }
 group.add(grains);
 const peas=soft('#5d9446'),pepper=soft('#e75c42'),shrimp=soft('#f78e72');
 for(let i=0;i<14;i++){
  const a=.75+i*2.4,r=.18+(i%5)*.17;
  const garnish=ball(group,i%3?peas:pepper,[Math.sin(a)*r,.17,Math.cos(a)*r],i%3?[.075,.063,.075]:[.17,.055,.058]);
  garnish.rotation.y=a;
 }
 for(const [x,z,yaw] of [[-.42,.26,1.3],[.43,-.17,-1.1],[.14,.55,-2]]){
  const shell=new THREE.Mesh(new THREE.TorusGeometry(.205,.075,8,18,Math.PI*1.6),shrimp);
  shell.rotation.set(-Math.PI/2,0,yaw);shell.position.set(x,.23,z);group.add(shell);
  const tail=ball(group,pepper,[x+.16*Math.cos(yaw),.2,z-.15*Math.sin(yaw)],[.12,.052,.078]);tail.rotation.y=yaw;
 }
 const lemon=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,.1,18,1,false,0,Math.PI*.54),soft('#fff4b4'));
 lemon.position.set(-.32,.21,-.58);lemon.rotation.y=-.8;group.add(lemon);
 const rind=new THREE.Mesh(new THREE.TorusGeometry(.31,.045,7,12,Math.PI*.54),soft('#f5d24b'));
 rind.rotation.set(-Math.PI/2,0,-.8);rind.position.copy(lemon.position);rind.position.y+=.05;group.add(rind);
}

const prototypes=new Map<string,THREE.Group>();
export function makeAroma(kind:string){
 const existing=prototypes.get(kind);if(existing)return existing.clone(true);
 const g=new THREE.Group(),ivory=soft('#fff6e7',{roughness:.28});
 if(kind==='coffee'){
  const profile=[[0,-.9],[.64,-.9],[.78,-.78],[.91,.50],[.91,.67],[.83,.72],[.79,.61],[.69,-.65],[0,-.65]].map(p=>new THREE.Vector2(...p as [number,number]));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(profile,36),ivory));
  const coffee=new THREE.Mesh(new THREE.CircleGeometry(.78,36),soft('#75452b',{roughness:.3}));coffee.rotation.x=-Math.PI/2;coffee.position.y=.61;g.add(coffee);
  const foam=makeHeart('#f2d5a5');foam.scale.setScalar(.36);foam.rotation.x=-Math.PI/2;foam.position.set(0,.64,0);g.add(foam);
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.47,.14,12,28,Math.PI*1.75),ivory);handle.position.set(.92,-.01,0);handle.rotation.z=-Math.PI*.875;g.add(handle);
  const saucer=new THREE.Mesh(new THREE.CylinderGeometry(1.23,1.14,.13,36),ivory);saucer.position.y=-1.02;g.add(saucer);
  const steam=soft('#fff3dd',{transparent:true,opacity:.55,depthWrite:false});
  for(const x of [-.31,.3])tube(g,steam,[new THREE.Vector3(x,1,0),new THREE.Vector3(x-.16,1.35,0),new THREE.Vector3(x+.14,1.7,0),new THREE.Vector3(x,2,0)],.045);
 }else if(kind==='bread')makeCroissant(g);
 else if(kind==='pizza')makePizza(g);
 else if(kind==='ramen')makeRamen(g);
 else if(kind==='burger')makeBurger(g);
 else if(kind==='iceCream')makeIceCream(g);
 else makePaella(g);
 prototypes.set(kind,g);return g.clone(true);
}

export const SNIFF_CYCLE=1.16;
export const SNIFF_BEATS=[.10,.38] as const;
export const SNIFF_BREATH=.22;

export function sniffInhale(time:number){
 const phase=time%SNIFF_CYCLE;
 for(const [index,beat] of SNIFF_BEATS.entries()){
  const progress=(phase-beat)/SNIFF_BREATH;
  if(progress>0&&progress<1)return Math.sin(progress*Math.PI)**2*(index===0?.86:1);
 }
 return 0;
}

export function makeDog(){
 const root=new THREE.Group(),body=new THREE.Group();root.add(body);
 const fur=soft('#dca261'),cream=soft('#fff1d1'),dark=soft('#4a3027'),nose=soft('#211f22'),pink=soft('#ee8e98');
 ball(body,fur,[0,1.15,0],[.67,.65,1.3]);ball(body,cream,[0,.95,.75],[.57,.52,.5]);
 const head=new THREE.Group();head.position.set(0,1.8,1.1);body.add(head);
 ball(head,fur,[0,0,0],[.74,.68,.65]);ball(head,cream,[0,-.18,.5],[.49,.32,.42]);
 const noseTip=ball(head,nose,[0,-.08,.82],[.24,.17,.16]);
 ball(head,soft('#ffffff',{transparent:true,opacity:.55}),[-.07,-.025,.95],[.055,.025,.015]);
 const muzzle=new THREE.Object3D();muzzle.position.set(0,-.052,1);head.add(muzzle);
 const ears:THREE.Mesh[]=[],eyes:THREE.Mesh[]=[],brows:THREE.Mesh[]=[];
 for(const side of [-1,1]){ball(head,cream,[side*.35,.07,.53],[.2,.23,.1]);eyes.push(ball(head,nose,[side*.35,.1,.61],[.105,.135,.075]));brows.push(ball(head,fur,[side*.36,.32,.49],[.19,.075,.08]));ball(head,soft('#ffffff'),[side*.33,.14,.66],[.028,.035,.02]);const ear=ball(head,dark,[side*.7,-.06,-.13],[.23,.64,.32]);ear.rotation.z=side*.32;ears.push(ear);}
 for(const side of [-1,1]){ball(head,cream,[side*.22,-.23,.62],[.27,.23,.27]);ball(head,pink,[side*.56,-.2,.47],[.1,.065,.03]);for(let j=0;j<3;j++)ball(head,dark,[side*(.16+j*.07),-.23-(j%2)*.08,.87],[.018,.018,.012]);}
 tube(head,dark,[-.25,0,.25].map(x=>new THREE.Vector3(x,-.38-Math.cos(x*6)*.04,.77)),.025);
 const tongue=ball(head,pink,[.12,-.46,.65],[.12,.19,.07]);
 // A narrow, hollow collar behind the jaw; normal depth testing preserves the face.
 const collar=new THREE.Mesh(new THREE.TorusGeometry(.53,.075,10,32),soft('#567957'));collar.position.set(0,1.22,.72);body.add(collar);
 ball(body,soft('#eab84d',{metalness:.35,roughness:.3}),[0,.69,.86],[.12,.15,.05]);
 const legs:{root:THREE.Group;front:boolean;side:number}[]=[];
 for(const x of [-.46,.46])for(const z of [-.75,.7]){const leg=new THREE.Group();leg.position.set(x,.9,z);body.add(leg);ball(leg,fur,[0,-.35,0],[.21,.45,.24]);ball(leg,cream,[0,-.72,.11],[.26,.19,.33]);for(const toe of [-1,0,1])ball(leg,cream,[toe*.105,-.74,.27],[.09,.13,.12]);ball(leg,pink,[0,-.88,.1],[.11,.025,.13]);legs.push({root:leg,front:z>0,side:x});}
 const tail=new THREE.Group();tail.position.set(0,1.35,-1.12);tail.rotation.x=-.5;body.add(tail);ball(tail,fur,[0,.45,-.3],[.2,.65,.22]);ball(tail,cream,[0,.94,-.54],[.19,.25,.19]);
 const shadow=new THREE.Mesh(new THREE.CircleGeometry(1,40),new THREE.MeshBasicMaterial({color:'#503d25',transparent:true,opacity:.16,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.scale.set(.95,1.65,1);shadow.position.y=.06;root.add(shadow);root.scale.setScalar(2.35);
 let sit=0,phase=0,earSpring=0,earVelocity=0,sniffPose=0,tailPhase=0;
 return {root,muzzle,animate(t:number,dt:number,moving:boolean,running:boolean,sitting:boolean,sniffing:boolean,reduced:boolean,hurt=0,stun=0,jumpTime=0,sniffTime=0,sprinting=false){
  sit+=((sitting?1:0)-sit)*(1-Math.exp(-dt*9));phase+=dt*(sprinting?22:running?17:10);
  sniffPose+=((sniffing?1:0)-sniffPose)*(reduced?1:1-Math.exp(-dt*14));
  const inhale=(reduced?.36:sniffInhale(sniffTime))*sniffPose;
  const leap=jumpPose(jumpTime),airborne=leap.height>.1;
  const gait=moving&&!reduced?Math.sin(phase):0;
  const gaitPitch=running&&moving&&!reduced?gait*(sprinting?.15:.1)*(1-sniffPose*.65):0;
  const rise=moving?Math.abs(gait)*(sprinting?.32:running?.22:.09):Math.sin(reduced?0:t*2)*.025;
  body.rotation.x=-sit*.68+gaitPitch+sniffPose*.06+inhale*.075;
  body.position.y=-sit*.08+rise*(1-sniffPose*.48)-inhale*.061;
  body.scale.set(1,1-(running&&moving?gait*.035:0),1+(running&&moving?gait*.045:0));
  const smooth=(u:number)=>{u=Math.max(0,Math.min(1,u));return u*u*(3-2*u);},fall=stun>0?smooth((1-stun)/.12)*smooth(stun/.55):0;body.rotation.z=fall*1.05;body.position.y-=fall*.5;
  legs.forEach(({root:l,front,side},i)=>{
   const stride=running?Math.sin(phase+(front?0:Math.PI*.85)+(side>0?.3:0)):Math.sin(phase+(i===0||i===3?0:Math.PI));
   l.rotation.x=(moving&&!reduced?stride*(running?.95:.6):0)*(1-sit)+(front?.68:-.9)*sit;
   if(airborne)l.rotation.x=front?-.8*leap.tuck:.95*leap.tuck;
   else if(front&&!moving)l.rotation.x+=sniffPose*.13+inhale*.16;
   l.position.y=.9;
  });
  if(!reduced){const squash=leap.anticipate*.21+leap.landing*.18,stretch=airborne?Math.sin(leap.air*Math.PI*2)*.11:0;body.scale.set(1+squash*.4,1-squash+stretch,1+squash*.35-stretch*.3);body.position.y-=squash*.8;body.rotation.x+=airborne?-.23*Math.sin(leap.air*Math.PI*2):0;}
  shadow.position.y=.06-leap.height/2.35;shadow.scale.set(.95*(1-leap.tuck*.23),1.65*(1-leap.tuck*.23),1);(shadow.material as THREE.MeshBasicMaterial).opacity=.16-leap.tuck*.07;
  tailPhase+=dt*(7+sit*10+sniffPose*3+(moving?5:0)+(sprinting?4:0));
  tail.rotation.z=reduced?0:Math.sin(tailPhase)*(.38+sit*.11+sniffPose*.10);
  head.position.y=1.8-sniffPose*.34-inhale*.27;
  head.position.z=1.1+sniffPose*.15+inhale*.32;
  const relaxedHeadTilt=sit*.21+(running&&moving?-.12:Math.sin(reduced?0:t*1.5)*.04);
  head.rotation.x=relaxedHeadTilt*(1-sniffPose)+sniffPose*.47+inhale*.38;
  const glance=reduced?0:(Math.sin(t*1.4)*.38+Math.sin(t*.49)*.18)*sit;
  head.rotation.y=glance+(reduced?0:Math.sin(sniffTime*5)*sniffPose*.105*(1-inhale*.85));
  head.rotation.z=glance*.19+(reduced?0:Math.sin(t*32)*hurt*.28);
  const earTarget=airborne?-.55+leap.air*.9:moving?Math.sin(phase+.4)*.2:Math.sin(t*2)*.025;
  earVelocity+=(earTarget-earSpring)*85*dt;earVelocity*=Math.exp(-dt*12);earSpring+=earVelocity*dt;
  ears.forEach((ear,i)=>{
   const side=i===0?-1:1;
   ear.rotation.z=side*(.32+(reduced?0:earSpring+inhale*.29));
   ear.rotation.x=reduced?0:(airborne?-.6*leap.tuck:Math.sin(phase+i*.3)*.14*(moving?1:0)+inhale*.21);
  });
  noseTip.scale.set(.24+inhale*.064,.17+inhale*.03,.16+inhale*.047);
  const blink=reduced?0:Math.max(0,1-Math.abs((t%4.7)-4.45)/.11);eyes.forEach(eye=>eye.scale.y=.135*(1-Math.max(blink*.92,inhale*.29)));brows.forEach((b,i)=>b.rotation.z=(i?-1:1)*(sniffing?.18:airborne?-.16:0));tongue.scale.y=.19*(sniffing?.25:moving?1.4:1);tongue.rotation.x=reduced?0:Math.sin(t*13)*.12;

 }};
}
