import test from 'node:test';import assert from 'node:assert/strict';
import {createMovement} from '../src/movement.mjs';
import {createWalkSurface} from '../src/walking.mjs';
import {jumpPose,jumpHeight,JUMP_SECONDS,hazardPosition,hazardContact,selectStreetObjects} from '../src/game.mjs';
import {collectTrafficCircuits} from '../src/traffic.mjs';
import {distance,makeRoute} from '../src/streets.mjs';
import {makeStreetGraph} from '../src/network.mjs';
import {buildEncounters} from '../src/encounters.mjs';
import {findScentPath} from '../src/scent-path.mjs';
const ground=()=>createWalkSurface([],[],[],{center:[0,0],radius:1000});
function simulate(input,fps=60){const motion=createMovement(),surface=ground();let p=[0,0];for(let i=0;i<fps;i++)p=motion.step(1/fps,input,24,p,surface).position;return p;}
test('diagonals and straight inputs run equally fast in every direction',()=>{const distance=p=>Math.hypot(...p),reference=distance(simulate([1,0]));for(const input of [[0,1],[1,1],[-1,1],[-1,-1],[1,-1]])assert.ok(Math.abs(distance(simulate(input))-reference)<1e-8);});
test('30 and 60 fps input cover the same ground with an eased start',()=>{const a=simulate([-1,1],30),b=simulate([-1,1],60);assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-7);assert.ok(Math.hypot(...a)>18);});
test('reversing direction responds within a tenth of a second; reset clears momentum',()=>{const m=createMovement(),s=ground();let p=[0,0];for(let i=0;i<60;i++)p=m.step(1/60,[1,0],0,p,s).position;const start=p[0];for(let i=0;i<6;i++)p=m.step(1/60,[-1,0],0,p,s).position;assert.ok(p[0]<start);m.reset();assert.deepEqual(m.step(1/60,[0,0],0,p,s).position,p);});
test('jump has anticipation, a true airborne arc, and grounded landing compression',()=>{assert.equal(jumpHeight(JUMP_SECONDS-.05),0);assert.ok(jumpPose(JUMP_SECONDS-.05).anticipate>0);assert.ok(jumpHeight(JUMP_SECONDS-.48)>5);assert.equal(jumpHeight(.1),0);assert.ok(jumpPose(.1).landing>0);assert.equal(jumpHeight(0),0);});
test('landing on a fence recovers to a nearby walkable side instead of trapping the dog',()=>{const s=ground();s.setBarriers([{a:[-6,0],b:[6,0],height:3.6,radius:1.1}]);s.setHeight(0);const p=s.settle([0,0]);assert.ok(s.canStand(p));assert.ok(Math.hypot(...p)<3);});
test('restaurant-dense streets do not fill with plates while scarce bread is preserved',()=>{const pool=Array.from({length:20},(_,i)=>({id:i,kind:'food',point:[i*12,0]}));pool.push({id:99,kind:'bread',point:[2,0]});const items=selectStreetObjects(pool),plates=items.filter(i=>i.kind==='food');assert.ok(items.some(i=>i.kind==='bread'));assert.ok(plates.length<=4);for(let i=1;i<plates.length;i++)assert.ok(Math.abs(plates[i].point[0]-plates[i-1].point[0])>=90);});
test('vehicle circuits close on mapped ground roads, ignoring spurs and grade-separated shortcuts',()=>{
 const points=[[0,0],[70,0],[70,70],[0,70],[0,0]];
 const lines=points.slice(1).map((p,i)=>({points:[points[i],p],width:11,grade:0}));
 lines.push({points:[[70,70],[100,90]],width:11,grade:0},{points:[[70,0],[0,70]],width:16,grade:1});
 const circuits=collectTrafficCircuits(lines,ground(),[-24,26]);
 assert.equal(circuits.length,1);
 const route=circuits[0].route;
 assert.equal(route.loop,true);
 assert.deepEqual(route.points[0],route.points.at(-1));
 assert.ok(route.length>250&&route.length<300);
 assert.ok(route.points.every(p=>p[0]<73&&p[1]<73));
 assert.deepEqual(collectTrafficCircuits(lines.slice(0,3),ground(),[-24,26]),[]);
});
test('a circulating car moves and turns continuously across repeated seams',()=>{
 const route={...makeRoute([[0,0],[0,50],[70,50],[70,0],[0,0]]),loop:true};
 const car={kind:'car',speed:10,route,phase:0};
 for(const loop of [1,2,40]){
  const time=loop*route.length/car.speed;
  const before=hazardPosition(car,time-.01),after=hazardPosition(car,time+.01);
  assert.ok(distance(before.p,after.p)<=.2+.00001);
  assert.ok(Math.abs(before.heading-after.heading)<.15);
  assert.ok(hazardContact([car],before.p,time-.01));
  assert.ok(hazardContact([car],after.p,time+.01));
 }
});

test('a full roadwork closure blocks the street and keeps an alternate route to food',()=>{
 const street={width:10,grade:0,points:[[0,0],[0,150]]};
 const sideStreet={width:4,grade:0,points:[[0,15],[52,15],[52,116],[0,116]]};
 const block=(left,right)=>({ring:[[left,22],[right,22],[right,109],[left,109],[left,22]]});
 const buildings=[block(-55,-5),block(5,47)];
 const lines=[street,sideStreet];
 const graph=makeStreetGraph(lines),surface=createWalkSurface(lines,buildings,[],{center:[0,0],radius:1000}),spawn=[0,0];
 const food=[{point:[0,121]}];
 const works=buildEncounters([street],graph,surface,spawn,food).find(hazard=>hazard.works);
 assert.ok(works);
 assert.equal(works.kind,'barrier');
 assert.ok(distance(works.point,spawn)>40);
 surface.setBarriers([works]);
 for(const side of [-4,-2,0,2,4]){
  assert.equal(surface.canTravel([side,works.point[1]-6],[side,works.point[1]+6]),false);
 }
 surface.setHeight(jumpHeight(JUMP_SECONDS-.48));
 assert.equal(surface.canTravel([0,works.point[1]-6],[0,works.point[1]+6]),false);
 surface.setHeight(0);
 const path=findScentPath(spawn,food[0].point,surface.canStand,{step:1.25,maxVisited:12500});
 assert.ok(path.some(([x])=>x>=48),'the trail goes around the block');
 surface.setBarriers([]);
 const noDetour=buildEncounters([street],makeStreetGraph([street]),surface,spawn,food);
 assert.ok(noDetour.some(hazard=>hazard.kind==='barrier'&&!hazard.works&&hazard.height===3.6));
 assert.ok(noDetour.every(hazard=>!hazard.works));
});
