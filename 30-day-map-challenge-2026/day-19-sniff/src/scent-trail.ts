import * as THREE from 'three';
import {makeRoute,sampleRoute} from './streets.mjs';
import {trailEnvelope} from './scent-path.mjs';
export function createScentTrail(scene:THREE.Scene){
 const root=new THREE.Group();scene.add(root);const material=new THREE.MeshBasicMaterial({color:'#9a64ed',side:THREE.DoubleSide,transparent:true,opacity:0,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
 const shape=new THREE.Shape();shape.moveTo(-.9,-.9);shape.lineTo(0,.35);shape.lineTo(.9,-.9);shape.lineTo(1.3,-.55);shape.lineTo(0,1.25);shape.lineTo(-1.3,-.55);shape.closePath();const geometry=new THREE.ShapeGeometry(shape);geometry.rotateX(Math.PI/2);
 let arrows:THREE.Mesh[]=[];
 return {setPath(points:number[][],color='#9a64ed'){arrows.forEach(a=>{root.remove(a);(a.material as THREE.Material).dispose();});arrows=[];material.color.set(color);const route=makeRoute(points),length=Math.min(85,route.length);for(let d=Math.min(3,length/2);d>0&&d<length;d+=4){const sample=sampleRoute(route,d),mesh=new THREE.Mesh(geometry,material.clone());mesh.position.set(sample.p[0],.18,sample.p[1]);mesh.rotation.y=sample.heading;mesh.userData.progress=d/Math.max(1,length);mesh.renderOrder=2;root.add(mesh);arrows.push(mesh);}},
 update(remaining:number,t:number,reduced:boolean){const envelope=trailEnvelope(remaining);root.visible=envelope.opacity>0;for(const [i,arrow] of arrows.entries()){const progress=arrow.userData.progress;arrow.visible=i===0||progress<envelope.draw;const mat=arrow.material as THREE.MeshBasicMaterial;mat.opacity=envelope.opacity*(reduced?.9:.7+.3*Math.sin(t*5-i*.65));arrow.scale.setScalar(reduced?1:1+Math.sin(t*5-i*.65)*.07);}},
 visiblePoints(){
  if(!root.visible)return [];
  const visible=arrows.filter(arrow=>arrow.visible);
  if(visible.length<=3)return visible.map(arrow=>[arrow.position.x,arrow.position.z]);
  return [visible[0],visible[Math.floor(visible.length/2)],visible.at(-1)!]
   .map(arrow=>[arrow.position.x,arrow.position.z]);
 },
 clear(){root.visible=false;arrows.forEach(a=>{root.remove(a);(a.material as THREE.Material).dispose();});arrows=[];},dispose(){this.clear();geometry.dispose();material.dispose();scene.remove(root);}};
}
