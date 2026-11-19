import assert from 'node:assert/strict';
import test from 'node:test';
import {createVenueNodeLookup} from '../src/venue-placement.ts';

test('nearby venues share walkability checks and retain the twelve closest usable nodes', () => {
  const nodes = Array.from({length: 20}, (_, i) => ({id: String(i), p: [i, 0]}));
  const blocked = new Set([0, 3, 5]);
  const checked = [];
  const lookup = createVenueNodeLookup(nodes, ([x]) => {
    checked.push(x);
    return !blocked.has(x);
  });

  const expected = nodes.filter(node => !blocked.has(node.p[0])).slice(0, 12);
  assert.deepEqual(lookup([0, 0]), expected);
  assert.deepEqual(lookup([0, 1]), expected);
  assert.equal(new Set(checked).size, checked.length);
  assert.equal(checked.length, 15);

  blocked.clear();
  const refreshed = createVenueNodeLookup(nodes, ([x]) => !blocked.has(x));
  assert.deepEqual(refreshed([0, 0]), nodes.slice(0, 12));
});

test('equidistant nodes keep grid traversal order and the 100 metre boundary is exclusive', () => {
  const nodes = [
    {id: 'east', p: [2, 0]},
    {id: 'west', p: [-2, 0]},
    {id: 'boundary', p: [-100, 0]},
    {id: 'inside', p: [99.9, 0]},
  ];
  const lookup = createVenueNodeLookup(nodes, () => true);
  assert.deepEqual(lookup([0, 0]).map(node => node.id), ['west', 'east', 'inside']);
  assert.deepEqual(lookup([400, 900]), []);
});
