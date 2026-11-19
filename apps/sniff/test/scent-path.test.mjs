import test from 'node:test';
import assert from 'node:assert/strict';
import {findScentPath,findScentPathAsync,joinScentPath,trailEnvelope} from '../src/scent-path.mjs';
import {createWalkSurface} from '../src/walking.mjs';
import {hazardHits,jumpHeight,JUMP_SECONDS} from '../src/game.mjs';
import {makeRoute} from '../src/streets.mjs';
const surface=()=>createWalkSurface([],[],[],{center:[0,0],radius:100});
test('running and click movement cannot tunnel through a fence, jumping clears a low fence',()=>{const s=surface();s.setBarriers([{a:[-10,0],b:[10,0],radius:1,height:3.6}]);assert.equal(s.canTravel([0,-10],[0,10]),false);assert.ok(s.move([0,-10],[0,1],30)[1]<0);s.setHeight(jumpHeight(JUMP_SECONDS/2));assert.equal(s.canTravel([0,-10],[0,10]),true);s.setHeight(0);assert.equal(s.canStand([0,0]),false);s.setBarriers([]);assert.equal(s.canTravel([0,-10],[0,10]),true);});
test('scent route goes around a closed road and every segment is walkable',()=>{const s=surface();s.setBarriers([{a:[-10,0],b:[10,0],radius:1,height:3.6}]);const path=findScentPath([0,-15],[0,15],s.canStand);assert.ok(path.length>2);assert.ok(path.some(p=>Math.abs(p[0])>10));for(let i=1;i<path.length;i++)assert.ok(s.canTravel(path[i-1],path[i]));});
test('scent route avoids potholes instead of pointing through them',()=>{const s=surface(),safe=p=>s.canStand(p)&&Math.hypot(p[0],p[1])>4;const path=findScentPath([0,-15],[0,15],safe);assert.ok(path.length>2);for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i];for(let u=0;u<=1;u+=.025)assert.ok(safe([a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u]));}});
test('scent route does not cut diagonal building corners or invent a path to a sealed goal',()=>{const s=createWalkSurface([], [{ring:[[-4,-4],[4,-4],[4,4],[-4,4],[-4,-4]]}],[],{center:[0,0],radius:70});assert.deepEqual(findScentPath([-10,0],[0,0],s.canStand),[]);const path=findScentPath([-10,0],[10,0],s.canStand);for(let i=1;i<path.length;i++)assert.ok(s.canTravel(path[i-1],path[i]));});
test('sniff trail draws outward then fades to zero without persisting',()=>{assert.equal(trailEnvelope(4).draw,0);assert.equal(trailEnvelope(2).draw,1);assert.ok(trailEnvelope(.4).opacity<trailEnvelope(2).opacity);assert.equal(trailEnvelope(0).opacity,0);});
test('jump arc starts and lands at ground, clears small hazards but never traffic or crowds',()=>{assert.ok(Math.abs(jumpHeight(JUMP_SECONDS))<1e-8);assert.equal(jumpHeight(0),0);assert.equal(jumpHeight(JUMP_SECONDS-.48),5.6);for(const kind of ['poop','pothole']){const hazards=[{kind,point:[0,0]}];assert.equal(hazardHits(hazards,[0,0],0),true);assert.equal(hazardHits(hazards,[0,0],0,5),false);}assert.equal(hazardHits([{kind:'crowd',point:[0,0],radius:5.5}],[0,0],0,5),true);for(const kind of ['car','bus'])assert.equal(hazardHits([{kind,point:[0,0],route:makeRoute([[0,0],[0,30]]),phase:0,speed:2}],[0,0],0,5),true);});

test('a sliced search keeps the same detour and honors cancellation',async()=>{
 const start=[0,0],goal=[20,0];
 const walkable=([x,z])=>x<8||x>12||Math.abs(z)>5;
 const options={step:1.25};
 const normal=findScentPath(start,goal,walkable,options);
 assert.ok(normal.some(([,z])=>Math.abs(z)>5));
 assert.deepEqual(await findScentPathAsync(start,goal,walkable,options),normal);
 assert.deepEqual(await findScentPathAsync(start,goal,walkable,options,()=>false),[]);
});

test('a nearby destination across a long city block has a walkable detour',async()=>{
 const block={ring:[[-10,-85],[10,-85],[10,85],[-10,85],[-10,-85]]};
 const surface=createWalkSurface([],[block],[],{center:[0,0],radius:250});
 const start=[-30,0],goal=[30,0],options={step:1.25,maxVisited:12500,sampleStep:.20};
 assert.deepEqual(findScentPath(start,goal,surface.canStand,{...options,padding:55}),[]);
 const path=await findScentPathAsync(start,goal,surface.canStand,options);
 assert.deepEqual(path[0],start);
 assert.deepEqual(path.at(-1),goal);
 assert.ok(path.some(([,z])=>Math.abs(z)>85));
 for(let index=1;index<path.length;index++)assert.ok(surface.canTravel(path[index-1],path[index]));
});

test('a running dog can rejoin a scent trail between distant waypoints',()=>{
 const path=[[0,0],[100,0],[100,20]],position=[50,8];
 assert.deepEqual(joinScentPath(path,position,()=>true),[position,[50,0],[100,0],[100,20]]);
 assert.deepEqual(joinScentPath(path,position,()=>false),[]);
});
