import test from 'node:test';
import assert from 'node:assert/strict';
import {helsinkiTimeOfDay} from '../src/daylight.js';

test('Helsinki uses all four Streets palettes across a November day', () => {
  for (const [utc, period] of [
    ['06:45', 'dawn'],
    ['10:00', 'day'],
    ['13:45', 'dusk'],
    ['22:00', 'night'],
  ]) {
    assert.equal(helsinkiTimeOfDay(Date.parse('2026-11-24T' + utc + ':00Z')), period);
  }
});

test('the same Helsinki clock time can be daylight in summer and night in winter', () => {
  assert.equal(helsinkiTimeOfDay(Date.parse('2026-06-21T19:00:00+03:00')), 'day');
  assert.equal(helsinkiTimeOfDay(Date.parse('2026-12-21T19:00:00+02:00')), 'night');
});
