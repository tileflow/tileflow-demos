import assert from 'node:assert/strict';
import test from 'node:test';
import {appendFleetTrail, fleetLightLayers} from '../src/fleet-lights.js';
import {distance} from '../src/route-track.js';

const length = line => line.slice(1).reduce((sum, p, i) => sum + distance(line[i], p), 0);
const state = {punctuality: 'on-time', ink: 1, stale: false, secondary: false};

test('fleet trail bands follow the road and fade by distance even with uneven or repeated fixes', () => {
  const a = [24.95, 60.18], b = [24.9501, 60.18], c = [24.9501, 60.181];
  const road = [a, a, b, c];
  const features = [], groups = new Map();
  appendFleetTrail(features, [a, a], state, groups);
  assert.equal(features.length, 0);
  appendFleetTrail(features, road, state, groups);
  const parts = features.map(f => f.geometry.coordinates[0]);
  assert.equal(parts.length, 4);
  assert.deepEqual(parts[0][0], a);
  assert.deepEqual(parts.at(-1).at(-1), c);
  assert.ok(parts[0].some(p => p === b));
  for (const [i, part] of parts.entries()) {
    assert.ok(Math.abs(length(part) - length(road) / 4) < .01);
    if (i > 0) {
      assert.deepEqual(parts[i - 1].at(-1), part[0]);
      assert.ok(features[i].properties.trailAlpha > features[i - 1].properties.trailAlpha);
    }
  }
});

test('fleet lines with the same appearance share features without joining buses across streets', () => {
  const features = [], groups = new Map();
  const a = [[24.95, 60.18], [24.96, 60.18]];
  const b = [[24.96, 60.19], [24.97, 60.19]];
  appendFleetTrail(features, a, state, groups);
  appendFleetTrail(features, b, {...state, ink: 2, punctuality: 'early'}, groups);
  assert.equal(features.length, 4);
  assert.deepEqual(features[0].geometry.coordinates.map(line => line[0]), [a[0], b[0]]);
  appendFleetTrail(features, a, {...state, stale: true}, groups);
  appendFleetTrail(features, b, {ink: 3, secondary: false, stale: false}, groups);
  assert.equal(features.length, 12);
  assert.equal(features[8].properties.ink, 3);
  assert.equal('punctuality' in features[8].properties, false);
  for (const period of ['day', 'night']) {
    const trails = fleetLightLayers(period).filter(layer => layer.type === 'line');
    assert.equal(trails.length, 1);
    assert.equal('line-gradient' in trails[0].paint, false);
  }
});

test('a selected line shares its trail bands across delay states and stays separate from other lines', () => {
  const features = [], groups = new Map();
  const road = [[24.95, 60.18], [24.951, 60.181]];
  appendFleetTrail(features, road, {...state, sameLine: true}, groups);
  appendFleetTrail(features, road, {...state, sameLine: true, punctuality: 'very-late'}, groups);
  appendFleetTrail(features, road, state, groups);
  assert.equal(features.length, 8);
  for (const band of features.slice(0, 4)) {
    assert.equal(band.properties.ink, state.ink);
    assert.equal(band.properties.sameLine, true);
    assert.equal(band.geometry.coordinates.length, 2);
  }
  assert.equal(features[4].properties.punctuality, state.punctuality);
});
