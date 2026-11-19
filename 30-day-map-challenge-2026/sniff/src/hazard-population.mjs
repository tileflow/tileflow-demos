import {distance} from './streets.mjs';
import {nearestOnRoute} from './traffic.mjs';

export const ENCOUNTER_REFRESH_DISTANCE=150;
export const ENCOUNTER_PLAYER_CLEARANCE=85;
export const ENCOUNTER_RETAIN_DISTANCE=420;
const STATIC_SPACING=18;

const clearance=(hazard,position)=>hazard.route?nearestOnRoute(hazard.route,position).distance:distance(hazard.point,position);

/** Keep nearby fixtures and vehicle phases while placing encounters outside the play area. */
export function mergeRegionEncounters(current,incoming,position,food){
 const kept=current.filter(hazard=>clearance(hazard,position)<ENCOUNTER_RETAIN_DISTANCE);
 const ids=new Set(kept.map(hazard=>hazard.id));
 const statics=kept.filter(hazard=>!hazard.route);
 for(const hazard of incoming){
  if(hazard.works||ids.has(hazard.id)||clearance(hazard,position)<ENCOUNTER_PLAYER_CLEARANCE)continue;
  if(!hazard.route){
   if(hazard.kind==='crowd'&&statics.some(other=>other.kind==='crowd'))continue;
   if(food.some(item=>distance(hazard.point,item.point)<11))continue;
   if(statics.some(other=>distance(hazard.point,other.point)<STATIC_SPACING))continue;
   statics.push(hazard);
  }
  kept.push(hazard);
  ids.add(hazard.id);
 }
 return kept;
}
