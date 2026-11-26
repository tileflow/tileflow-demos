import assert from 'node:assert/strict';
import test from 'node:test';
import {blockingBuildings, indexBuildingFaces, separateRanges} from '../src/building-occlusion.js';

function wallMesh(walls) {
  const bytes = new Uint8Array(walls.length * 4 * 28);
  const data = new DataView(bytes.buffer);
  const indices = [];
  for (const [i, {id, x, from, to, base = 0, top = 60, centre = [0, 0]}] of walls.entries()) {
    const first = i * 4;
    for (const [j, [y, raised]] of [
      [from, 0],
      [to, 0],
      [to, 1],
      [from, 1],
    ].entries()) {
      const o = (first + j) * 28;
      data.setUint16(o, x, true);
      data.setUint16(o + 2, y, true);
      data.setUint16(o + 4, base, true);
      data.setUint16(o + 6, top, true);
      data.setUint8(o + 10, raised);
      data.setUint16(o + 16, centre[0], true);
      data.setUint16(o + 18, centre[1], true);
      data.setUint16(o + 24, id, true);
    }
    for (const index of [0, 1, 2, 0, 2, 3]) indices.push(first + index);
  }
  return indexBuildingFaces(bytes, new Uint16Array(indices));
}

const ray = (y, z = 25) => [{origin: [0, y, z], direction: [10, 0, 0]}];

test('a bus sightline hits only faces between the camera and the bus', () => {
  const mesh = wallMesh([
    {id: 1, x: 5, from: 1, to: 20},
    {id: 2, x: 12, from: 1, to: 20},
    {id: 3, x: 8, from: 1, to: 20, base: 35},
    {id: 4, x: 3, from: 30, to: 40},
  ]);
  assert.deepEqual(
    blockingBuildings(mesh, ray(10)).map((b) => b.id),
    [1],
  );
  assert.deepEqual(blockingBuildings(mesh, ray(10, 90)), []);
});

test('a gap in one building stays visible even when its box crosses the ray', () => {
  const mesh = wallMesh([
    {id: 7, x: 5, from: 1, to: 8},
    {id: 7, x: 5, from: 12, to: 20},
  ]);
  assert.deepEqual(blockingBuildings(mesh, ray(10)), []);
  assert.equal(blockingBuildings(mesh, ray(16))[0].id, 7);
});

test('only visible triangles of an intercepted building leave the opaque pass', () => {
  const mesh = wallMesh([
    {id: 1, x: 4, from: 30, to: 40},
    {id: 2, x: 5, from: 1, to: 8},
    {id: 3, x: 6, from: 30, to: 40},
    {id: 2, x: 7, from: 1, to: 8},
  ]);
  const visible = [
    {from: 3, count: 12},
    {from: 18, count: 3},
  ];
  assert.deepEqual(separateRanges(visible, blockingBuildings(mesh, ray(4))), {
    solid: [
      {from: 3, count: 3},
      {from: 12, count: 3},
    ],
    glass: [
      {from: 6, count: 6},
      {from: 18, count: 3},
    ],
  });
  assert.deepEqual(separateRanges(visible, []), {solid: visible, glass: []});
});

test('separate houses in one Streets MultiPolygon feature do not share opacity', () => {
  const mesh = wallMesh([
    {id: 3, x: 5, from: 1, to: 9, centre: [5, 5]},
    {id: 3, x: 5, from: 20, to: 30, centre: [5, 25]},
  ]);
  const blocked = blockingBuildings(mesh, ray(4));
  assert.equal(mesh.buildings.size, 2);
  assert.equal(blocked.length, 1);
  assert.deepEqual(separateRanges([{from: 0, count: 12}], blocked), {
    solid: [{from: 6, count: 6}],
    glass: [{from: 0, count: 6}],
  });
});
