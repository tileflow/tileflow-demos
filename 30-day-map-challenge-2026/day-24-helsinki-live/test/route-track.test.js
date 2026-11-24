import test from 'node:test';
import assert from 'node:assert/strict';
import {
  atOffset,
  distance,
  matchFix,
  routePose,
  routePreview,
  routeTrack,
  shapeAhead,
  splitShape,
  turn,
} from '../src/route-track.js';
import {move, samplePose} from '../src/transit.js';
import {alignCarriageway, carriagewayIndex} from '../src/carriageways.js';

const xy = (x, y) => [24.9 + x / 55315, 60.17 + y / 111195];
const fix = (x, y, bearing, timestamp, stopId = 'B') => ({
  key: 'journey',
  coordinate: xy(x, y),
  bearing,
  timestamp,
  stopId,
  speed: 8,
  status: 2,
});

test('a bus follows a right-angle bend between observed fixes and faces along its axles', () => {
  const track = routeTrack([xy(0, 0), xy(0, 60), xy(60, 60)]);
  const road = {track, pattern: {stops: ['A', 'B'], stopOffsets: [0, track.length]}};
  const a = move(null, fix(2, 45, 0, 12), 0, road);
  const b = move(a, fix(15, 62, 90, 15), 1000, road);
  const mid = samplePose(b, 2500);
  // The rounded centreline passes just inside the corner, equally far from both legs.
  assert(distance(mid.coordinate, xy(1.35, 58.65)) < 0.16);
  assert(mid.bearing > 40 && mid.bearing < 50);
  assert.deepEqual(shapeAhead(track, b.offset).at(-1), xy(60, 60));
});
test('stop order and heading disambiguate the return carriageway even when GPS is closer to the outbound road', () => {
  const track = routeTrack([xy(0, 0), xy(100, 0), xy(100, 10), xy(0, 10)]);
  const p = {stops: ['A', 'B', 'C'], stopOffsets: [0, track.offsets[1], track.length]};
  const offset = matchFix(track, p, fix(45, 2, 270, 12, 'C'));
  assert(offset > track.offsets[2]);
  assert(distance(atOffset(track, offset), xy(45, 10)) < 0.2);
});
test('a stationary GPS jump behind the previous fix does not reverse the model', () => {
  const track = routeTrack([xy(0, 0), xy(200, 0)]);
  const road = {track, pattern: {stops: ['B'], stopOffsets: [200]}};
  const a = move(null, fix(104, 1, 90, 10), 1000, road);
  const b = move(a, {...fix(99, 0, 215, 11), speed: 0}, 2000, road);
  assert.equal(b.offset, a.offset);
});
test('a diversion clears the model and preserves the actual fix without tracing a chord back to the route', () => {
  const track = routeTrack([xy(0, 0), xy(150, 0)]);
  const road = {track, pattern: {}};
  const a = move(null, fix(0, 0, 90, 10), 100, road);
  const b = move(a, fix(50, 50, 90, 13), 200, road);
  assert.equal(b.track, null);
  assert.deepEqual(samplePose(b, 200).coordinate, xy(50, 50));
  const c = move(b, fix(70, 0, 90, 16), 300, road);
  assert(distance(samplePose(c, 300).coordinate, xy(70, 0)) < 0.01);
});
test('Streets refinement excludes footways and opposing one-way traffic, and uses the right-hand side', () => {
  const road = (start, end, cls, oneway) => ({
    geometry: {type: 'LineString', coordinates: [start, end]},
    properties: {class: cls, oneway},
  });
  const cells = carriagewayIndex([
    road(xy(0, 1), xy(100, 1), 'path', false),
    road(xy(100, 2), xy(0, 2), 'primary', true),
    road(xy(0, 6), xy(100, 6), 'primary', true),
  ]);
  assert(
    distance(alignCarriageway(cells, {coordinate: xy(40, 0), bearing: 90}).coordinate, xy(40, 6)) < 0.01,
  );
  const twoWay = carriagewayIndex([road(xy(0, 0), xy(100, 0), 'secondary', false)]);
  assert(
    distance(alignCarriageway(twoWay, {coordinate: xy(40, 1), bearing: 90}).coordinate, xy(40, -1.3)) < 0.01,
  );
  assert(alignCarriageway(twoWay, {coordinate: xy(40, 21), bearing: 90}).uncertain);
});

test('a right-hand turn stays in its two lanes and rotates progressively through the junction', () => {
  const track = routeTrack([xy(0, 0), xy(0, 60), xy(60, 60)]);
  const road = (a, b) => ({
    geometry: {type: 'LineString', coordinates: [a, b]},
    properties: {class: 'secondary'},
  });
  const cells = carriagewayIndex([road(xy(0, 0), xy(0, 72)), road(xy(-10, 60), xy(60, 60))]);
  const align = (p) => alignCarriageway(cells, p);
  let last;
  for (let offset = 48; offset <= 72; offset += 0.25) {
    const pose = routePose(track, offset, align);
    assert(!pose.uncertain);
    if (last) {
      assert(distance(last.coordinate, pose.coordinate) < 0.38);
      assert(turn(last.bearing, pose.bearing) < 4);
    }
    last = pose;
  }
  assert(distance(routePose(track, 48, align).coordinate, xy(1.3, 48)) < 0.12);
  assert(distance(last.coordinate, xy(12, 58.7)) < 0.15);
});

test('a parked bus at a corner ignores small forward GPS jumps with drifting compass readings', () => {
  const track = routeTrack([xy(0, 0), xy(0, 60), xy(-80, 60)]);
  const road = {track, pattern: {}};
  const parked = move(null, {...fix(0, 58, 356, 10), speed: 0}, 1000, road);
  const jitter = move(parked, {...fix(-5, 60, 173, 12), speed: 0}, 3000, road);
  assert.equal(jitter.offset, parked.offset);
  assert.deepEqual(samplePose(jitter, 5000), samplePose(parked, 1000));
});

test('a preview follows the turn, ends at the terminus and stops at uncertain roadway geometry', () => {
  const track = routeTrack([xy(0, 0), xy(0, 60), xy(60, 60)]);
  const path = routePreview(track, 40, 100);
  assert.deepEqual(path[0], routePose(track, 40).coordinate);
  assert.deepEqual(path.at(-1), track.line.at(-1));
  assert(path.some((p) => distance(p, xy(1.35, 58.65)) < 0.2));
  const trimmed = routePreview(track, 40, 100, (p) => ({...p, uncertain: p.coordinate[0] > xy(20, 60)[0]}));
  assert(trimmed.length < path.length);
  assert.deepEqual(routePreview(track, track.length, 100), []);
});

test('a discrete road-tile offset changes smoothly in position and heading', () => {
  const track = routeTrack([xy(0, 0), xy(0, 90)]);
  const align = (p) => ({
    ...p,
    coordinate: [p.coordinate[0] + (p.coordinate[1] > xy(0, 43)[1] ? 4 / 55315 : 0), p.coordinate[1]],
  });
  let last = routePose(track, 30, align);
  for (let offset = 30.25; offset <= 65; offset += 0.25) {
    const current = routePose(track, offset, align);
    assert(distance(last.coordinate, current.coordinate) < 0.33);
    assert(turn(last.bearing, current.bearing) < 2);
    assert(turn(current.bearing, 0) < 18);
    last = current;
  }
});

test('the highlighted future and passed line meet at the same position on a loop', () => {
  const track = routeTrack([xy(0, 0), xy(40, 0), xy(40, 40), xy(0, 0), xy(0, 50)]);
  const offset = track.offsets[3] + 6;
  const {passed, remaining} = splitShape(track, offset);
  assert.deepEqual(passed.at(-1), atOffset(track, offset));
  assert.deepEqual(remaining, [passed.at(-1), xy(0, 50)]);
  assert.deepEqual(splitShape(track, 0), {remaining: track.line});
  assert.deepEqual(splitShape(track, track.length), {passed: track.line});
});

test('steering crosses north continuously and recognises a shape that doubles back on itself', () => {
  const track = routeTrack([xy(2, 0), xy(0, 30), xy(2, 60)]);
  const mid = routePose(track, track.offsets[1]);
  assert(turn(mid.bearing, 0) < 0.1);
  assert(!mid.uncertain);
  const spur = routeTrack([xy(0, 0), xy(0, 20), xy(0, 0)]);
  assert(routePose(spur, spur.offsets[1]).uncertain);
  assert(!routePose(spur, 8).uncertain);
});

test('rounded feed seconds do not cut an observed four-second corner short', () => {
  const track = routeTrack([xy(0, 0), xy(0, 60), xy(60, 60)]);
  const road = {track, pattern: {}};
  const a = move(null, fix(0, 45, 0, 10), 0, road);
  const b = move(a, fix(15, 60, 90, 14), 3850, road);
  const nearEnd = samplePose(b, 3850 + 3300);
  assert(distance(nearEnd.coordinate, samplePose(b, 7700).coordinate) > 2);
  assert.deepEqual(samplePose(b, 7700), samplePose(b, 15000));
  const precise = move(b, {...fix(16, 60, 90, 14), precise: true}, 6000, road);
  assert.deepEqual(samplePose(precise, 6000), samplePose(b, 6000));
  assert.equal(precise.started + precise.duration, b.started + b.duration);
});
