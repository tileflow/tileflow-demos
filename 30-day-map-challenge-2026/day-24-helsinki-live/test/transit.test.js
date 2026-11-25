import test from 'node:test';
import {atOffset, routeTrack} from '../src/route-track.js';
import assert from 'node:assert/strict';
import {choosePattern, move, recentTrail, sample, tripKey, upcoming} from '../src/transit.js';

test('joins the service across midnight and distinguishes opposite directions', () => {
  const t = {startDate: '20261124', routeId: '1021', directionId: 0, startTime: '25:03:00'};
  assert.equal(tripKey(t), '20261124|1021|0|25:03:00');
  assert.notEqual(tripKey(t), tripKey({...t, directionId: 1}));
});
test('selects the actual stop order of a variant including a repeated stop', () => {
  const normal = {direction: 0, stops: ['A', 'B', 'C', 'D']};
  const loop = {direction: 0, stops: ['A', 'C', 'B', 'C', 'D']};
  assert.equal(choosePattern({patterns: [normal, loop]}, 0, ['A', 'C', 'B', 'C', 'D']), loop);
  assert.equal(choosePattern({patterns: [normal, loop]}, 0), normal);
});
test('the board omits passed and skipped stops and keeps a currently boarding bus', () => {
  const boarding = {id: 'A', arrival: 95, departure: 110};
  const later = {id: 'B', arrival: 125};
  assert.deepEqual(
    upcoming(
      [boarding, later, {arrival: 90}, {arrival: 120, skipped: true}, {arrival: 100, passed: true}],
      100,
    ),
    [boarding, later],
  );
});
test('GPS fixes ignore older signals and freeze at the last observation', () => {
  const a = {key: 'trip', coordinate: [24.91, 60.16], timestamp: 10, bearing: 40};
  const first = move(null, a, 100);
  const second = move(first, {...a, timestamp: 12, coordinate: [24.911, 60.16]}, 200);
  assert.deepEqual(sample(second, 2200), [24.911, 60.16]);
  assert.deepEqual(sample(second, 6000), [24.911, 60.16]);
  assert.equal(move(second, a, 8000), second);
  const newRun = move(second, {...a, key: 'new', timestamp: 13}, 9000);
  assert.deepEqual(sample(newRun, 9000), a.coordinate);
});

test('the overview tail follows measured travel through a bend and fades while boarding', () => {
  const road = {
    track: routeTrack([
      [24.91, 60.16],
      [24.912, 60.16],
      [24.912, 60.165],
    ]),
  };
  const track = road.track;
  const corner = track.offsets[1];
  const fix = (stamp, offset) => ({key: 'A', timestamp: stamp, coordinate: atOffset(track, offset)});
  const first = move(null, fix(100, corner - 24), 0, road);
  assert.deepEqual(recentTrail(first, 0, 100), []);
  const second = move(first, fix(107, corner + 26), 7000, road);
  const third = move(second, fix(112, corner + 48), 12000, road);
  const tail = recentTrail(third, 18000, 118);
  assert.deepEqual(tail[1], track.line[1]);
  assert.deepEqual(tail.at(-1), sample(third, 18000));
  const fading = recentTrail(third, 34000, 138);
  assert(fading.length > 1);
  assert(fading[0][0] > tail[0][0]);
  assert.deepEqual(recentTrail(third, 48000, 148), []);
});

test('the overview tail restarts after a lost signal, a trip change or a diversion', () => {
  const road = {
    track: routeTrack([
      [24.91, 60.16],
      [24.91, 60.18],
    ]),
  };
  const a = {key: 'A', timestamp: 100, coordinate: [24.91, 60.16]};
  const b = {...a, timestamp: 105, coordinate: [24.91, 60.1604]};
  const bus = move(move(null, a, 0, road), b, 5000, road);
  const precise = move(bus, {...b, precise: true}, 5100, road);
  assert.deepEqual(
    precise.recentOffsets.map(([stamp]) => stamp),
    [100, 105],
  );
  for (const update of [
    {...b, timestamp: 120},
    {...b, key: 'B', timestamp: 106},
    {...b, coordinate: [24.89, 60.155], timestamp: 106},
  ]) {
    const reacquired = move(precise, update, 9000, road);
    assert.deepEqual(recentTrail(reacquired, 13000, update.timestamp), []);
  }
});

test('a trail starts after the last unresolved crossing and has a bounded length', () => {
  const track = routeTrack(
    [
      [24.91, 60.16],
      [24.91, 60.18],
    ],
    undefined,
    [[350, 400]],
  );
  const bus = {
    track,
    recentOffsets: [
      [100, 0],
      [110, 600],
    ],
    started: 0,
    duration: 1000,
    fromOffset: 0,
    offset: 600,
    timestamp: 110,
  };
  assert.deepEqual(recentTrail(bus, 625, 110), []);
  assert.deepEqual(recentTrail(bus, 1000, 110)[0], atOffset(track, 400));
  assert.deepEqual(recentTrail({...bus, offset: 1300}, 1000, 110)[0], atOffset(track, 500));
});
