import type {Building} from './buildings';
import {distance,toLocal} from './streets.mjs';
import {pointInRing,segmentProjection,type createWalkSurface} from './walking.mjs';

type Surface = ReturnType<typeof createWalkSurface>;
type StreetNode = {id:string;p:number[]};

function closestWall(point:number[],ring:number[][]){
 let wall;
 for(let i=1;i<ring.length;i++){
  const hit=segmentProjection(point,ring[i-1],ring[i]);
  if(!wall||hit.distance<wall.distance)wall=hit;
 }
 return wall;
}

export function placeVenue(building:Building,business:number[],entrances:number[][],nodes:StreetNode[],surface:Surface){
 const ring=building.outline.map(toLocal);
 const doors=entrances.filter(point=>distance(point,business)<32)
  .sort((a,b)=>distance(a,business)-distance(b,business));

 function approach(wall:NonNullable<ReturnType<typeof closestWall>>,node:StreetNode,fromDoor:boolean){
  const [x,z]=wall.tangent;
  for(const outward of [[-z,x],[z,-x]]){
   const offset=(metres:number)=>[wall.point[0]+outward[0]*metres,wall.point[1]+outward[1]*metres];
   const point=offset(2.7);
   if(pointInRing(point,ring)||!surface.canStand(point)||!surface.canTravel(node.p,point))continue;
   return {point,nodeId:node.id,venue:{point:offset(.45),facing:Math.atan2(outward[0],outward[1])},fromDoor};
  }
 }

 for(const door of doors){
  const wall=closestWall(door,ring);
  if(!wall)continue;
  for(const node of nodes){
   if(distance(node.p,door)>32)continue;
   const placement=approach(wall,node,true);
   if(placement)return placement;
  }
 }

 for(const node of nodes){
  const wall=closestWall(node.p,ring);
  if(!wall||wall.distance>35)continue;
  const placement=approach(wall,node,false);
  if(placement)return placement;
 }

 const node=nodes[0];
 if(node)return {point:node.p,nodeId:node.id,venue:undefined,fromDoor:false};
}
