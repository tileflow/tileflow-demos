import * as THREE from 'three';
import {createExploration} from './exploration.mjs';

/** Composite fog at the edges of the map scene, leaving the centre unobscured. */
export function createMapReveal(){
 const field=createExploration(),mask=new THREE.DataTexture(field.data,field.size,field.size,THREE.RedFormat);mask.minFilter=mask.magFilter=THREE.LinearFilter;mask.needsUpdate=true;
 let lastStamp: {x:number;z:number;radius:number}|undefined;
 const scene=new THREE.Scene(),camera=new THREE.Camera();
 const material=new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,toneMapped:false,uniforms:{mask:{value:mask},inverse:{value:new THREE.Matrix4()},bounds:{value:new THREE.Vector3(field.minX,field.minZ,field.span)},time:{value:0},strength:{value:1}},vertexShader:`
  uniform mat4 inverse;
  varying vec2 tex;
  varying vec4 rayNear,rayFar;
  void main(){tex=uv;rayNear=inverse*vec4(position.xy,-1.,1.);rayFar=inverse*vec4(position.xy,1.,1.);gl_Position=vec4(position.xy,0.,1.);}
 `,fragmentShader:`
  uniform sampler2D mask;uniform vec3 bounds;uniform float time;uniform float strength;
  varying vec2 tex;
  varying vec4 rayNear,rayFar;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
  void main(){float radius=length((tex-.5)/vec2(.55,.57));if(radius<=.55)discard;
   vec3 p=rayNear.xyz/rayNear.w,q=rayFar.xyz/rayFar.w;vec3 ray=q-p;vec3 ground=p-ray*(p.y/ray.y);vec2 uv=(ground.xz-bounds.xy)/bounds.z;
   float revealed=0.;if(uv.x>=0.&&uv.x<=1.&&uv.y>=0.&&uv.y<=1.)revealed=texture2D(mask,uv).r;
   if(revealed>=.85)discard;
   vec2 cloud=ground.xz*.018+vec2(time*.013,-time*.009);float n=noise(cloud)*.65+noise(cloud*2.1)*.25+noise(cloud*4.2)*.1;
   vec3 fog=mix(vec3(.83,.82,.90),vec3(.98,.97,1.),smoothstep(.12,.86,n));
   float clear=smoothstep(.025,.85,revealed);
   clear=clamp(clear-(n-.5)*.35*clear*(1.-clear),0.,1.);
   float edge=smoothstep(.55,1.07,radius);
   float cover=(1.-clear)*edge*mix(.34,.52,n)*strength;
   gl_FragColor=vec4(fog,cover);
  }`});
 const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);quad.frustumCulled=false;scene.add(quad);
 return {field,reveal(x:number,z:number,radius:number){
   if(lastStamp&&Math.hypot(x-lastStamp.x,z-lastStamp.z)<.8&&Math.abs(radius-lastStamp.radius)<.65)return;
   lastStamp={x,z,radius};
   if(field.reveal(x,z,radius))mask.needsUpdate=true;
  },reset(){field.reset();lastStamp=undefined;mask.needsUpdate=true;},
  render(renderer:THREE.WebGLRenderer,inverse:THREE.Matrix4,time:number,strength=1){
   if(strength<=0)return;
   // Blend over the shared MapLibre framebuffer without copying it to a texture.
   material.uniforms.time.value=time;material.uniforms.strength.value=strength;material.uniforms.bounds.value.set(field.minX,field.minZ,field.span);
   material.uniforms.inverse.value=inverse;renderer.render(scene,camera);
  },dispose(){mask.dispose();quad.geometry.dispose();material.dispose();}
 };
}
