import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import test from 'node:test';
import {alignCarriageway, carriagewayIndex, mapCarriageways} from '../src/carriageways.js';
import {distance} from '../src/route-track.js';

const xy = (x, y) => [24.94 + x / 55315, 60.17 + y / 111195];
const road = (y, properties = {}) => ({
  properties: {class: 'secondary', ...properties},
  geometry: {type: 'LineString', coordinates: [xy(-100, y), xy(100, y)]},
});

test('the route uses the mapped road axis while its vehicle stays in the right lane', () => {
  const cells = carriagewayIndex([road(0)]);
  for (const bearing of [90, 270]) {
    const pose = {coordinate: xy(0, 4), bearing};
    const centre = alignCarriageway(cells, pose, false);
    assert.ok(distance(centre.coordinate, xy(0, 0)) < .01);
    assert.equal(centre.bearing, bearing);
    const bus = alignCarriageway(cells, pose);
    assert.ok(distance(bus.coordinate, xy(0, bearing === 90 ? -1.3 : 1.3)) < .01);
  }
});

test('reverse ways and string flags match the actual permitted direction', () => {
  for (const [forward, reverse] of [[true, -1], ['yes', '-1'], ['1', 'reverse'], ['true', -1]]) {
    const cells = carriagewayIndex([road(0, {oneway: forward}), road(6, {oneway: reverse})]);
    const west = alignCarriageway(cells, {coordinate: xy(0, 1), bearing: 270}, false);
    assert.ok(distance(west.coordinate, xy(0, 6)) < .01);
    const east = alignCarriageway(cells, {coordinate: xy(0, 5), bearing: 90}, false);
    assert.ok(distance(east.coordinate, xy(0, 0)) < .01);
  }
});

test('equally likely parallel ways and separated levels keep the supplied shape', () => {
  const pose = {coordinate: xy(0, 0), bearing: 90};
  const ambiguous = [road(-4.6), road(4.4), road(4.2)];
  for (const candidates of [ambiguous, [...ambiguous].reverse(), [road(4),road(4,{structure:'bridge'})], [road(10)]]) {
    const match = alignCarriageway(carriagewayIndex(candidates), pose, false);
    assert.deepEqual(match.coordinate, pose.coordinate);
    assert.equal(match.uncertain, true);
  }
});

function fakeBounds(min, max) {
  const [west, south] = min, [east, north] = max;
  return {
    getWest: () => west, getSouth: () => south, getEast: () => east, getNorth: () => north,
    contains: ([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north,
  };
}

test('road snapshot, clipped coverage and cache version follow settled tiles, pans, zooms and styles', async () => {
  const events = new Map(), source = {}, bounds = fakeBounds(xy(-20, -20), xy(20, 20));
  let location = [24.94, 60.17], currentSource = source, currentBounds = bounds, features = [road(0)], zoom = 17, loaded = false;
  const map = {
    getZoom: () => zoom, getBearing: () => 0, getPitch: () => 40,
    getCenter: () => ({lng:location[0],lat:location[1]}), getSource: () => currentSource, isSourceLoaded: () => loaded,
    getBounds: () => currentBounds, querySourceFeatures: () => features, isMoving: () => false,
    on(kind, callback) { events.set(kind, callback); },
  };
  let changed = 0;
  const align = mapCarriageways(map, () => changed++);
  const center = align.centerline;
  const pose = {coordinate: xy(0, 3), bearing: 90};
  try {
    await wait(180);
    assert.equal(center.bounds, null);
    assert.equal(center(pose), pose);
    loaded = true;
    events.get('idle')();
    await wait(180);
    assert.equal(center.bounds, bounds);
    assert.equal(center.covers(pose.coordinate), true);
    assert.equal(center.covers(xy(100, 0)), false);
    assert.equal(center.intersects(xy(-1000, 0), xy(1000, 0)), true);
    assert.equal(center.intersects(xy(0, 1000), xy(0, -1000)), true);
    assert.equal(center.intersects(xy(-30, 13), xy(-13, 32)), false);
    assert.equal(center.intersects(xy(0, 0), xy(0, 0)), true);
    assert.ok(distance(center(pose).coordinate, xy(0, 0)) < .01);
    assert.equal(changed, 1);

    events.get('sourcedata')({sourceId: 'hsl-lines', isSourceLoaded: true});
    events.get('idle')();
    await wait(180);
    assert.equal(changed, 1, 'route redraw must not dirty its own snap cache');

    for (let i = 0; i < 20; i++) {
      location = xy(i / 50, 0);
      events.get('moveend')();
      events.get('sourcedata')({sourceId:'tileflow', sourceDataType:'visibility', isSourceLoaded:true});
    }
    await wait(180);
    assert.equal(changed, 1, 'small follow pans and visibility events reuse the same road snapshot');
    location = xy(20, 0);
    currentBounds = fakeBounds(xy(10, -15), xy(30, 15));
    events.get('moveend')();
    await wait(180);
    assert.equal(center.covers(pose.coordinate), false);
    assert.equal(center.bounds, currentBounds);
    features = [];
    events.get('sourcedata')({sourceId: 'tileflow', sourceDataType: 'content'});
    await wait(180);
    assert.equal(center.bounds, null);

    features = [road(0)]; currentBounds = bounds;
    const tile = {state: 'loaded'};
    events.get('sourcedata')({sourceId: 'tileflow', tile, isSourceLoaded: true});
    await wait(180);
    assert.equal(center.bounds, bounds);
    const ready = center.version;
    for (let i = 0; i < 15; i++) events.get('sourcedata')({sourceId: 'tileflow', tile, isSourceLoaded: true});
    await wait(180);
    assert.equal(center.version, ready, 'symbol-layout reparses of the same tile do not invalidate roads');
    zoom = 14; events.get('zoom')();
    assert.equal(center.bounds, null);
    assert.equal(center.intersects(xy(-100, 0), xy(100, 0)), false);
    zoom = 16; events.get('zoomend')();
    await wait(180);
    assert.equal(center.bounds, bounds);
    currentSource = undefined; events.get('styledata')();
    assert.equal(center.bounds, null);
    assert.equal(center.version, align.version);
    assert.equal(changed, center.version);
  } finally { events.get('remove')(); }
});
