import test from 'node:test';
import assert from 'node:assert/strict';
import {choosePattern, move, sample, tripKey, upcoming} from '../src/transit.js';

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
