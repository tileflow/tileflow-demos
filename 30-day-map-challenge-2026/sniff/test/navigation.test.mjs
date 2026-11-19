import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeGraph,nearest,shortestPath,makeRoute,sampleRoute,toLocal,toLngLat,distance} from '../src/streets.mjs';
const streetData=JSON.parse(fs.readFileSync(new URL('../public/streets.json',import.meta.url)));
const hood=JSON.parse(fs.readFileSync(new URL('../public/neighbourhood.json',import.meta.url)));
const graph=makeGraph(streetData),start=nearest(graph,toLocal([-3.7015,40.41472]));
test('every featured real business is attached to a building and reachable on the street graph',()=>{
 for(const name of ['La Rosaleda','Brown Bear Bakery','Feliz Coffee','Lamucca de Prado','Room Mate Alicia Hotel']){
  const poi=hood.pois.find(p=>p.name===name&&p.buildingId);assert.ok(poi,name);assert.ok(hood.buildings.some(b=>b.id===poi.buildingId));
  const target=nearest(graph,toLocal(poi.coordinate));const route=shortestPath(graph,start.id,target.id);assert.ok(route.length>1,name);
  for(let i=1;i<route.length;i++)assert.ok(graph.nodes.get(route[i-1]).links.some(l=>l.id===route[i]),`${name}: route must follow a mapped street`);
 }
});
test('cinematic interpolation never cuts across a corner or overshoots an endpoint',()=>{
 const route=makeRoute([[0,0],[10,0],[10,10]]);
 assert.deepEqual(sampleRoute(route,-20).p,[0,0]);assert.deepEqual(sampleRoute(route,100).p,[10,10]);
 for(let t=0;t<=20;t+=.125){const p=sampleRoute(route,t).p;assert.ok(p[1]===0||p[0]===10);}
});
test('coordinate conversion preserves street locations',()=>{
 for(const p of [[-3.7015,40.41472],[-3.6988408,40.4141749]])assert.ok(distance(p,toLngLat(toLocal(p)))<1e-10);
});
test('every coloured building has traceable POI evidence and a unique identity',()=>{
 const ids=new Set();for(const b of hood.buildings){assert.ok(!ids.has(b.id));ids.add(b.id);assert.ok(b.height>0&&b.height<=65);if(b.category)assert.ok(b.pois.some(p=>p.category===b.category));}
});
