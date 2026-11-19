/** Camera-relative analogue motion with equal diagonal speed and frame-rate independent easing. */
export function createMovement(){let velocity=[0,0];return {reset(){velocity=[0,0];},step(dt,input,bearing,position,surface,speed=20){
 dt=Math.max(0,Math.min(.1,dt));const magnitude=Math.hypot(...input),a=bearing*Math.PI/180,x=input[0]/Math.max(1,magnitude),z=input[1]/Math.max(1,magnitude),target=[(x*Math.cos(a)-z*Math.sin(a))*speed,(x*Math.sin(a)+z*Math.cos(a))*speed];
 const reverse=velocity[0]*target[0]+velocity[1]*target[1]<0,tau=magnitude<.05?.025:reverse?.035:.055,e=Math.exp(-dt/tau),travel=target.map((v,i)=>v*dt+(velocity[i]-v)*tau*(1-e));velocity=target.map((v,i)=>v+(velocity[i]-v)*e);
 const metres=Math.hypot(...travel),next=surface.move(position,travel,metres);if(metres>.001&&Math.hypot(next[0]-position[0],next[1]-position[1])<.001)velocity=[0,0];
 return {position:next,moving:Math.hypot(next[0]-position[0],next[1]-position[1])>.002,speed:Math.hypot(...velocity)};
 }};}
