import test from 'node:test';import assert from 'node:assert/strict';
import {createRound,chooseTasting,hazardHits,selectStreetObjects,nearestKnownIngredient,sniffRadius,sprinklerCycle,pedestrianCycle,hazardContact,hazardPosition,HARD_CLOCK} from '../src/game.mjs';
const slots=[{id:1,kind:'bread',point:[20,0]},{id:2,kind:'coffee',point:[50,0]},{id:3,kind:'food',point:[80,0]}];
test('a round lasts sixty active seconds and ends once',()=>{const r=createRound();r.start(slots);for(let i=0;i<59;i++)r.tick(1);assert.equal(r.state.status,'playing');assert.equal(r.tick(1)[0].reason,'time');assert.equal(r.state.remaining,0);assert.deepEqual(r.tick(1),[]);});
test('one cloud cannot remove all hearts in consecutive frames',()=>{const r=createRound();r.start(slots);for(let i=0;i<3;i++)r.tick(1);r.tick(.1,{hazard:true});assert.equal(r.state.health,2);for(let i=0;i<60;i++)r.tick(1/60,{hazard:true});assert.equal(r.state.health,2);});
test('a tasting awards one collection per building and a clean bonus star',()=>{const r=createRound();r.start(slots);r.pickup(slots[0]);assert.deepEqual(r.pickup(slots[0]),[]);r.pickup(slots[1]);const events=r.pickup(slots[2]);assert.equal(events.at(-1).type,'tasting');assert.equal(r.state.stars,2);assert.equal(r.state.tastings,1);assert.equal(r.state.score,900);});
test('rest needs three uninterrupted safe seconds',()=>{const r=createRound();r.start(slots);r.state.health=2;r.tick(1,{sitting:true});r.tick(1,{sitting:true,hazard:true});assert.equal(r.state.rest,0);for(let i=0;i<3;i++)r.tick(1,{sitting:true});assert.equal(r.state.health,3);assert.equal(r.state.rest,0);});
test('sparse neighbourhood tastings use available reachable categories without invented POIs',()=>{const candidates=[slots[0],{id:4,kind:'food',point:[30,0]},{id:5,kind:'food',point:[600,0]},slots[1]];const selected=chooseTasting(candidates,[0,0],new Set([1]),c=>c.id!==2);assert.deepEqual(selected.map(c=>c.id),[4]);});
test('poop collisions use physical range',()=>{const h=[{kind:'poop',point:[0,0]}];assert.equal(hazardHits(h,[3,0],0),true);assert.equal(hazardHits(h,[5,0],0),false);});

import {category,matchBuildingEntrances} from '../src/world-data.mjs';
test('generalised bakery businesses retain bread while landmarks are not food',()=>{assert.equal(category({class:'food-drink',type:'cafe',icon:'cafe',name:'Brown Bear Bakery'}),'bread');assert.equal(category({class:'retail',type:'specialty_store',name:'Panadería del Río'}),'bread');assert.equal(category({class:'landmark',type:'monument',name:'Antigua pasteleria del Pozo'}),null);});
test('starting again resets collected objects, health and elapsed time',()=>{const r=createRound();r.start(slots);r.pickup(slots[0]);r.state.health=1;r.tick(1);r.start(slots);assert.equal(r.state.health,3);assert.equal(r.state.remaining,60);assert.equal(r.state.collected.size,0);assert.equal(r.pickup(slots[0])[0].type,'pickup');});

test('any matching street object fills the next slot, not a hidden business ID',()=>{const r=createRound();r.start(slots);const e=r.pickup({id:99,kind:'coffee',point:[1,2]})[0];assert.equal(e.type,'pickup');assert.equal(e.index,1);assert.equal(e.slotId,2);assert.equal(r.state.slots[1].done,true);assert.equal(r.state.slots[0].done,false);});
test('extra food is harmless, gives no points and preserves the combo and timer',()=>{const r=createRound();r.start(slots);r.pickup(slots[0]);r.pickup(slots[1]);const score=r.state.score,combo=r.state.combo;const extra={id:44,kind:'coffee',point:[0,0]};assert.deepEqual(r.pickup(extra),[]);assert.equal(r.state.collected.has(extra.id),false);assert.equal(r.state.remaining,60);assert.equal(r.state.health,3);assert.equal(r.state.combo,combo);assert.equal(r.state.score,score);assert.equal(r.state.tastingDamage,false);assert.deepEqual(r.pickup(extra),[]);});
test('unneeded food cannot end a round even with one second left',()=>{const r=createRound();r.start([slots[0]]);r.state.remaining=1;assert.deepEqual(r.pickup(slots[1]),[]);assert.equal(r.state.remaining,1);assert.equal(r.state.status,'playing');});
test('repeated categories fill separately; the celebration is protected from accidental pickups',()=>{const r=createRound();r.start([slots[1],{...slots[1],id:10}]);r.pickup(slots[1]);assert.equal(r.pickup({...slots[1],id:11})[0].type,'pickup');assert.equal(r.state.tastings,1);assert.deepEqual(r.pickup(slots[0]),[]);assert.equal(r.state.remaining,53);});
test('remaining seated heals repeatedly and movement cancels unfinished progress',()=>{const r=createRound();r.start(slots);r.state.health=1;r.tick(1,{sitting:true});r.tick(.5,{moving:true});assert.equal(r.state.rest,0);for(let i=0;i<6;i++)r.tick(1,{sitting:true});assert.equal(r.state.health,3);r.tick(1,{sitting:true});assert.equal(r.state.health,3);assert.equal(r.state.rest,0);});
test('street items have room to dodge and sparse bakery objects are retained',()=>{const pool=[{id:1,kind:'food',point:[0,0]},{id:2,kind:'bread',point:[2,0]},{id:3,kind:'coffee',point:[20,0]},{id:4,kind:'food',point:[35,0]}];const selected=selectStreetObjects(pool);assert.ok(selected.some(i=>i.id===2));assert.ok(!selected.some(i=>i.id===1));for(const a of selected)for(const b of selected)if(a!==b)assert.ok(Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1])>=34);});
test('the compass never reveals food hidden by fog or already collected kinds',()=>{const items=[{id:9,kind:'bread',point:[5,0]},{id:8,kind:'coffee',point:[20,0]},{id:7,kind:'coffee',point:[60,0]}];const order=[{...slots[0],done:true},{...slots[1],done:false}];assert.equal(nearestKnownIngredient(items,order,new Set(),[0,0],p=>p[0]>30).id,7);assert.equal(nearestKnownIngredient(items,order,new Set([7]),[0,0],p=>p[0]>30),undefined);});
test('sniff briefly opens a wider field',()=>{assert.equal(sniffRadius(4),42);assert.ok(sniffRadius(3.3)>42&&sniffRadius(3.3)<100);assert.equal(sniffRadius(2.6),100);assert.equal(sniffRadius(0),42);});

test('damage stuns briefly, then leaves escape time, and free roam clears a final stun',()=>{const r=createRound();r.start(slots);for(let i=0;i<3;i++)r.tick(1);r.tick(.1,{hazard:true});assert.equal(r.state.stun,1);r.tick(.5);assert.equal(r.state.stun,.5);r.tick(.5);assert.equal(r.state.stun,0);assert.ok(r.state.invulnerable>0);r.state.stun=1;r.stop();assert.equal(r.state.stun,0);});

test('the next tasting preserves collected dishes and varies nearby targets',()=>{
 const round=createRound();round.start(slots.slice(0,2));
 round.pickup(slots[0]);round.pickup(slots[1]);
 const near=[...slots,{id:4,kind:'food',point:[107,0]},{id:5,kind:'pizza',point:[137,0]}];
 const next=chooseTasting(near,[50,0],round.state.collected,()=>true);
 assert.deepEqual(next.map(item=>item.kind),['food','pizza']);
 round.setTasting(next);
 assert.deepEqual([...round.state.collected],[1,2]);
 assert.deepEqual(round.pickup(slots[0]),[]);
 assert.equal(round.pickup(next[0])[0].type,'pickup');
});
test('mapped eatery details identify new dishes without turning florists into pickups',()=>{
 assert.equal(category({type:'restaurant',cuisine:'pizza',name:'Classico'}),'pizza');
 assert.equal(category({type:'restaurant',name:'さくらラーメン'}),'ramen');
 assert.equal(category({type:'fast_food'}),'food');
 assert.equal(category({type:'fast_food',cuisine:'burger'}),'burger');
 assert.equal(category({type:'ice_cream'}),'iceCream');
 assert.equal(category({type:'florist'}),null);
});
test('mapped entrances join nearby business façades while shared walls stay ambiguous',()=>{
 const building=(id,x1,x2,hasVenue=true)=>({
  id,min:[x1,0],max:[x2,8],ring:[[x1,0],[x2,0],[x2,8],[x1,8],[x1,0]],
  pois:hasVenue?[{id}]:[],
 });
 const businesses=[building(1,0,12),building(2,12,20),building(3,24,34,false)];
 const points=[[5,.25],[5.03,.26],[12,3],[20,4],[30,.01],[500,500]];
 assert.deepEqual([...matchBuildingEntrances(points,businesses)],[[1,[[5,.25]]],[2,[[20,4]]]]);
});

test('each required bite refills the clock without rewinding traffic time',()=>{
 const round=createRound();
 round.start(slots);
 round.tick(1);
 round.tick(1);
 round.pickup({id:99,kind:'pizza',point:[0,0]});
 assert.equal(round.state.remaining,58);
 round.pickup(slots[0]);
 assert.equal(round.state.remaining,60);
 assert.equal(round.state.elapsed,2);
 round.tick(1);
 round.pickup(slots[1]);
 assert.equal(round.state.remaining,60);
 assert.equal(round.state.elapsed,3);
 round.pickup(slots[2]);
 round.tick(.5,{clockRunning:false});
 assert.equal(round.state.remaining,53);
 assert.equal(round.state.elapsed,3.5);
 assert.deepEqual(round.state.recipes,[['bread','coffee','food']]);
});

test('an expired combo clears before the next pickup scores',()=>{
 const round=createRound();
 round.start(slots);
 round.pickup(slots[0]);
 round.pickup(slots[1]);
 assert.equal(round.state.combo,2);
 for(let second=0;second<12;second++)round.tick(1);
 assert.equal(round.state.combo,0);
 assert.equal(round.pickup(slots[2])[0].points,100);
});

test('food stops already placed near the player survive a region refresh',()=>{
 const bread={id:1,kind:'bread',point:[0,0]};
 const coffee={id:2,kind:'coffee',point:[10,0]};
 const moreBread={id:3,kind:'bread',point:[200,0]};
 const nearby=selectStreetObjects([bread,coffee]);
 assert.deepEqual(nearby,[bread]);
 assert.deepEqual(selectStreetObjects([bread,coffee,moreBread],34,new Set([bread.id])),[bread,moreBread]);
});

test('long rounds shorten each tasting clock to a floor of 28 seconds',()=>{
 const round=createRound();
 round.start(slots.slice(0,1));
 const budgets=[round.state.remaining];
 for(let index=0;index<7;index++){
  const food={...slots[0],id:100+index};
  round.setTasting([food]);
  round.pickup(food);
  budgets.push(round.state.remaining);
 }
 assert.deepEqual(budgets,[60,53,46,39,32,28,28,28]);
});

test('Hard starts at 33 seconds, refills each bite and holds a 20-second floor',()=>{
 const round=createRound(HARD_CLOCK.seconds,HARD_CLOCK);
 round.start(slots.slice(0,2));
 const budgets=[round.state.remaining];
 for(let index=0;index<6;index++){
  const bites=slots.slice(0,2).map((slot,i)=>({...slot,id:10+2*index+i}));
  round.setTasting(bites);
  round.tick(1);
  round.pickup(bites[0]);
  assert.equal(round.state.remaining,budgets.at(-1));
  round.pickup(bites[1]);
  budgets.push(round.state.remaining);
 }
 assert.deepEqual(budgets,[33,29,25,21,20,20,20]);
 const shortRound=createRound(12,HARD_CLOCK);
 shortRound.start(slots.slice(0,1));
 shortRound.pickup(slots[0]);
 assert.equal(shortRound.state.remaining,12);
});

test('the sprinkler telegraphs its pulse and is passable between bursts or in the air',()=>{
 const sprinkler={kind:'sprinkler',point:[0,0],radius:4.8,phase:0};
 assert.deepEqual(sprinklerCycle(sprinkler,.5),{anticipating:true,active:false});
 assert.equal(hazardHits([sprinkler],[1,0],.5),false);
 assert.equal(hazardHits([sprinkler],[1,0],1),true);
 assert.equal(hazardContact([sprinkler],[1,0],1,0,'damage'),undefined);
 assert.equal(hazardContact([sprinkler],[1,0],1,0,'slow').hazard,sprinkler);
 assert.equal(hazardHits([sprinkler],[1,0],1,1.8),false);
 assert.equal(hazardHits([sprinkler],[1,0],3),false);
 assert.equal(hazardHits([{kind:'trash',point:[0,0],radius:4.5}],[1,0],1,6),true);
});

test('a pedestrian crosses a street and only slows the player in the active crossing window',()=>{
 const person={kind:'pedestrian',point:[20,10],heading:0,width:10,radius:1.8,phase:0};
 assert.equal(pedestrianCycle(person,0).anticipating,true);
 assert.deepEqual(hazardPosition(person,0).p,[15,10]);
 assert.deepEqual(hazardPosition(person,4).p,[25,10]);
 const mid=hazardPosition(person,2.4).p;
 assert.equal(hazardContact([person],mid,2.4,0,'slow').hazard,person);
 assert.equal(hazardContact([person],mid,2.4,0,'damage'),undefined);
 assert.equal(hazardContact([person],[25,10],4,0,'slow'),undefined);
});

test('bikes and scooters have a narrower collision footprint than cars',()=>{
 const route={points:[[0,0],[0,20]],cumulative:[0,20],length:20};
 for(const kind of ['bike','scooter']){
  const vehicle={kind,route,speed:1,phase:12};
  assert.ok(hazardContact([vehicle],[0,12],0));
  assert.equal(hazardContact([vehicle],[2,12],0),undefined);
 }
 assert.ok(hazardContact([{kind:'car',route,speed:1,phase:12}],[2,12],0));
});
