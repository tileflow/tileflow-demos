import {distance,sampleRoute} from './streets.mjs';
export const PICKUP_RADIUS=2.7;
export const TASTES = {
 bread: {label:'Croissant', aroma:'Toasted butter', trace:'#bd7932', emoji:'🥐', color:'#ffebae'},
 coffee: {label:'Coffee', aroma:'Fresh roast', trace:'#9556b6', emoji:'☕', color:'#efd8ff'},
 food: {label:'Paella', aroma:'Warm saffron', trace:'#d87937', emoji:'🥘', color:'#ffd4c8'},
 pizza: {label:'Pizza', aroma:'Baked tomato', trace:'#ca604d', emoji:'🍕', color:'#ffddb4'},
 ramen: {label:'Ramen', aroma:'Hot broth', trace:'#447983', emoji:'🍜', color:'#d3ebf1'},
 burger: {label:'Burger', aroma:'Smoky grill', trace:'#965945', emoji:'🍔', color:'#eddcb8'},
 iceCream: {label:'Ice cream', aroma:'Sweet vanilla', trace:'#b5599b', emoji:'🍦', color:'#fbd8e8'},
};
const isTaste=kind=>Object.hasOwn(TASTES,kind);
const COMBO_WINDOW=12;
export const JUMP_SECONDS=1.1;
export function jumpPose(remaining){
 const elapsed=JUMP_SECONDS-remaining,air=(elapsed-.1)/.76,anticipate=remaining>0&&elapsed<.1?Math.sin(elapsed/.1*Math.PI/2):0,landing=air>1&&remaining>0?Math.sin(Math.min(1,(elapsed-.86)/.24)*Math.PI):0;
 const height=remaining>0&&air>0&&air<1?Math.sin(Math.PI*air)*5.6:0;
 return {height,air:Math.max(0,Math.min(1,air)),anticipate,landing,tuck:height/5.6,active:remaining>0};
}
export const jumpHeight=remaining=>jumpPose(remaining).height;
export const REST_SECONDS=3;
export const SECONDS_PER_BITE=60;
export const HARD_CLOCK={seconds:33,minimumSeconds:20,secondsPerTasting:4};
/** Round rules use active time only; rendering and pause live outside. */
export function createRound(duration=SECONDS_PER_BITE,{minimumSeconds=28,secondsPerTasting=7}={}){
 const timeForBite = () => Math.max(Math.min(duration,minimumSeconds), duration-state.tastings*secondsPerTasting);
 const state={status:'idle',remaining:duration,health:3,score:0,stars:0,tastings:0,recipes:/** @type {string[][]} */ ([]),elapsed:0,invulnerable:0,stun:0,rest:0,combo:0,lastPickup:-100,tastingDamage:false,slots:/** @type {Array<{id:number,kind:string,point:number[],nodeId:any,building?:any,done:boolean}>} */ ([]),collected:new Set()};
 return {state,
  start(slots){Object.assign(state,{status:'playing',remaining:duration,health:3,score:0,stars:0,tastings:0,recipes:[],elapsed:0,invulnerable:2.5,stun:0,rest:0,combo:0,lastPickup:-100,tastingDamage:false,slots:slots.map(s=>({...s,done:false}))});state.collected.clear();},
  setTasting(slots){state.slots=slots.map(s=>({...s,done:false}));state.tastingDamage=false;state.remaining=timeForBite();},
  stop(){state.status='idle';state.rest=0;state.stun=0;},
  tick(dt,{hazard=false,sitting=false,moving=false,clockRunning=true}={}){
   const events=[];if(state.status!=='playing')return events;dt=Math.max(0,Math.min(dt,1));state.elapsed+=dt;if(clockRunning)state.remaining=Math.max(0,state.remaining-dt);state.invulnerable=Math.max(0,state.invulnerable-dt);state.stun=Math.max(0,state.stun-dt);
   if(state.combo&&state.elapsed-state.lastPickup>=COMBO_WINDOW)state.combo=0;
   if(state.remaining===0){state.status='finished';events.push({type:'end',reason:'time'});return events;}
   if(hazard&&state.invulnerable===0){state.health--;state.invulnerable=2;state.stun=1;state.tastingDamage=true;state.combo=0;state.rest=0;events.push({type:'hurt'});if(state.health===0){state.status='finished';events.push({type:'end',reason:'nose'});return events;}}
   if(sitting&&!moving&&!hazard&&state.stun===0&&state.health<3){state.rest+=dt;if(state.rest>=REST_SECONDS){state.health++;state.rest=0;events.push({type:'heal',source:'rest'});}}else state.rest=0;
   return events;
  },
  pickup(item){
   if(state.status!=='playing'||state.collected.has(item.id)||state.slots.every(s=>s.done))return [];
   const index=state.slots.findIndex(s=>s.kind===item.kind&&!s.done);
   if(index<0)return [];
   state.collected.add(item.id);
   state.remaining=timeForBite();
   const slot=state.slots[index];slot.done=true;state.combo=state.elapsed-state.lastPickup<COMBO_WINDOW?Math.min(3,state.combo+1):1;state.lastPickup=state.elapsed;const points=100*state.combo;state.score+=points;
   const events=[{type:'pickup',id:item.id,slotId:slot.id,index,point:item.point,kind:item.kind,points,combo:state.combo}];
   if(state.slots.every(slot=>slot.done)){
    const stars=state.tastingDamage?1:2;
    state.recipes.push(state.slots.map(slot=>slot.kind));
    state.tastings++;
    state.remaining=timeForBite();
    state.stars+=stars;
    state.score+=300;
    events.push({type:'tasting',stars});
   }
   return events;
  }
 };
}
/** Leave space between scent stops and keep generic plates from crowding out distinct dishes. */
export function selectStreetObjects(candidates, spacing=34, preferred=new Set()){
 const pool=candidates.filter(item=>isTaste(item.kind));
 const abundance=new Map();
 for(const item of pool)abundance.set(item.kind,(abundance.get(item.kind)??0)+1);
 pool.sort((a,b)=>Number(preferred.has(b.id))-Number(preferred.has(a.id))||(a.kind==='food'?1:0)-(b.kind==='food'?1:0)||abundance.get(a.kind)-abundance.get(b.kind)||a.id-b.id);
 const selected=[],cells=new Map(),plates=[];
 for(const item of pool){
  const x=Math.floor(item.point[0]/spacing),z=Math.floor(item.point[1]/spacing);
  let overlap=false;
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
   const nearby=cells.get(`${x+dx}:${z+dz}`)??[];
   if(nearby.some(other=>distance(other.point,item.point)<spacing))overlap=true;
  }
  if(overlap||item.kind==='food'&&plates.some(other=>distance(other.point,item.point)<90))continue;
  selected.push(item);
  if(item.kind==='food')plates.push(item);
  const key=`${x}:${z}`;
  if(!cells.has(key))cells.set(key,[]);
  cells.get(key).push(item);
 }
 return selected;
}

/** Pick a short tasting walk using nearby places, favouring distinct dishes when practical. */
export function chooseTasting(candidates,position,collected,reachable,limit=440,count=2){
 const pool=candidates.filter(item=>isTaste(item.kind)&&!collected.has(item.id)&&distance(position,item.point)<=limit&&reachable(item));
 const result=[];
 let origin=position;
 while(result.length<count&&pool.length){
  let bestIndex=0,bestScore=Infinity;
  for(const [index,item] of pool.entries()){
   const gap=distance(origin,item.point);
   const repeated=result.some(previous=>previous.kind===item.kind);
   const score=gap+(repeated?80:0);
   if(score<bestScore){bestScore=score;bestIndex=index;}
  }
  const [item]=pool.splice(bestIndex,1);
  result.push(item);
  origin=item.point;
 }
 return result;
}
export function nearestKnownIngredient(items,slots,collected,position,isKnown){return items.filter(item=>!collected.has(item.id)&&slots.some(s=>!s.done&&s.kind===item.kind)&&isKnown(item.point)).sort((a,b)=>distance(position,a.point)-distance(position,b.point))[0];}
export function sniffRadius(remaining){const u=Math.max(0,Math.min(1,(4-remaining)/1.4));return remaining>0?42+58*u*u*(3-2*u):42;}
export function reachableNodeIds(graph,start){const seen=new Set([start]),queue=[start];for(let i=0;i<queue.length;i++){const node=graph.nodes.get(queue[i]);if(!node)continue;for(const link of node.links)if(!seen.has(link.id)){seen.add(link.id);queue.push(link.id);}}return seen;}
export const VEHICLE_SCALE=1.12;
export function hazardPosition(hazard,t){
 if(hazard.kind==='pedestrian'){
  const cycle=pedestrianCycle(hazard,t),angle=hazard.heading??0;
  return {p:[hazard.point[0]+Math.cos(angle)*cycle.offset,hazard.point[1]-Math.sin(angle)*cycle.offset],
   heading:angle+cycle.direction*Math.PI/2};
 }
 const route=hazard.route;
 if(!route||!route.length)return {p:hazard.point??route?.points[0],heading:hazard.heading??0};
 const wrap=distance=>route.loop?((distance%route.length)+route.length)%route.length:Math.max(0,Math.min(route.length,distance));
 const distanceAlong=wrap(t*hazard.speed+(hazard.phase??0));
 const sample=sampleRoute(route,distanceAlong);
 const ahead=sampleRoute(route,wrap(distanceAlong+2.3));
 const behind=sampleRoute(route,wrap(distanceAlong-2.3));
 return {...sample,heading:distance(ahead.p,behind.p)>.1?
  Math.atan2(ahead.p[0]-behind.p[0],ahead.p[1]-behind.p[1]):sample.heading};
}

/** The warning window and the water pulse share the collision clock. */
export function sprinklerCycle(hazard,t){
 const phase=((t+(hazard.phase??0))%5+5)%5;
 return {anticipating:phase<.7,active:phase>=.7&&phase<2.15};
}

/** A crossing alternates curb to curb with a visible pause before stepping out. */
export function pedestrianCycle(hazard,t){
 const phase=((t+(hazard.phase??0))%11+11)%11;
 const direction=phase<5.5?1:-1;
 const leg=phase%5.5,start=.85,finish=3.95;
 const progress=Math.max(0,Math.min(1,(leg-start)/(finish-start)));
 return {offset:(progress-.5)*(hazard.width??9)*direction,direction,
  anticipating:leg<start,active:leg>=start&&leg<finish};
}

export function hazardContact(hazards,p,t,height=0,effect='all'){
 for(const hazard of hazards){
  if(hazard.kind==='barrier')continue;
  const sprinkler=hazard.kind==='sprinkler',pedestrian=hazard.kind==='pedestrian';
  if(effect!=='all'&&(sprinkler||pedestrian)!==(effect==='slow'))continue;
  if(sprinkler&&(!sprinklerCycle(hazard,t).active||height>1.25))continue;
  if(pedestrian&&!pedestrianCycle(hazard,t).active)continue;
  const sample=hazardPosition(hazard,t);
  if(!hazard.route){
   if((hazard.kind==='poop'&&height>3)||(hazard.kind==='pothole'&&height>1))continue;
   if(distance(sample.p,p)<(hazard.radius??3.5))return {hazard,sample};
   continue;
  }
  const dx=p[0]-sample.p[0],dz=p[1]-sample.p[1];
  const side=Math.abs(dx*Math.cos(sample.heading)-dz*Math.sin(sample.heading));
  const along=Math.abs(dx*Math.sin(sample.heading)+dz*Math.cos(sample.heading));
  const narrow=hazard.kind==='bike'||hazard.kind==='scooter';
  const bus=hazard.kind==='bus';
  const halfWidth=narrow?1.15:bus?2.55:2.05;
  const halfLength=narrow?(hazard.kind==='bike'?2.1:1.65):bus?6.8:4.1;
  if(side<halfWidth*VEHICLE_SCALE&&along<halfLength*VEHICLE_SCALE)return {hazard,sample};
 }
}
export function hazardHits(hazards,p,t,height=0){
 return !!hazardContact(hazards,p,t,height);
}
