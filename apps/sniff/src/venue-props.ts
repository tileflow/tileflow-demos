import * as THREE from 'three';

type XYZ=[number,number,number];
type Standard=THREE.MeshStandardMaterial;

function material(color:string,roughness=.74){
 return new THREE.MeshStandardMaterial({color,roughness});
}

function box(parent:THREE.Object3D,dimensions:XYZ,position:XYZ,paint:Standard){
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(...dimensions),paint);
 mesh.position.set(...position);
 parent.add(mesh);
 return mesh;
}

function cylinder(parent:THREE.Object3D,top:number,bottom:number,height:number,position:XYZ,paint:Standard){
 const mesh=new THREE.Mesh(new THREE.CylinderGeometry(top,bottom,height,20),paint);
 mesh.position.set(...position);
 parent.add(mesh);
 return mesh;
}

function ring(parent:THREE.Object3D,radius:number,width:number,position:XYZ,paint:Standard,angle=Math.PI*2){
 const mesh=new THREE.Mesh(new THREE.TorusGeometry(radius,width,8,20,angle),paint);
 mesh.position.set(...position);
 parent.add(mesh);
 return mesh;
}

function makeCafeBadge(parent:THREE.Group){
 const ceramic=material('#fff0cd',.45),coffee=material('#9a5e3e');
 cylinder(parent,.32,.21,.47,[0,.04,0],ceramic);
 cylinder(parent,.28,.28,.022,[0,.28,0],coffee);
 cylinder(parent,.41,.36,.06,[0,-.23,0],ceramic);
 ring(parent,.15,.045,[.32,.09,0],ceramic);
}

function makeBakeryBadge(parent:THREE.Group){
 const wheat=material('#f6be6b'),score=material('#ffe4a4');
 const loaf=new THREE.Mesh(new THREE.CapsuleGeometry(.23,.47,6,14),wheat);
 loaf.rotation.z=-.74;
 parent.add(loaf);
 for(const x of [-.17,0,.17]){
  const slash=box(parent,[.09,.17,.036],[x,x*.62,.21],score);
  slash.rotation.z=-.55;
 }
}

function makeKitchenBadge(parent:THREE.Group){
 const glaze=material('#fff2ce',.43),rim=material('#c1d9a6',.53);
 cylinder(parent,.39,.22,.29,[0,-.13,0],glaze);
 cylinder(parent,.37,.37,.04,[0,.02,0],rim);
 for(const x of [-.17,.17]){
  const steam=ring(parent,.12,.024,[x,.26,.05],glaze,Math.PI);
  steam.rotation.z=Math.PI/2;
 }
}

function makeCanopy(parent:THREE.Group,width:number,colors:Standard[]){
 const count=7,segment=width/count;
 for(let i=0;i<count;i++){
  const x=(i+.5)*segment-width/2,paint=colors[i%colors.length];
  const cloth=box(parent,[segment+.014,.10,1.05],[x,3.49,.53],paint);
  cloth.rotation.x=.22;
  box(parent,[segment+.014,.24,.075],[x,3.27,1.02],paint);
 }
}

/** Ground-scale, collisionless facade accents. Local +Z points out toward the street. */
export function makeVenueProp(kind:string){
 const group=new THREE.Group();
 const cafe=kind==='coffee',bakery=kind==='bread';
 const ink=material(cafe?'#4e423b':bakery?'#705045':'#384e46');
 const trim=material('#ebd9af');
 const panel=material(cafe?'#3f786c':bakery?'#ad6149':'#42665e');
 const canvas=material(cafe?'#4b8774':bakery?'#bd694f':'#416a61');
 const canvasIvory=material('#fbefd2');
 const metal=material('#8e7150',.49);
 const amber=material('#cc8955');
 const litRoom=new THREE.MeshStandardMaterial({
  color:'#ffd18b',emissive:'#e48a43',emissiveIntensity:.48,roughness:.82,
 });
 const lamp=new THREE.MeshBasicMaterial({color:'#ffeab4',toneMapped:false});

 // Shallow interior and swung-open leaf keep the entrance legible from the street.
 box(group,[2.35,3.20,.13],[0,1.60,.10],trim);
 box(group,[1.74,2.65,.055],[0,1.46,.195],litRoom);
 box(group,[1.78,.34,.15],[0,.32,.26],amber);
 box(group,[1.81,.27,.24],[0,2.67,.27],ink);
 for(const x of [-.89,.89])box(group,[.16,2.66,.23],[x,1.46,.27],ink);
 const pendant=new THREE.Mesh(new THREE.SphereGeometry(.12,12,8),lamp);
 pendant.position.set(-.20,2.22,.25);
 group.add(pendant);
 box(group,[.038,.38,.038],[-.20,2.47,.25],amber);
 box(group,[2.40,.12,.42],[0,.08,.22],trim);
 box(group,[1.58,.04,.52],[0,.15,.36],litRoom);

 const door=new THREE.Group();
 door.position.set(.81,.15,.37);
 door.rotation.y=1.24;
 group.add(door);
 box(door,[1.47,.70,.094],[-.73,.37,0],panel);
 for(const x of [-1.40,-.055])box(door,[.13,2.36,.103],[x,1.18,0],panel);
 box(door,[1.47,.13,.103],[-.73,2.30,0],panel);
 box(door,[1.36,.055,.055],[-.73,1.52,0],trim);
 box(door,[.073,.24,.18],[-1.30,1.01,0],metal);

 if(cafe||bakery)makeCanopy(group,2.78,[canvas,canvasIvory]);
 else box(group,[2.52,.13,.60],[0,3.19,.35],panel);

 const signX=cafe||bakery?1.39:0,signY=cafe||bakery?3.88:3.77,signZ=cafe||bakery?.83:.28;
 if(cafe||bakery){
  box(group,[.08,.08,1.05],[signX,4.29,.57],metal);
  box(group,[.07,.30,.07],[signX,4.15,signZ],metal);
 }
 const badgeBase=cylinder(group,.52,.52,.12,[signX,signY,signZ],panel);
 badgeBase.rotation.x=Math.PI/2;
 const border=ring(group,.49,.028,[signX,signY,signZ+.065],trim);
 border.position.z+=.016;
 const icon=new THREE.Group();
 icon.position.set(signX,signY,signZ+.18);
 group.add(icon);
 if(cafe)makeCafeBadge(icon);
 else if(bakery)makeBakeryBadge(icon);
 else makeKitchenBadge(icon);
 return group;
}

type ScentStyle={colors:[string,string];coastal:boolean};

function scentStyle(kind:string):ScentStyle{
 const category=kind.toLowerCase();
 if(/water|sea|coast|salt|marine/.test(category))return {colors:['#75bac9','#b9e7df'],coastal:true};
 if(/wood|forest|tree|pine/.test(category))return {colors:['#4b986e','#9fca76'],coastal:false};
 return {colors:['#88ab66','#d8c975'],coastal:false};
}

function leafShape(){
 const leaf=new THREE.Shape();
 leaf.moveTo(0,-.34);
 leaf.quadraticCurveTo(-.38,.06,0,.37);
 leaf.quadraticCurveTo(.35,.07,0,-.34);
 return new THREE.ShapeGeometry(leaf,8);
}

/** A tiny wind stroke and drifting leaf or sea flecks reveal an ambient scent. */
export function makeEnvironmentScent(kind:string){
 const group=new THREE.Group();
 const {colors,coastal}=scentStyle(kind);
 const streams=colors.map((color,index)=>{
  const phase=index*.48;
  const paint=new THREE.MeshBasicMaterial({color,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
  const curve=new THREE.CatmullRomCurve3([
   new THREE.Vector3(-1.36,0,.1),
   new THREE.Vector3(-.55,.13,.46),
   new THREE.Vector3(.33,.33,.35),
   new THREE.Vector3(1.22,.45,-.08),
  ]);
  const wind=new THREE.Group();
  const stroke=new THREE.Mesh(new THREE.TubeGeometry(curve,15,.065,6,false),paint);
  wind.add(stroke);
  const flutter=new THREE.Mesh(coastal?new THREE.OctahedronGeometry(.19):leafShape(),paint);
  flutter.position.set(1.25,.58,-.07);
  wind.add(flutter);
  group.add(wind);
  return {wind,flutter,paint,phase};
 });
 return {
  group,
  update(time:number,reduced:boolean){
   for(const {wind,flutter,paint,phase} of streams){
    const age=reduced?.48+phase*.47:(time*.66+phase)%1;
    paint.opacity=reduced?.8:Math.sin(age*Math.PI)*.84;
    wind.position.set(Math.sin(age*3.1+phase)*1.45,2+age*2.7,phase*1.44);
    wind.rotation.y=reduced?phase:age*.9+phase;
    wind.scale.setScalar(.68+age*.46);
    flutter.rotation.set(age*.8,age*3.3,phase+age*1.04);
   }
  },
 };
}
