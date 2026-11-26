import test from 'node:test';
import assert from 'node:assert/strict';
import {atOffset, distance, mappedSections, routePose, routePreview, routeTrack} from '../src/route-track.js';
import {move, samplePose} from '../src/transit.js';

const xy = (x, y) => [24.9 + x / 55315, 60.17 + y / 111195];
const fix = (coordinate, bearing, timestamp) => ({key: 'trip', coordinate, bearing, speed: 7, timestamp});
const ring = Array.from({length: 13}, (_, i) => xy(18 * Math.cos(i * Math.PI / 12), 18 * Math.sin(i * Math.PI / 12)));

test('sparse fixes, steering and previews follow the directed ring even if street tiles suggest a shortcut', () => {
  const track = routeTrack([xy(28, -16), ...ring, xy(-28, -16)], [[1, 13]]);
  const road = {track, pattern: {}};
  const first = move(null, fix(ring[0], 0, 10), 1000, road);
  const next = move(first, fix(ring.at(-1), 180, 18), 9000, road);
  assert.equal(next.track, track);
  const centre = xy(0, 0);
  const align = () => ({coordinate: centre, uncertain: true});
  for (let t = 0; t <= 1; t += 0.01) {
    const pose = samplePose(next, next.started + next.duration * t, align);
    assert(!pose.uncertain);
    assert(distance(centre, pose.coordinate) > 17.7);
  }
  const midpoint = samplePose(next, next.started + next.duration / 2, align);
  assert(distance(midpoint.coordinate, ring[6]) < .2);
  assert(Math.abs(midpoint.bearing - 270) < 2);
  const preview = routePreview(track, track.offsets[1], track.offsets[13] - track.offsets[1], align);
  assert(preview.length >= ring.length);
  assert(preview.every(point => distance(centre, point) > 17.7));
});

test('an unverified crossing breaks the drawn line and keeps the bus at its reported GPS fix', () => {
  const track = routeTrack([xy(0, 0), xy(20, 0), xy(80, 0), xy(100, 0)], undefined, [[32, 61]]);
  const parts = mappedSections(track);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].at(-1), atOffset(track, 32));
  assert.deepEqual(parts[1][0], atOffset(track, 61));
  assert.deepEqual(mappedSections(track, 40, 55), []);
  const last = fix(xy(52, 4), 90, 10);
  const bus = move(null, last, 1000, {track, pattern: {}});
  assert.deepEqual(samplePose(bus, 1000), {coordinate: last.coordinate, bearing: 90, uncertain: true});
  assert(routePose(track, 50).uncertain);
  assert(routePreview(track, 22, 55).every(p => distance(track.line[0], p) <= 32));
});
