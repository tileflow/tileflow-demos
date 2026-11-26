import assert from 'node:assert/strict';
import test from 'node:test';
import {distance, turn} from '../src/route-track.js';
import {tripArrows} from '../src/trip-arrows.js';

const xy = (x, y) => [24.94 + x / 55400, 60.16 + y / 111195];
const box = (left, bottom, right, top) => [...xy(left, bottom), ...xy(right, top)];
const point = f => f.geometry.coordinates;

test('arrows stay on the same corrected trip metres as the camera pans and zooms', () => {
  const sections = [{offsets: [0, 500], coordinates: [xy(0, 4), xy(500, 4)]}];
  const left = tripArrows(sections, box(-10, -10, 210, 10), 16);
  const right = tripArrows(sections, box(175, -10, 420, 10), 16.8);
  assert.deepEqual(left.map(f => f.properties.offset), [50, 100, 150, 200]);
  assert.deepEqual(right[0], left.at(-1));
  const closer = tripArrows(sections, box(175, -10, 420, 10), 17);
  for (const f of right) {
    assert.deepEqual(point(closer.find(a => a.properties.offset === f.properties.offset)), point(f));
    assert.ok(distance(point(f), xy(f.properties.offset, 4)) < .001);
    assert.ok(turn(f.properties.bearing, 90) < .01);
  }
  assert.deepEqual(left.map(f => f.properties.phase), [1, 2, 0, 1]);
});

test('separate sections never interpolate through a gap, even at intermediate zooms', () => {
  const sections = [
    {offsets: [0, 70], coordinates: [xy(0, 0), xy(0, 70)]},
    {offsets: [145, 200], coordinates: [xy(70, 70), xy(70, 15)]},
  ];
  const arrows = tripArrows(sections, box(-5, -5, 80, 80), 18);
  assert.ok(arrows.some(a => a.properties.offset < 70 && turn(a.properties.bearing, 0) < .01));
  assert.ok(arrows.some(a => a.properties.offset > 145 && turn(a.properties.bearing, 180) < .01));
  assert.ok(arrows.every(a => a.properties.offset <= 70 || a.properties.offset >= 145));
});

test('an out-and-back trip interleaves opposite directions along the same street', () => {
  const sections = [{offsets: [0, 250, 500], coordinates: [xy(0, 0), xy(250, 0), xy(0, 0)]}];
  const arrows = tripArrows(sections, box(-1, -10, 251, 10), 17);
  const outbound = arrows.filter(a => turn(a.properties.bearing, 90) < .01);
  const inbound = arrows.filter(a => turn(a.properties.bearing, 270) < .01);
  assert.ok(outbound.length >= 8 && inbound.length >= 8);
  for (const a of inbound) {
    assert.ok(outbound.every(b => distance(point(a), point(b)) > 5));
    assert.ok(distance(point(a), xy(500 - a.properties.offset, 0)) < .02);
  }
});

test('roundabout bearings follow the directed arc through north and round the far side', () => {
  const circle = {coordinates: [], offsets: []};
  const radius = 24;
  for (let i = 0; i <= 72; i++) {
    const t = 2 * Math.PI * i / 72;
    circle.coordinates.push(xy(radius * Math.cos(t), radius * Math.sin(t)));
    circle.offsets.push(radius * t);
  }
  const arrows = tripArrows([circle], box(-30, -30, 30, 30), 19);
  assert.ok(arrows.length > 14);
  for (const a of arrows) {
    assert.ok(Math.abs(distance(point(a), xy(0, 0)) - radius) < .1);
    const expected = (360 - a.properties.offset / radius * 180 / Math.PI) % 360;
    assert.ok(turn(a.properties.bearing, expected) < 5);
  }
});

test('a long visible trip stays bounded and retains arrows through the far end', () => {
  const sections = [{offsets: [0, 10000], coordinates: [xy(0, 0), xy(10000, 0)]}];
  const arrows = tripArrows(sections, box(-1, -1, 10001, 1), 20);
  assert.ok(arrows.length <= 320 && arrows.length > 100);
  assert.ok(arrows.at(-1).properties.offset > 9800);
  assert.deepEqual(tripArrows(sections, box(0, 2000, 1000, 3000), 17), []);
});
