/** Continuous navigation camera. No pose-dependent target, zoom or lighting changes. */
export const angleDelta=(a,b)=>((a-b+540)%360)-180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const GAMEPLAY_PITCH = 41;
export const MIN_GAMEPLAY_PITCH = 27;
export function createFollowCamera(center,bearing=24,pitch=GAMEPLAY_PITCH){
 const state={center:[...center],bearing,pitch,yawSpeed:0,pitchSpeed:0,velocity:[0,0],clearFor:0,targetPitch:pitch};
 return {state,reset(center,bearing,pitch){Object.assign(state,{center:[...center],bearing,pitch,yawSpeed:0,pitchSpeed:0,velocity:[0,0],clearFor:0,targetPitch:pitch});},
  step(dt,target,heading,moving,safePitch=GAMEPLAY_PITCH,rotate=true){dt=clamp(dt,0,.05);
   for(let i=0;i<2;i++){const omega=6,delta=state.center[i]-target[i],v=state.velocity[i],e=Math.exp(-omega*dt);state.center[i]=target[i]+(delta+(v+omega*delta)*dt)*e;state.velocity[i]=(v-omega*(v+omega*delta)*dt)*e;}
   const turn=moving&&rotate?angleDelta(180-heading*180/Math.PI,state.bearing):0;
   const desiredSpeed=Math.abs(turn)>9?clamp(turn*.55,-16,16):0;
   state.yawSpeed+=clamp(desiredSpeed-state.yawSpeed,-24*dt,24*dt);
   // Stop yaw drift while the dog is stationary, without changing its bearing.
   if(!moving||!rotate)state.yawSpeed=0;
   state.bearing+=state.yawSpeed*dt;
   const preferred=Math.min(GAMEPLAY_PITCH,safePitch);
   if(preferred<state.targetPitch){state.targetPitch=preferred;state.clearFor=0;}
   else{state.clearFor+=dt;if(state.clearFor>1.8)state.targetPitch=preferred;}
   const pitchSpeed=clamp((state.targetPitch-state.pitch)*1.4,-5,3);
   state.pitchSpeed+=clamp(pitchSpeed-state.pitchSpeed,-9*dt,9*dt);state.pitch=clamp(state.pitch+state.pitchSpeed*dt,0,50);
   return state;
  }
 };
}
