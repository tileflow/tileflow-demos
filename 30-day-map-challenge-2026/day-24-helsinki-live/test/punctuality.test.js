import test from 'node:test';
import assert from 'node:assert/strict';
import {punctualityStatus, vehiclePunctuality, stopPunctuality} from '../src/punctuality.js';

const day = '20261025',
  origin = Date.UTC(2026, 9, 25, 10) / 1000 - 43200; // Helsinki noon after the autumn clock change.
const start = 25 * 3600 + 120,
  feedTime = origin + start + 50;
const table = {
  version: 1,
  first: day,
  last: '20261026',
  starts: [origin, origin + 86400],
  masks: ['1', '2'],
  patterns: [
    [
      ['A', 'B', 'A', 'C'],
      [1, 4, 7, 10],
    ],
  ],
  profiles: [[0, 120, 240, 360]],
  routes: {L: {0: {[start]: [[0, 0, 0]]}}},
};
function run(stops, patch = {}) {
  return {key: day + '|L|0|25:02:00', stops, timestamp: feedTime, ...patch};
}
const read = (trip, opts = {}) =>
  vehiclePunctuality(
    opts.table ?? table,
    {key: trip.key, timestamp: feedTime, ...opts.bus},
    trip,
    opts.now ?? feedTime,
    opts.stamp ?? feedTime,
  );

test('punctuality bands at exact second boundaries', () => {
  assert.deepEqual([-61, -60, 119, 120, 299, 300, null, NaN].map(punctualityStatus), [
    'early',
    'on-time',
    'on-time',
    'late',
    'late',
    'very-late',
    'unknown',
    'unknown',
  ]);
});
test('service-day origin and a 25-hour trip start are independent of the browser zone', () => {
  const call = {id: 'B', arrival: feedTime + 160};
  const trip = run([call]);
  const result = read(trip);
  assert.equal(result.scheduled, origin + start + 120);
  assert.equal(result.scheduled, Date.UTC(2026, 9, 25, 23, 4) / 1000);
  assert.equal(result.delta, 90);
  assert.deepEqual({...stopPunctuality(table, trip, call, feedTime, feedTime), callIndex: 0}, result);
});
test('inactive day, out-of-coverage, duplicate active service and ad-hoc trip stay unknown', () => {
  const c = {id: 'B', arrival: feedTime + 160};
  for (const key of ['20261026|L|0|25:02:00', '20261028|L|0|25:02:00', day + '|L|1|25:02:00'])
    assert.equal(read(run([c], {key})).status, 'unknown');
  assert.equal(read(run([c], {relationship: 1})).status, 'unknown');
  assert.equal(read(run([c], {ambiguous: true})).status, 'unknown');
  const duplicate = {
    ...table,
    routes: {
      L: {
        0: {
          [start]: [
            [0, 0, 0],
            [0, 0, 0],
          ],
        },
      },
    },
  };
  assert.equal(read(run([c]), {table: duplicate}).status, 'unknown');
});
test('loop stops require either a sequence or unambiguous order in the RT update', () => {
  const c = {id: 'A', arrival: feedTime + 300};
  assert.equal(read(run([c])).status, 'unknown');
  assert.equal(read(run([{...c, sequence: 7}])).scheduled, origin + start + 240);
  assert.equal(read(run([{id: 'B', passed: true}, c])).scheduled, origin + start + 240);
  assert.equal(read(run([{...c, sequence: 4}])).status, 'unknown');
  assert.equal(read(run([{sequence: 7, arrival: feedTime + 300}])).stopId, 'A');
});
test('prior, skipped and unscheduled stops do not acquire another stop’s scheduled arrival', () => {
  const trip = run([
    {id: 'A', sequence: 1, passed: true},
    {id: 'B', sequence: 4, skipped: true},
    {id: 'A', sequence: 7, arrivalDelay: 181},
  ]);
  assert.equal(read(trip).delta, 181);
  assert.equal(read(run([{id: 'B', relationship: 3, arrival: feedTime + 60}])).status, 'unknown');
  assert.equal(read(run([{id: 'B', relationship: 2}])).status, 'unknown');
  assert.equal(read(run([{id: 'B', departure: feedTime + 60}])).status, 'unknown');
});
test('stale vehicle, stale feed, stale trip and mismatched trip are unknown', () => {
  const trip = run([{id: 'B', arrival: feedTime + 210}]);
  for (const opts of [{bus: {timestamp: feedTime - 30}}, {stamp: feedTime - 75}, {bus: {key: 'another'}}])
    assert.equal(read(trip, opts).status, 'unknown');
  assert.equal(read({...trip, timestamp: feedTime - 75}).status, 'unknown');
});

test('an HSL position takes precedence over an earlier future call', () => {
  // Analogous to 22/1221 at Kutomotie while the Takomotie prediction still looked eligible.
  const prior = {id: 'B', arrival: origin + start + 120 - 65};
  const next = {id: 'C', arrival: origin + start + 360 - 58};
  const trip = run([prior, next]);
  assert.equal(read(trip).delta, -65);
  const inbound = read(trip, {bus: {stopId: 'C', status: 2}});
  assert.deepEqual(
    [inbound.callIndex, inbound.stopId, inbound.delta, inbound.status],
    [1, 'C', -58, 'on-time'],
  );
  assert.equal(read(trip, {bus: {stopSequence: 10, status: 0}}).stopId, 'C');
  assert.equal(read(trip, {bus: {stopId: 'B', stopSequence: 10, status: 0}}).status, 'unknown');
  assert.equal(read(trip, {bus: {stopId: 'A', status: 2}}).status, 'unknown');
});

test('a known arrival and a pending departure advance the arrival comparison while boarding', () => {
  // A vehicle dwelling at Säteritilankatu has already completed its arrival.
  const here = {id: 'B', arrival: feedTime - 59, departure: feedTime + 132, arrived: true};
  const next = {id: 'C', arrival: feedTime + 360};
  const options = {bus: {stopId: 'B', status: 1}};
  assert.equal(read(run([here, next]), options).stopId, 'C');
  assert.equal(stopPunctuality(table, run([here, next]), here, feedTime, feedTime).status, 'unknown');
  const future = {...here, arrival: feedTime + 10, passed: true};
  assert.equal(read(run([future, next]), options).stopId, 'B');
  assert.equal(read(run([{...future, skipped: true}, next]), options).stopId, 'C');
  assert.equal(read(run([{...here, arrived: false}, next]), options).stopId, 'C');
});

test('an overdue unconfirmed prediction at the stop still targeted by a newer inbound fix is unknown', () => {
  const waiting = {id: 'B', arrival: feedTime - 15, departure: feedTime - 12};
  const future = {id: 'C', arrival: feedTime + 90};
  const options = {bus: {stopId: 'B', status: 2}};
  const r = read(run([waiting, future]), options);
  assert.deepEqual([r.callIndex, r.stopId, r.status], [0, 'B', 'unknown']);
  assert.equal(read(run([{...waiting, arrived: true}, future]), options).stopId, 'C');
});
