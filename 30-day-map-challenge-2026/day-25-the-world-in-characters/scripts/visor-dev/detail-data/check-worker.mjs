import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';
const worker=new Worker(new URL('./fixture-worker.mjs',import.meta.url));
const messages=[];
worker.on('message',m=>messages.push(m));
const send=m=>worker.postMessage(m);
async function until(pred) {
  for (let i=0;i<400;i++) {
    const match=messages.find(pred);
    if(match)return match;
    await delay(5);
  }
  throw new Error('Timeout in local worker test: '+JSON.stringify(messages));
}
const read=(id,bounds,zoom=3)=>send({type:'read',id,bounds,zoom});
const result=async id=>(await until(m=>m.type==='result'&&m.id===id)).result;
const count=path=>messages.filter(m=>m.type==='transport'&&m.pathname===path).length;
try {
  send({type:'init',catalog:'https://fixture.invalid/tiles.json'});
  const shared=[13,13,13.01,13.01];
  read(1,shared);read(2,shared);
  await until(m=>m.type==='transport'&&m.pathname==='/3/4/3.pbf');
  send({type:'cancel',id:1});
  const ocean=await result(2);
  assert.equal(ocean.tiles,1);assert.equal(ocean.missing,0);assert.equal(ocean.waterFallbackTiles,1);
  assert.equal(ocean.features[0].properties._sourceTile,'2/2/1');assert.equal(count('/3/4/3.pbf'),1);assert.equal(count('/tiles.json'),1);
  assert.ok(!messages.some(m=>m.type==='result' && m.id===1));
  read(3,shared);
  assert.equal((await result(3)).cachedTiles,1);assert.equal(count('/2/2/1.pbf'),1);
  // Cancel the only subscriber, then start again at immediately adjacent longitude.
  const other=[-13,15,-12.9,15.1];
  read(4,other);
  await until(m=>m.type==='transport'&&m.pathname==='/3/3/3.pbf');
  send({type:'cancel',id:4});read(5,other);
  const recovered=await result(5);assert.equal(recovered.features[0].properties.class,'ocean');
  assert.equal(count('/3/3/3.pbf'),1);
  assert.ok(!messages.some(m=>m.type==='result' && m.id===4));
  // A genuinely abandoned request still releases its transport; no replacement view adopts it.
  read(6,[-75,15,-74.9,15.1]);
  await until(m=>m.type==='transport'&&m.pathname==='/3/2/3.pbf');
  send({type:'cancel',id:6});await until(m=>m.type==='transportAbort');
  assert.ok(!messages.some(m=>m.type==='result'&&m.id===6));
  console.log('Verified MVT geometry, freshness, shared concurrent fetch, sequential camera handoff, actual abandonment, and sparse ocean inheritance.');
} finally {await worker.terminate();}
