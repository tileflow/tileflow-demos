import test from 'node:test';
import assert from 'node:assert/strict';
import {createExploration,safeCameraPitch,advanceSniffBoost} from '../src/exploration.mjs';

test('exploration colours only the visited neighbourhood and persists after walking away',()=>{
 const map=createExploration();map.reveal(0,0,46);assert.equal(map.sample(0,0),1);assert.equal(map.sample(100,0),0);
 const edge=map.sample(40,0);assert.ok(edge>0&&edge<1,'the reveal edge is feathered');
 map.reveal(170,-30,46);assert.equal(map.sample(170,-30),1);assert.equal(map.sample(0,0),1);assert.equal(map.sample(85,0),0);
 map.reset();assert.equal(map.sample(0,0),0);assert.equal(map.sample(170,-30),0);
});

test('super sniff extends the field without erasing previous discoveries',()=>{
 const map=createExploration();map.reveal(0,0,46);assert.equal(map.sample(70,0),0);map.reveal(0,0,100);const revealed=map.sample(70,0);assert.ok(revealed>.9);map.reveal(0,0,46);assert.equal(map.sample(70,0),revealed);
});

test('a held sniff widens the persistent map brush around every side of the dog',()=>{
 const map=createExploration(),base=36,ring=[[47,0],[-47,0],[0,47],[0,-47]];
 map.reveal(0,0,base);
 assert.ok(ring.every(([x,z])=>map.sample(x,z)===0));
 const first=advanceSniffBoost(0,.05,true,true);
 assert.ok(first>0&&first<20,'the brush opens gradually');
 const held=advanceSniffBoost(first,1.9,true,true);
 assert.ok(held>advanceSniffBoost(0,1.95,true,false),'holding reaches further than a tap');
 map.reveal(0,0,base+held);
 const coloured=map.sample(47,0);
 assert.ok(coloured>.4&&ring.every(([x,z])=>map.sample(x,z)===coloured));
 assert.equal(map.sample(66,0),0);
 map.reveal(12,0,base+held);
 const extended=map.sample(65,0);
 assert.ok(extended>0,'walking while sniffing colours more ground');
 map.reveal(78,0,base+advanceSniffBoost(held,2,false,false));
 assert.equal(map.sample(-47,0),coloured,'releasing sniff does not erase the map');
});

test('camera tilts above a blocking roof and stays angled when the street is clear',()=>{
 const building={center:[0,16],height:24,ring:[[-8,10],[8,10],[8,22],[-8,22],[-8,10]]};
 const blocked=safeCameraPitch([0,0],0,[building]);assert.ok(blocked<20);assert.ok(3+10/Math.tan(blocked*Math.PI/180)>building.height,'the sightline clears the roof');
 assert.equal(safeCameraPitch([0,0],180,[building]),47);assert.equal(safeCameraPitch([0,0],90,[building]),47);
});

test('camera handles a close tall building without relying on x-ray rendering',()=>{
 const building={center:[0,7],height:65,ring:[[-8,2],[8,2],[8,12],[-8,12],[-8,2]]};
 const pitch=safeCameraPitch([0,0],0,[building]);assert.ok(pitch<1);assert.ok(Number.isFinite(pitch));
});
