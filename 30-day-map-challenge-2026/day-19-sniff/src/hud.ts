import * as THREE from 'three';
import {makeAroma,makeHeart} from './objects';
import {makeStar} from './game-objects';
import {createRestMeter} from './dog-effects';
import {createRecipeFinish} from './recipe-finish';
export function createHud(reduced:boolean){
 const recipeFinish=createRecipeFinish();
 const canvas=document.createElement('canvas');canvas.className='hud-3d';canvas.setAttribute('aria-hidden','true');document.body.append(canvas);
 const badges=document.createElement('div');badges.className='hud-checks';badges.setAttribute('aria-hidden','true');document.body.append(badges);
 const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(0,innerWidth,innerHeight,0,-1000,1000);camera.position.z=500;scene.add(new THREE.HemisphereLight('#fff9f0','#a89dd2',2.3));const light=new THREE.DirectionalLight('#ffffff',2.6);light.position.set(-150,250,400);scene.add(light);
 type Item={object:THREE.Object3D;anchor:string;scale:number;float:boolean;badge?:HTMLElement};let objects:Item[]=[],flights:{object:THREE.Group;from:number[];dog:number[];anchor:string;start:number;kind:string;onEnd:()=>void}[]=[],bursts:{start:number;pieces:THREE.Mesh[];center:number[]}[]=[];
 const restMeter=createRestMeter();restMeter.group.visible=false;scene.add(restMeter.group);
 let restState={progress:0,remaining:3,full:false};
 let size=[0,0];const hearts=Array.from({length:3},(_,i)=>({object:makeHeart('#ff637e'),anchor:`heart-${i}`,scale:13,float:false}));const star={object:makeStar(),anchor:'star-model',scale:20,float:false};objects=[...hearts,star];objects.forEach(i=>scene.add(i.object));
 const rect=(id:string)=>{const el=document.getElementById(id);if(!el||!el.getClientRects().length)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:innerHeight-r.y-r.height/2,width:r.width,height:r.height};};
 const normalize=(object:THREE.Object3D,desired:number)=>{const bounds=new THREE.Box3().setFromObject(object),v=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());object.position.sub(center);const inner=new THREE.Group();inner.add(object);inner.scale.setScalar(desired/Math.max(v.x,v.y,v.z));const wrapper=new THREE.Group();wrapper.add(inner);return wrapper;};
 function addFood(kind:string,anchor:string,scale:number,staticTile=false){
  const object=normalize(makeAroma(kind),1);
  object.userData.foodKind=kind;
  let badge:HTMLElement|undefined;
  if(staticTile){
   badge=document.createElement('span');
   badge.className='ingredient-check';
   badge.textContent='✓';
   badge.hidden=true;
   badges.append(badge);
  }
  objects.push({object,anchor,scale,float:!staticTile,badge});
  scene.add(object);
 }
 function removeFood(prefix:string){
  objects=objects.filter(item=>{
   if(!item.anchor.startsWith(prefix))return true;
   scene.remove(item.object);
   item.badge?.remove();
   return false;
  });
 }
 function burst(x:number,y:number){
  if(reduced)return;
  const pieces=Array.from({length:24},(_,index)=>{
   const isSpark=index%3===0;
   const geometry=isSpark?new THREE.OctahedronGeometry(5.5):new THREE.BoxGeometry(5,9,2);
   const color=['#ffc633','#ef83bf','#8672ed','#64cdd5'][index%4];
   const piece=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color}));
   piece.position.set(x,y,35);
   scene.add(piece);
   return piece;
  });
  bursts.push({start:performance.now()/1000,pieces,center:[x,y]});
 }
 function removeBurst({pieces}:typeof bursts[number]){
  for(const piece of pieces){
   scene.remove(piece);
   piece.geometry.dispose();
   (piece.material as THREE.Material).dispose();
  }
 }
 return {
  showRest(screen:number[],visible:boolean,progress:number,remaining:number,full:boolean){
   restState={progress,remaining,full};
   restMeter.group.visible=visible;
   restMeter.group.position.set(Math.max(45,Math.min(innerWidth-45,screen[0])),innerHeight-screen[1]+55,150);
  },
  setTasting(slots:{kind:string}[]){
   recipeFinish.hideAward();
   removeFood('recipe-bite-');
   removeFood('ingredient-');
   slots.forEach((slot,index)=>addFood(slot.kind,'ingredient-'+index,52,true));
  },
  celebrateTasting(kinds:readonly string[], _recipeNumber?:number){
   const frame=recipeFinish.celebrate(kinds);
   removeFood('recipe-bite-');
   kinds.forEach((kind,index)=>addFood(kind,'recipe-bite-'+index,37));
   burst(frame.x+frame.width/2,innerHeight-(frame.y+frame.height/2));
  },
  finishRound(){
   removeFood('recipe-bite-');
   recipeFinish.hideAward();
  },
  collect(kind:string,index:number,from:number[],dog:number[],onEnd:()=>void){const object=normalize(makeAroma(kind),1);scene.add(object);flights.push({object,from:[from[0],innerHeight-from[1]],dog:[dog[0],innerHeight-dog[1]+20],anchor:`ingredient-${index}`,start:performance.now()/1000,kind,onEnd});},
  update(t:number,health:number){if(size[0]!==innerWidth||size[1]!==innerHeight){size=[innerWidth,innerHeight];renderer.setSize(...size as [number,number],false);camera.right=innerWidth;camera.top=innerHeight;camera.updateProjectionMatrix();}
   objects.forEach(item=>{
    const r=rect(item.anchor);
    item.object.visible=!!r;
    if(item.badge){
     item.badge.hidden=!r||!document.getElementById(item.anchor)?.parentElement?.classList.contains('done');
     if(r&&!item.badge.hidden){
      const x=r.x+r.width/2-11,y=innerHeight-r.y-r.height/2+9;
      item.badge.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%)`;
     }
    }
    if(!r)return;
    const heartIndex=hearts.indexOf(item as typeof hearts[number]);
    const food=Boolean(item.object.userData.foodKind);
    item.object.position.set(r.x,r.y+(item.float&&!reduced?Math.sin(t*2)*2:0),0);
    item.object.rotation.set(food?(item.object.userData.foodKind==='food'?.98:.55):0,item.float&&!reduced?Math.sin(t*.9)*.22:.1,food?-.1:0);
    const available=item.badge?Math.min(r.width*.73,r.height*.78):r.width*(food?.9:.4);
    item.object.scale.setScalar(Math.min(item.scale,available)*(heartIndex>=0&&heartIndex>=health?.65:1));
    if(heartIndex>=0){
     const heart=item.object as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
     heart.material.color.set(heartIndex<health?'#ff637e':'#cec6d9');
    }
   });
   flights=flights.filter(f=>{
    const duration=reduced?.25:1.05;
    const u=Math.min(1,(t-f.start)/duration);
    const target=rect(f.anchor);
    if(!target||u>=1){scene.remove(f.object);f.onEnd();return false;}
    const first=u<.43;
    const progress=first?u/.43:(u-.43)/.57;
    const eased=progress*progress*(3-2*progress);
    const from=first?f.from:f.dog;
    const to=first?f.dog:[target.x,target.y];
    const plate=f.kind==='food';
    const height=plate?(first?40:100):(first?65:130);
    const loft=reduced?0:Math.sin(progress*Math.PI)*height;
    f.object.position.set(from[0]+(to[0]-from[0])*eased,from[1]+(to[1]-from[1])*eased+loft,100);
    f.object.scale.setScalar(first?35+Math.sin(progress*Math.PI)*12:35+progress*20);
    // A wide pan reads through a tilt. Spinning it around the vertical axis hides the rice.
    if(plate){
     const tilt=reduced?0:Math.sin(u*Math.PI*2)*.14;
     f.object.rotation.set(.98+tilt,.12*(1-u),-.28+u*.42);
    }else f.object.rotation.set(.3,u*Math.PI*3,-.2);
    return true;
   });
   bursts=bursts.filter(effect=>{
    const elapsed=Math.max(0,t-effect.start);
    if(elapsed>1.15){removeBurst(effect);return false;}
    for(const [index,piece] of effect.pieces.entries()){
     const angle=index*Math.PI*(3-Math.sqrt(5));
     const speed=114+index%4*23;
     piece.position.set(effect.center[0]+Math.cos(angle)*elapsed*speed,
      effect.center[1]+(Math.sin(angle)*speed+38)*elapsed-elapsed*elapsed*145,35);
     piece.rotation.set(elapsed*3,elapsed*((index%5)+1),angle+elapsed*2);
     piece.scale.setScalar(Math.max(0,1-elapsed/1.15));
    }
    return true;
   });
   restMeter.update(restState.progress,restState.remaining,restState.full,t,reduced);
   renderer.render(scene,camera);
  },
  clearFlights(){flights.forEach(f=>scene.remove(f.object));flights=[];},
  dispose(){bursts.forEach(removeBurst);restMeter.dispose();renderer.dispose();canvas.remove();badges.remove();}
 };
}
