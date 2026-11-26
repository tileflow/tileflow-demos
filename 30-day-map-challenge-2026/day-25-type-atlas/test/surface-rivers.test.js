import assert from 'node:assert/strict';
import test from 'node:test';
import {surfaceRiverRuns} from '../src/surface-rivers.js';

// Label geometries can lack the structure attributes present on the waterway.
const culvert = {geometry: {type:'LineString',coordinates:[[45,30],[80,30]]}};
const split = surfaceRiverRuns({querySourceFeatures:()=>[culvert]}, point=>point, {w:200,h:150});

test('a culvert suppresses only the covered part of its label',()=>{
  assert.deepEqual(split([[45,30],[80,30]]),[]);
  const runs=split([[0,30],[125,30]]);
  assert.equal(runs.length,2);
  assert.deepEqual(runs[0][0],[0,30]);
  assert.deepEqual(runs[1].at(-1),[125,30]);
  assert.ok(runs[0].at(-1)[0]>=38 && runs[0].at(-1)[0]<=48);
  assert.ok(runs[1][0][0]>=77 && runs[1][0][0]<=87);
});

test('a surface river stays continuous when it crosses or passes beside a culvert',()=>{
  for(const river of [[[60,0],[60,100]],[[0,42],[130,42]]]){
    assert.deepEqual(split(river),[river]);
  }
});
