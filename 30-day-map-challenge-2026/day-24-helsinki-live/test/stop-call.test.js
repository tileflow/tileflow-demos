import test from 'node:test';
import assert from 'node:assert/strict';
import {callForBus, vehicleAtStop, platformInfo, matchesService} from '../src/stop-call.js';

const stops = {
  a: {name: 'Vattuniemi', coordinate: [24.881588, 60.149985]},
  b: {name: 'Wavulinintie', coordinate: [24.8801252, 60.1534154]},
};
const bus = {key: 'trip', stopId: 'a', status: 2, timestamp: 100, speed: 0, coordinate: stops.a.coordinate};
const door = {key: 'trip', time: 99, open: true, stopId: 'a'};
test('a traffic light does not trigger boarding, and an at-stop report requires a nearby platform', () => {
  assert.equal(vehicleAtStop(bus, null, stops, 100), null);
  assert.equal(vehicleAtStop({...bus, status: 1, coordinate: stops.b.coordinate}, null, stops, 100), null);
  assert.equal(vehicleAtStop({...bus, status: 1, statusTime: 60}, null, stops, 100), null);
  assert.deepEqual(vehicleAtStop({...bus, status: 1}, null, stops, 100), {id: 'a', state: 'at'});
});
test('door telemetry is trip-specific and expires even when positions continue', () => {
  assert.equal(vehicleAtStop(bus, {...door, key: 'another'}, stops, 100), null);
  assert.equal(vehicleAtStop(bus, {...door, time: 92}, stops, 100), null);
  assert.equal(vehicleAtStop(bus, {...door, stopId: 'b'}, stops, 100), null);
  assert.deepEqual(callForBus(bus, null, ['b'], door, stops, 100), {
    id: 'a',
    state: 'doors',
    next: 'Wavulinintie',
  });
  assert.equal(callForBus(bus, null, ['a', 'b'], door, stops, 135), null);
});
test('indoor boarding points use their platform and level, and missing evidence adds no amenity', () => {
  assert.deepEqual(platformInfo({platform: '48', indoorLevel: 'E'}, {shelter: true}), [
    'Platform 48',
    'Indoor terminal · Level E',
  ]);
  assert.deepEqual(platformInfo({}, {}), []);
  assert.deepEqual(platformInfo({}, {shelter: true, bench: true}), ['Shelter', 'Bench']);
});

test('a reused fleet number cannot borrow door readings from another start or service date', () => {
  const key = '20261124|1021|0|25:15:00';
  assert(matchesService(key, {oday: '2026-11-24', start: '01:15'}));
  assert(!matchesService(key, {oday: '2026-11-25', start: '01:15'}));
  assert(!matchesService(key, {oday: '2026-11-24', start: '01:45'}));
});
