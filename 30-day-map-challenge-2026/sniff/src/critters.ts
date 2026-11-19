import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {jumpPose} from './game.mjs';
import {makeDog, sniffInhale} from './objects';

export const CRITTERS = {
  dog: {label:'Pup', emoji:'🐶'},
  rex: {label:'T. rex', emoji:'🦖'},
  fox: {label:'Fox', emoji:'🦊'},
  capybara: {label:'Capybara', emoji:'🦫'},
} as const;

export type CritterKind = keyof typeof CRITTERS;
type Leg = {joint:THREE.Group; side:number; front:boolean};
type FurSection = [depth:number, height:number, halfWidth:number, halfHeight:number, color:string];

/** An oval cross section swept down the body, with soft changes in coat colour. */
function furForm(sections:FurSection[]) {
  const positions:number[]=[],colors:number[]=[],indices:number[]=[];
  const sides=24;
  for(const [depth,height,halfWidth,halfHeight,color] of sections) {
    const tint=new THREE.Color(color);
    for(let side=0;side<sides;side++) {
      const angle=side/sides*Math.PI*2;
      positions.push(Math.cos(angle)*halfWidth,height+Math.sin(angle)*halfHeight,depth);
      colors.push(tint.r,tint.g,tint.b);
    }
  }
  for(let ring=0;ring<sections.length-1;ring++) {
    for(let side=0;side<sides;side++) {
      const a=ring*sides+side,b=ring*sides+(side+1)%sides;
      const c=a+sides,d=b+sides;
      indices.push(a,b,c,b,d,c);
    }
  }
  for(let side=1;side<sides-1;side++) {
    const last=(sections.length-1)*sides;
    indices.push(0,side+1,side,last,last+side,last+side+1);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.81}));
}

function foxEar(material:THREE.Material) {
  const shape=new THREE.Shape();
  shape.moveTo(-.27,0);
  shape.bezierCurveTo(-.31,.23,-.23,.54,.01,.88);
  shape.bezierCurveTo(.10,.93,.15,.89,.18,.78);
  shape.bezierCurveTo(.29,.53,.38,.2,.30,.02);
  shape.quadraticCurveTo(.02,-.14,-.27,0);
  return new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{
    depth:.10,bevelEnabled:true,bevelSize:.055,bevelThickness:.05,bevelSegments:3,curveSegments:12,
  }),material);
}

/** All avatars have the same footprint and motion state, with species-specific rigs. */
export function makeCritter(kind:CritterKind):ReturnType<typeof makeDog> {
  if(kind==='dog')return makeDog();

  const root=new THREE.Group(),body=new THREE.Group(),head=new THREE.Group(),tail=new THREE.Group();
  root.add(body);
  body.add(head,tail);

  const rex=kind==='rex',fox=kind==='fox';
  const palette=rex
    ? ['#66c392','#a5dca2','#31807b','#fcdf9a','#eea27b']
    : fox
    ? ['#ef8d43','#fff0d4','#553244','#b84330','#e69a94']
    : ['#ad7652','#ce9869','#614235','#f6c79d','#cb886e'];
  const [skin,belly,mark,accent,blush]=palette.map(color=>new THREE.MeshStandardMaterial({color,roughness:.75}));
  const ink=new THREE.MeshStandardMaterial({color:'#29222c',roughness:.65});
  const shine=new THREE.MeshBasicMaterial({color:'#fff9ea'});
  const sphere=new THREE.SphereGeometry(1,18,12);

  function oval(parent:THREE.Object3D,material:THREE.Material,position:number[],size:number[]) {
    const mesh=new THREE.Mesh(sphere,material);
    mesh.position.fromArray(position);
    mesh.scale.fromArray(size);
    parent.add(mesh);
    return mesh;
  }
  function box(parent:THREE.Object3D,material:THREE.Material,position:number[],size:[number,number,number],radius:number) {
    const mesh=new THREE.Mesh(new RoundedBoxGeometry(...size,3,radius),material);
    mesh.position.fromArray(position);
    parent.add(mesh);
    return mesh;
  }

  const muzzle=new THREE.Object3D();
  head.add(muzzle);
  const eyes:THREE.Mesh[]=[],ears:THREE.Object3D[]=[],arms:THREE.Object3D[]=[],legs:Leg[]=[];
  const headHeight=rex?2.26:fox?1.57:1.47;
  const headForward=rex?.66:fox?.84:.82;
  const toes=rex?3:2;
  const eyeY=rex?.37:fox?.23:.27;
  const eyeX=rex?.66:fox?.39:.51;
  const eyeZ=rex?.28:fox?.37:.32;
  head.position.set(0,headHeight,headForward);

  if(rex) {
    oval(body,skin,[0,1.31,-.23],[.79,.84,1.03]);
    oval(body,belly,[0,1.31,.36],[.62,.67,.56]);
    oval(body,skin,[0,1.98,.38],[.62,.73,.63]);
    oval(tail,skin,[0,.12,-.52],[.37,.43,.8]).rotation.x=.25;
    oval(tail,skin,[0,.29,-1.14],[.24,.28,.61]).rotation.x=.42;
    oval(tail,mark,[0,.58,-1.57],[.12,.18,.32]).rotation.x=.52;
    tail.position.set(0,1.3,-.91);

    box(head,skin,[0,.13,.08],[1.53,1.25,1.69],.53);
    box(head,belly,[0,-.36,.49],[1.18,.44,1.22],.21);
    box(head,skin,[0,-.06,.64],[1.29,.56,1.13],.27);
    oval(head,mark,[0,.62,-.22],[.37,.17,.54]);
    muzzle.position.set(0,-.03,1.22);
    for(const side of [-1,1]){
      oval(head,mark,[side*.34,.12,1.14],[.085,.051,.032]);
      for(const z of [.48,.76,.93]){
        const tooth=new THREE.Mesh(new THREE.ConeGeometry(.062,.16,10),shine);
        tooth.rotation.z=Math.PI;
        tooth.position.set(side*.46,-.27,z);
        head.add(tooth);
      }
      const arm=new THREE.Group();
      arm.position.set(side*.54,1.58,.44);
      oval(arm,skin,[side*.13,-.07,.17],[.2,.18,.36]).rotation.x=.28;
      for(const x of [-.067,.067])oval(arm,accent,[side*.13+x,-.12,.44],[.048,.062,.12]);
      body.add(arm);
      arms.push(arm);
    }
    for(const [x,y,z] of [[0,2.08,-.7],[.51,1.86,-.7],[-.5,1.87,-.72],[.67,1.53,-.6],[-.67,1.53,-.6]]){
      oval(body,mark,[x,y,z],[.16,.105,.18]);
    }
  }else {
    const nose=new THREE.MeshStandardMaterial({color:fox?'#41303b':'#49332e',roughness:.3});
    const coatShade=new THREE.MeshStandardMaterial({color:fox?'#dd6b39':'#996244',roughness:.9});

    if(fox){
      oval(body,skin,[0,.98,-.19],[.60,.59,1.15]);
      oval(body,belly,[0,1.01,.67],[.44,.52,.52]).rotation.x=-.29;
      oval(body,belly,[0,.64,.12],[.41,.31,.79]);
      for(const side of [-1,1]){
        oval(body,coatShade,[side*.40,.98,-.65],[.24,.40,.55]).rotation.y=side*.12;
      }

      // A narrow bridge and long muzzle give the fox a distinct profile.
      head.add(furForm([
        [-.67,.02,.012,.014,'#bd4e38'],[-.57,.04,.32,.31,'#d96839'],
        [-.38,.08,.51,.45,'#ea8241'],[-.10,.08,.61,.50,'#f09045'],
        [.16,.04,.57,.45,'#f29d52'],[.40,-.045,.44,.32,'#fda966'],
        [.65,-.12,.285,.22,'#ffbe7c'],[.88,-.14,.135,.12,'#f6cb9b'],
        [.99,-.125,.012,.02,'#f8d3ab'],
      ]));
      for(const side of [-1,1]){
        const cheek=oval(head,belly,[side*.29,-.15,.33],[.295,.235,.55]);
        cheek.rotation.set(.10,side*-.31,side*.15);
        oval(head,belly,[side*.47,-.14,.12],[.218,.155,.31]).rotation.y=side*.40;
        oval(head,accent,[side*.34,.35,.30],[.151,.033,.077]).rotation.z=side*.14;
        for(let dot=0;dot<3;dot++){
          oval(head,mark,[side*(.205-dot*.022),-.17+dot*.028,.76+dot*.012],[.018,.017,.016]);
        }
      }
      oval(head,belly,[0,-.21,.64],[.28,.15,.37]);
      oval(head,nose,[0,-.10,.95],[.149,.104,.091]);
      oval(head,shine,[-.055,-.046,1.014],[.031,.014,.011]);
      muzzle.position.set(0,-.085,1.045);

      // The continuous curve keeps the cream brush recognizable from above.
      tail.position.set(0,1.05,-.90);
      tail.scale.z=.84;
      tail.add(furForm([
        [-2.18,.68,.006,.008,'#fff8e1'],[-2.11,.66,.12,.14,'#fff5d7'],
        [-1.96,.61,.255,.23,'#fff0d0'],[-1.73,.52,.355,.325,'#ffeaca'],
        [-1.48,.39,.43,.365,'#ffefd4'],[-1.37,.34,.444,.375,'#f4be91'],
        [-1.28,.30,.444,.375,'#e69461'],[-1.09,.21,.404,.345,'#db713d'],
        [-.83,.10,.36,.308,'#ee8840'],[-.56,.04,.30,.265,'#f3974b'],
        [-.31,0,.22,.20,'#ed8d46'],[0,0,.145,.14,'#ee8c43'],
      ]));
    }else{
      oval(body,skin,[0,.89,-.22],[.81,.69,1.29]);
      oval(body,coatShade,[0,.73,-.74],[.71,.48,.81]);
      oval(body,belly,[0,.72,.59],[.62,.44,.61]);
      oval(body,skin,[0,1.11,.66],[.62,.59,.61]);

      // Capybaras have a tall, blunt muzzle and tiny rounded ears.
      box(head,skin,[0,.055,.06],[1.29,1.03,1.34],.45);
      box(head,coatShade,[0,-.075,.62],[1.09,.79,.91],.34);
      box(head,belly,[0,-.235,.72],[1.08,.53,.72],.24);
      box(head,nose,[0,.07,1.03],[.63,.31,.22],.11);
      oval(head,shine,[-.10,.17,1.113],[.12,.021,.018]);
      muzzle.position.set(0,.035,1.17);
      for(const side of [-1,1]){
        oval(head,ink,[side*.155,.057,1.135],[.061,.035,.023]).rotation.z=side*.18;
        oval(head,belly,[side*.43,-.186,.54],[.203,.218,.34]).rotation.y=side*.17;
        oval(head,mark,[side*.126,-.235,1.051],[.139,.02,.023]).rotation.z=side*.142;
        oval(head,coatShade,[side*.474,-.12,.74],[.043,.026,.043]);
        oval(head,coatShade,[side*.441,-.10,.86],[.032,.025,.031]);
      }
    }

    for(const side of [-1,1]){
      const ear=new THREE.Group();
      ear.position.set(side*(fox?.36:.47),fox?.33:.442,fox?-.23:-.26);
      ear.rotation.z=-side*.16;
      if(fox){
        ear.rotation.y=side*.16;
        const outer=foxEar(skin);
        ear.add(outer);
        const trim=foxEar(belly);
        trim.scale.set(.77,.81,.42);
        trim.position.set(0,.05,.093);
        ear.add(trim);
        const inner=foxEar(blush);
        inner.scale.set(.54,.64,.32);
        inner.position.set(.005,.072,.13);
        ear.add(inner);
      }else{
        ear.rotation.y=side*.25;
        oval(ear,skin,[0,.11,0],[.164,.168,.09]);
        oval(ear,mark,[0,.11,.055],[.125,.125,.06]);
        oval(ear,blush,[0,.10,.095],[.073,.075,.045]);
      }
      head.add(ear);
      ears.push(ear);
    }
  }

  for(const side of [-1,1]){
    const gaze=new THREE.Group();
    gaze.position.set(side*eyeX,eyeY,eyeZ);
    gaze.rotation.y=side*(rex?1.2:fox?.59:.91);
    head.add(gaze);
    if(rex)oval(gaze,belly,[0,0,.008],[.173,.193,.076]);
    if(fox)oval(gaze,belly,[0,-.01,.029],[.121,.143,.05]);
    if(!rex)gaze.scale.setScalar(fox?1.05:.97);
    eyes.push(oval(gaze,ink,[0,0,.052],[.104,.119,.055]));
    oval(gaze,shine,[-.028,.042,.101],[.028,.037,.020]);
    oval(head,blush,[side*eyeX,eyeY-.24,eyeZ+.16],[.065,.076,.091]);
  }

  for(const side of [-1,1]){
    for(const front of rex?[false]:[true,false]){
      const paw=new THREE.Group();
      const hip=rex?1.16:fox?.8:.62;
      paw.position.set(side*(rex?.56:fox?.39:.48),hip,rex?-.36:front?.59:-.69);
      oval(paw,skin,[0,-hip*.35,0],[rex?.31:.21,hip*.56,rex?.43:.23]);
      oval(paw,rex?skin:mark,[0,-hip+.13,.13],[rex?.27:fox?.194:.232,.15,rex?.41:fox?.241:.252]);
      if(rex)for(let toe=0;toe<toes;toe++){
        oval(paw,accent,[(toe-1)*.115,-hip+.12,.42],[.072,.07,.12]);
      }
      if(!rex)for(let toe=-1;toe<=1;toe++){
        oval(paw,mark,[toe*.095,-hip+.094,.285],[.066,.080,.105]);
      }
      body.add(paw);
      legs.push({joint:paw,side,front});
    }
  }

  const shade=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,
    uniforms:{strength:{value:.30}},
    vertexShader:`varying vec2 footprint;
     void main(){footprint=uv*2.0-1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec2 footprint; uniform float strength;
     void main(){float fade=1.0-smoothstep(.18,1.0,length(footprint));
      gl_FragColor=vec4(.12,.17,.20,strength*fade);}`,
  });
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(1,32),shade);
  shadow.rotation.x=-Math.PI/2;
  root.add(shadow);
  const scale=rex?2.08:2.35;
  root.scale.setScalar(scale);
  const sniffDrop=rex?.52:fox?.30:.17;
  const sniffDip=rex?.30:fox?.21:.12;

  let gaitPhase=0,sit=0,sniff=0;
  return {root,muzzle,animate(t,dt,moving,running,sitting,sniffing,reduced,hurt=0,stun=0,jumpTime=0,sniffTime=0,sprinting=false) {
    const easing=reduced?1:1-Math.exp(-dt*12);
    sit+=(Number(sitting)-sit)*easing;
    sniff+=(Number(sniffing)-sniff)*easing;
    gaitPhase+=dt*(sprinting?24:running?17:10);
    const stride=moving&&!reduced?Math.sin(gaitPhase):0;
    const jump=jumpPose(jumpTime),air=jump.height>.1;
    const inhale=(reduced?.36:sniffInhale(sniffTime))*sniff;
    const lostBalance=Math.min(1,stun*4,Math.max(0,1-stun)*6);
    const bounce=Math.abs(stride)*(sprinting?.19:.13)*(1-sniff*.48);
    const squash=reduced?0:jump.anticipate*.16+jump.landing*.17;
    const pitch=stride*.075*(1-sniff*.65)+(rex?.12:0)*Number(moving);
    body.rotation.set(-sit*(rex?.3:.55)+pitch+sniff*.045+inhale*.04,0,lostBalance*1.24);
    body.position.y=bounce-sit*(rex?.36:.15)-squash*.5-lostBalance*.33-inhale*.06+(reduced?0:Math.sin(t*2)*.021);
    body.scale.set(1+squash*.18,1-squash,1+squash*.3);
    head.position.y=headHeight-sniff*sniffDrop-inhale*sniffDip;
    head.position.z=headForward+sniff*.16+inhale*.28;
    const glance=reduced?0:Math.sin(t*1.17)*.3*sit;
    const sweep=reduced?0:Math.sin(sniffTime*5)*sniff*.10*(1-inhale*.85);
    head.rotation.set(sniff*(rex?.40:.42)+inhale*.31-sit*.11,glance+sweep,-glance*.16+lostBalance*.15+Math.sin(t*22)*hurt*.14);
    const wag=reduced?0:Math.sin(t*(rex?7:fox?10:5))*(rex?.28:.36);
    tail.rotation.y=wag*(moving?1.3:1)*(1+sniff*.26);
    tail.rotation.x=sit*.29+sniff*.12+(air?.14*jump.tuck:0);
    for(const {joint,side,front} of legs){
      const offset=side===1?Math.PI:0;
      const swing=moving&&!reduced?Math.sin(gaitPhase+offset+(front?Math.PI:0)):0;
      joint.rotation.x=air?(front?-.67:.66)*jump.tuck:swing*(rex?.84:.93)*(1-sit)+sit*(front?.46:-.64)+(front&&!moving?inhale*.16:0);
    }
    arms.forEach((arm,i)=>{arm.rotation.x=-.12+(i?-1:1)*stride*.44+(air?.58*jump.tuck:0);});
    ears.forEach((ear,i)=>{ear.rotation.z=(i===0?1:-1)*(.16+inhale*.20+(air?.24*jump.tuck:0));});
    const blink=reduced?0:Math.max(0,1-Math.abs((t%4.3)-3.95)/.095);
    for(const eye of eyes)eye.scale.y=.119*(1-Math.max(blink*.94,inhale*.29));
    shadow.position.y=.06-jump.height/scale;
    const spread=1+jump.height*.02;
    shadow.scale.set((rex?1.18:1.08)*spread,1.75*spread,1);
    shade.uniforms.strength.value=.30-jump.tuck*.12;
  }};
}
