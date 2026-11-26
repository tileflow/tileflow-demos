import test from 'node:test';
import assert from 'node:assert/strict';
import {indexRouteTrips, nextRouteArrivals, servedRouteStops} from '../src/route-arrivals.js';

const clock = Date.UTC(2026, 10, 24) / 1000;
const prediction = (key, stops, extra = {}) => ({key, route: '1021', direction: 0, stops, ...extra});
const visit = (id, seconds, sequence, extra = {}) => ({id, arrival: clock + seconds, sequence, ...extra});
function labels(trips, platforms, positions = new Map(), time = clock, stamp = clock, timetable) {
  const direction = indexRouteTrips(trips).get('1021')?.[0];
  return Object.fromEntries(nextRouteArrivals(direction, platforms, positions, timetable, time, stamp));
}

test('past platforms get the next bus of the same route and direction, including a later visit on a loop', () => {
  const selected = prediction('bus', [visit('A', 5, 1), visit('B', 20, 2), visit('A', 395, 3)]);
  const following = prediction('behind', [visit('A', 130, 1), visit('B', 202, 2), visit('C', 69, 3)]);
  const wrongWay = prediction('other direction', [visit('A', 7, 1)], {direction: 1});
  const otherLine = prediction('other line', [visit('A', 9, 1)], {route: '1022'});
  const positions = new Map([['bus', {timestamp: clock, stopSequence: 2, status: 2}]]);
  assert.deepEqual(labels([wrongWay, selected, otherLine, following], ['A', 'B', 'A'], positions), {A: '2 min', B: 'Due'});
  assert.deepEqual(labels([selected], ['A', 'B'], positions), {A: '7 min', B: 'Due'});
});

test('exclude skipped, unreported, boarded, departed, past, stale and cancelled arrivals', () => {
  const bus = prediction('a', [visit('boarded', 5, 1), visit('skip', 30, 2, {relationship: 1}),
    visit('nodata', 160, 3, {relationship: 2}), {id: 'departure', departure: clock + 60},
    visit('past', -1, 4), visit('good', 30, 5)]);
  const passed = prediction('b', [visit('before', 180, 1), visit('actual', -10, 2, {arrived: true})]);
  const excluded = [['old', {timestamp: clock - 75}], ['future', {timestamp: clock + 6}],
    ['cancelled', {relationship: 3}], ['deleted', {relationship: 7}], ['ambiguous', {ambiguous: true}]]
    .map(([key, fields]) => prediction(key, [visit(key, 8, 1)], fields));
  const trips = [bus, passed, ...excluded];
  const stops = trips.flatMap(t => t.stops.map(s => s.id));
  const positions = new Map([['a', {timestamp: clock, stopSequence: 1, status: 1}]]);
  assert.deepEqual(labels(trips, stops, positions), {good: '1 min'});
  assert.deepEqual(labels(trips, stops, positions, clock + 20), {good: 'Due'});
  assert.deepEqual(labels(trips, stops, positions, clock, clock - 75), {});
});

test('match a delay-only HSL prediction to its scheduled platform, even without stop ID', () => {
  const day = '20261124';
  const timetable = {version: 1, first: day, last: day, starts: [clock], masks: ['1'],
    routes: {'1021': {0: {0: [[0, 0, 0]]}}}, patterns: [[['A', 'B'], null]], profiles: [[0, 60]]};
  const trip = prediction(day + '|1021|0|00:00:00', [{sequence: 2, arrivalDelay: 60}]);
  assert.deepEqual(labels([trip], ['A', 'B'], new Map(), clock, clock, timetable), {B: '2 min'});
  assert.deepEqual(labels([trip], ['A', 'B']), {});
});

test('only skip the selected trip’s omitted visits; missing predictions do not remove its stop', () => {
  const p = {stops: ['A', 'B', 'A', 'C'], sequences: [2, 4, 6, 8]};
  const trip = prediction('bus', [{id: 'A', sequence: 2, relationship: 1}, {id: 'B', relationship: 1},
    {id: 'A', sequence: 6}, {id: 'C', skipped: true, relationship: 2}]);
  assert.deepEqual(servedRouteStops(p, trip, clock, clock), ['A', 'C']);
  assert.deepEqual(servedRouteStops(null, trip, clock, clock), ['A', 'C']);
  assert.deepEqual(servedRouteStops(p, trip, clock + 75, clock), p.stops);
  assert.deepEqual(servedRouteStops(null, null, clock, clock), []);
});
