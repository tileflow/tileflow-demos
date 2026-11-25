import assert from 'node:assert/strict';
import test from 'node:test';
import {createBusViewport} from '../src/bus-viewport.js';

const rect = (left, top, width, height) => ({left, top, width, height, right: left + width, bottom: top + height});
const canvas = rect(40, 30, 1000, 640);
const details = rect(720, 170, 270, 270);
const area = createBusViewport(canvas, [details, rect(56, 46, 250, 52), rect(54, 524, 204, 128)]);

test('a card masks only its occupied rectangle, in canvas coordinates', () => {
  for (const point of [{x: 825, y: 65}, {x: 825, y: 465}, {x: 500, y: 550}]) {
    assert.deepEqual(area.place(point), {...point, visible: true, feasible: true});
  }
  for (const point of [{x: 825, y: 205}, {x: 40, y: 28}, {x: 99, y: 558}]) {
    const target = area.place(point);
    assert.equal(target.visible, false);
    assert.ok(target.feasible && area.place(target).visible);
  }
});

test('a lower-right landscape card leaves the lower-left map available', () => {
  const view = createBusViewport(rect(0, 0, 800, 380), [rect(415, 156, 373, 180)]);
  const point = {x: 220, y: 251};
  assert.deepEqual(view.place(point, {mode: 'follow'}), {...point, visible: true, feasible: true});
  assert.equal(view.place({x: 510, y: 250}).visible, false);
});

test('the whole projected footprint including a tall label must clear the obstruction', () => {
  const footprint = {left: 20, right: 12, top: 46, bottom: 7};
  const point = {x: 760, y: 445}; // The canvas-relative card bottom is 410.
  assert.ok(area.place(point).visible);
  const target = area.place(point, {footprint});
  assert.equal(target.visible, false);
  assert.ok(target.y >= 456);
  assert.ok(area.place(target, {footprint}).visible);
  assert.equal(area.place({x: 16, y: 95}, {footprint}).visible, false);
});

test('a moving vehicle nudges only when approaching a nearby obstruction', () => {
  const point = {x: 667, y: 230}; // Seven pixels separate its marker from the panel.
  const follow = motion => area.place(point, {mode: 'follow', motion});
  for (const motion of [{x: 0, y: 1}, {x: 0, y: 0}, {x: -1, y: .2}]) {
    assert.deepEqual(follow(motion), {...point, visible: true, feasible: true});
  }
  const approaching = follow({x: 1, y: 0});
  assert.ok(approaching.x < point.x);
  assert.equal(approaching.y, point.y);
  // Small motion after a correction stays in the dead zone.
  const after = {x: approaching.x + 2, y: point.y};
  assert.equal(area.place(after, {mode: 'follow', motion: {x: 2, y: 0}}).x, after.x);
});

test('explicit recenter finds the middle of the unobstructed map', () => {
  const view = createBusViewport(rect(30, 40, 800, 400), [rect(530, 40, 300, 400)]);
  const target = view.place({x: 750, y: 350}, {mode: 'center'});
  assert.ok(target.feasible && view.place(target).visible);
  assert.ok(target.x > 225 && target.x < 295);
  assert.equal(target.y, 200);
  assert.deepEqual(view.place({x: -20, y: -50}, {mode: 'center'}), target);
});

test('two obstacles sharing a corner leave a valid nearest diagonal escape', () => {
  const view = createBusViewport(rect(0, 0, 800, 600), [
    rect(270, 250, 260, 100), rect(335, 190, 130, 220),
  ]);
  const p = {x: 360, y: 262};
  const result = view.place(p);
  assert.ok(result.feasible && !result.visible);
  assert.ok(result.x < 335 && result.y < 250);
  assert.ok(view.place(result).visible);
});

test('narrow pockets retain a visible bus; completely covered panes report no usable position', () => {
  const popup = rect(0, 26, 610, 290);
  const view = createBusViewport(rect(0, 0, 800, 360), [null, popup, rect(259, 0, 0, 140)]);
  const p = {x: 210, y: 14};
  assert.deepEqual(view.place(p, {mode: 'follow'}), {...p, visible: true, feasible: true});
  const full = createBusViewport(rect(0, 0, 320, 200), [rect(-50, -20, 480, 230)]);
  for (const mode of ['center', 'reveal', 'follow']) {
    assert.deepEqual(full.place(p, {mode}), {...p, visible: false, feasible: false});
  }
});

test('a stable previous position resolves similar escape distances', () => {
  const view = createBusViewport(rect(0, 0, 800, 600), [rect(310, 100, 180, 400)]);
  const p = {x: 399.5, y: 300};
  const right = view.place(p, {previous: {x: 510, y: 300}});
  const left = view.place(p, {previous: {x: 290, y: 300}});
  assert.ok(left.x < 310 && right.x > 490);
});

test('fitting a route in landscape reserves a real open rectangle between the header and the card', () => {
  const view = createBusViewport(rect(0, 0, 820, 390), [
    rect(12, 12, 415, 240), rect(465, 167, 342, 164), rect(738, 12, 68, 64),
  ]);
  const box = view.freeRect();
  assert.ok(box.right - box.left > 250 && box.bottom - box.top > 100);
  for (const x of [box.left + 1, (box.left + box.right) / 2, box.right - 1]) {
    for (const y of [box.top + 1, (box.top + box.bottom) / 2, box.bottom - 1]) {
      assert.ok(view.place({x, y}, {footprint: {}}).visible);
    }
  }
});
