import {mergeRegionEncounters} from '../src/hazard-population.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEncounters} from '../src/encounters.mjs';
import {makeStreetGraph} from '../src/network.mjs';
import {distance,makeRoute,sampleRoute} from '../src/streets.mjs';
import {collectTrafficCircuits} from '../src/traffic.mjs';
import {createWalkSurface,pointInRing,segmentProjection} from '../src/walking.mjs';

const lines=Array.from({length:17},(_,index)=>{
 const offset=(index-8)*38;
 return [{points:[[-330,offset],[330,offset]],width:14},
  {points:[[offset,-330],[offset,330]],width:14}];
}).flat();
const graph=makeStreetGraph(lines);
const parks=[[57,57],[-57,95],[95,133],[133,-57],[171,57],[207,57],[133,171]].map(([x,z])=>[
 [[x-11,z-11],[x+11,z-11],[x+11,z+11],[x-11,z+11],[x-11,z-11]],
]);
const pavement=[-152,-114,-76,-38,0,38,76,114,152].map(z=>[
 [[-285,z+8],[285,z+8],[285,z+17],[-285,z+17],[-285,z+8]],
]);
const position=[0,0],food=[{point:[38,76]},{point:[76,114]}];
const surface=()=>createWalkSurface(lines,[],[],{center:position,radius:500});

test('varied obstacles leave jump room, safe pickups, and space to cross',()=>{
 const hazards=buildEncounters(lines,graph,surface(),position,food,{traffic:false,greenAreas:parks,pavementAreas:pavement});
 assert.ok(hazards.length>=22);
 for(const kind of ['barrier','pothole','sprinkler','trash']){
  assert.ok(hazards.filter(hazard=>hazard.kind===kind).length>=3);
 }
 assert.ok(hazards.filter(hazard=>hazard.kind==='crowd').length<=1);
 assert.equal(hazards.filter(hazard=>hazard.kind==='poop').length,1);
 assert.ok(hazards.every(hazard=>distance(hazard.point,position)>24));
 assert.ok(hazards.every(hazard=>food.every(item=>distance(item.point,hazard.point)>=11)));
 const pedestrian=hazards.find(hazard=>hazard.kind==='pedestrian');
 assert.ok(pedestrian);
 assert.ok(pedestrian.width>=15.3,'the walk extends across both sides of the 14 m road');
 const [x,z]=pedestrian.point,half=pedestrian.width/2;
 const side=[Math.cos(pedestrian.heading)*half,-Math.sin(pedestrian.heading)*half];
 assert.equal(surface().canTravel([x-side[0],z-side[1]],[x+side[0],z+side[1]],0),true);
 for(const [index,hazard] of hazards.entries()){
  assert.ok(hazards.slice(index+1).every(next=>distance(hazard.point,next.point)>=18));
 }
});

test('sprinklers stay on mapped grass away from roadways',()=>{
 const options={traffic:false,allowClosures:false};
 const withGrass=buildEncounters(lines,graph,surface(),position,food,{...options,greenAreas:parks});
 const sprinklers=withGrass.filter(hazard=>hazard.kind==='sprinkler');
 assert.ok(sprinklers.length>=2);
 for(const {point,radius} of sprinklers){
  assert.ok(parks.some(([ring])=>pointInRing(point,ring)));
  assert.ok(lines.every(({points:[a,b],width})=>segmentProjection(point,a,b).distance>=width/2+radius));
 }
 assert.ok(buildEncounters(lines,graph,surface(),position,food,options).every(hazard=>hazard.kind!=='sprinkler'));
});

test('easy keeps the obstacle variety and hard shifts its static mix away from barriers',()=>{
 const counts=[0,1,3].map(difficulty=>buildEncounters(lines,graph,surface(),position,food,{
  traffic:false,greenAreas:parks,pavementAreas:pavement,difficulty,
 }));
 const [easy,normal,hard]=counts;
 assert.ok(easy.length>=15&&easy.length<=18);
 assert.ok(easy.some(hazard=>hazard.kind==='sprinkler'));
 assert.ok(easy.some(hazard=>hazard.kind==='trash'));
 assert.ok(easy.every(hazard=>hazard.kind!=='crowd'&&hazard.kind!=='pedestrian'));
 assert.ok(easy.length<normal.length);
 const barriers=hazards=>hazards.filter(hazard=>hazard.kind==='barrier').length;
 assert.ok(barriers(hard)>0&&barriers(hard)<=4);
 assert.ok(barriers(hard)<barriers(normal));
 assert.ok(hard.filter(hazard=>hazard.works).length<=1);
});

test('hard traffic adds more cars, bikes, and scooters and keeps headways on shared loops',()=>{
 const normal=buildEncounters(lines,graph,surface(),position,food,{difficulty:1}).filter(hazard=>hazard.route);
 const hard=buildEncounters(lines,graph,surface(),position,food,{difficulty:3}).filter(hazard=>hazard.route);
 assert.ok(hard.length>normal.length);
 assert.equal(hard.length,34);
 assert.ok(hard.filter(hazard=>hazard.kind==='car').length>normal.filter(hazard=>hazard.kind==='car').length);
 for(const kind of ['bike','scooter'])assert.ok(hard.some(hazard=>hazard.kind===kind));
 const tracks=Map.groupBy(hard,hazard=>hazard.route);
 assert.ok([...tracks.values()].some(vehicles=>new Set(vehicles.map(hazard=>hazard.kind)).size>1));
 for(const [route,vehicles] of tracks){
  assert.deepEqual(route.points[0],route.points.at(-1));
  assert.equal(new Set(vehicles.map(hazard=>hazard.speed)).size,1);
  const phases=vehicles.map(hazard=>hazard.phase).sort((a,b)=>a-b);
  const gaps=phases.map((phase,index)=>(phases[index+1]??phases[0]+route.length)-phase);
  assert.ok(Math.min(...gaps)>=30);
 }
});

test('adjacent traffic circuits cannot share a long street',()=>{
 const sharedStreet=[
  [[30,-45],[170,-45]],[[30,45],[170,45]],
  ...[30,100,170].map(x=>[[x,-45],[x,45]]),
 ].map(points=>({points,width:12}));
 const terrain=createWalkSurface(sharedStreet,[],[],{center:position,radius:500});
 assert.equal(collectTrafficCircuits(sharedStreet,terrain,position).length,1);
});

test('pedestrian streets stay walkable without vehicle loops or road obstacles',()=>{
 const square=(x,attributes)=>{
  const corners=[[x,-45],[x+90,-45],[x+90,45],[x,45],[x,-45]];
  return corners.slice(1).map((b,i)=>({points:[corners[i],b],width:12,...attributes}));
 };
 const pedestrian=square(30,{parkPath:true});
 const sidewalk=square(-130,{vehicleRoad:false});
 const street=square(150,{});
 const paths=[...pedestrian,...sidewalk,...street];
 const terrain=createWalkSurface(paths,[],[],{center:position,radius:500});
 const encounters=buildEncounters(paths,makeStreetGraph(paths),terrain,position,[],{difficulty:3});
 assert.ok(encounters.some(hazard=>hazard.route));
 assert.ok(encounters.some(hazard=>!hazard.route));
 assert.ok(encounters.every(hazard=>hazard.route?
  hazard.route.points.every(point=>point[0]>145):hazard.point[0]>=150));
 assert.ok(terrain.canTravel([30,-45],[120,-45]));
 assert.ok(terrain.canTravel([-130,-45],[-40,-45]));
});

test('an area without lawns skips sprinkler slots instead of adding more potholes',()=>{
 const hazards=buildEncounters(lines,graph,surface(),position,food,{difficulty:3,traffic:false});
 assert.equal(hazards.filter(hazard=>hazard.kind==='sprinkler').length,0);
 assert.equal(hazards.filter(hazard=>hazard.kind==='pothole').length,7);
});

test('a harder regional wave keeps its safe inner radius and leaves retained encounters in place',()=>{
 const earlier=buildEncounters(lines,graph,surface(),position,food,{traffic:false,allowClosures:false});
 const options={minRange:85,maxRange:270,traffic:false,allowClosures:false,allowCrowds:false,existing:earlier};
 const harder=buildEncounters(lines,graph,surface(),position,food,{...options,difficulty:3});
 assert.ok(harder.length>0);
 assert.ok(harder.filter(hazard=>hazard.kind==='barrier').length<=3);
 for(const hazard of harder){
  const range=distance(hazard.point,position);
  assert.ok(range>85&&range<270);
  assert.equal(!!hazard.works,false);
  assert.notEqual(hazard.kind,'crowd');
  assert.ok(earlier.every(existing=>distance(existing.point,hazard.point)>=18));
 }
 assert.deepEqual(buildEncounters(lines,graph,surface(),position,food,{...options,difficulty:3}),harder);
});

test('a regional wave can introduce a protest and keeps only one nearby',()=>{
 const options={difficulty:3,minRange:100,maxRange:295,traffic:false,allowClosures:false,allowCrowds:true};
 const regional=existing=>buildEncounters(lines,graph,surface(),position,food,{...options,existing})
  .filter(hazard=>hazard.kind==='crowd');
 const [next]=regional([]);
 assert.ok(next);
 assert.ok(distance(next.point,position)>100&&distance(next.point,position)<160);
 assert.equal(regional([next]).length,0);
 const distant={...next,id:'old-crowd',point:[500,0]};
 assert.equal(regional([distant]).length,1);
 assert.deepEqual(mergeRegionEncounters([distant],[next],position,food),[next]);
 const nearby={...distant,point:[-100,0]};
 assert.deepEqual(mergeRegionEncounters([nearby],[next],position,food),[nearby]);
});

test('trash stays on mapped pavement and clear of all carriageways including narrow lanes',()=>{
 const lanes=[...lines,{points:[[-330,11],[330,11]],width:5}];
 const hazards=buildEncounters(lanes,makeStreetGraph(lanes),surface(),position,food,{
  traffic:false,pavementAreas:pavement,
 });
 const bins=hazards.filter(hazard=>hazard.kind==='trash');
 assert.ok(bins.length>=3);
 for(const {point} of bins){
  assert.ok(pavement.some(([ring])=>pointInRing(point,ring)));
  assert.ok(lanes.every(({points:[a,b],width})=>segmentProjection(point,a,b).distance>=width/2+1.6-1e-9));
 }
 assert.ok(buildEncounters(lines,graph,surface(),position,food,{traffic:false})
  .every(hazard=>hazard.kind!=='trash'));
});

test('obstacle footprints, pedestrian crossings and traffic loops stay clear of mapped water',()=>{
 const lake=[[[20,20],[54,20],[54,54],[20,54],[20,20]]];
 const gap=([x,z])=>Math.hypot(Math.max(20-x,0,x-54),Math.max(20-z,0,z-54));
 const options={difficulty:3,greenAreas:parks,pavementAreas:pavement};
 const withoutLake=buildEncounters(lines,graph,surface(),position,food,options);
 assert.ok(withoutLake.some(hazard=>hazard.route?.points.some(point=>gap(point)<3.3)));
 const hazards=buildEncounters(lines,graph,surface(),position,food,{...options,waterAreas:[lake]});
 assert.ok(hazards.some(hazard=>hazard.route));
 function checkRoute(route,margin){
  const steps=Math.ceil(route.length*3);
  for(let i=0;i<=steps;i++)assert.ok(gap(sampleRoute(route,route.length*i/steps).p)>margin-1e-9);
 }
 for(const hazard of hazards){
  if(hazard.route)checkRoute(hazard.route,3.3);
  else if(hazard.kind==='barrier')checkRoute(makeRoute([hazard.a,hazard.b]),hazard.works?5:2);
  else if(hazard.kind==='pedestrian'){
   const [x,z]=hazard.point,dx=Math.cos(hazard.heading)*hazard.width/2,dz=-Math.sin(hazard.heading)*hazard.width/2;
   checkRoute(makeRoute([[x-dx,z-dz],[x+dx,z+dz]]),hazard.radius);
  }else assert.ok(gap(hazard.point)>hazard.radius);
 }
});

test('regional obstacles extend the challenge without moving existing traffic or landing beside the player',()=>{
 const nearby={id:'old-fence',kind:'barrier',point:[99,10]};
 const route={...makeRoute([[300,0],[350,0],[350,50],[300,50],[300,0]]),loop:true};
 const car={id:'bus',kind:'bus',point:[350,0],route,phase:36};
 const old=[nearby,car,{id:'distant-hole',point:[700,0]}];
 const incoming=[
  {id:'too-close',kind:'pothole',point:[70,0]},
  {id:'overlap',kind:'trash',point:[103,12]},
  {id:'under-food',kind:'pothole',point:[110,100]},
  {id:'new-sprinkler',kind:'sprinkler',point:[190,0]},
  {id:'bike-near-curve',kind:'bike',point:[160,80],route:makeRoute([[70,20],[160,80],[70,20]])},
 ];
 const merged=mergeRegionEncounters(old,incoming,[0,0],[{point:[109,101]}]);
 assert.deepEqual(merged.map(item=>item.id),['old-fence','bus','new-sprinkler']);
 assert.equal(merged[1],car);
});
