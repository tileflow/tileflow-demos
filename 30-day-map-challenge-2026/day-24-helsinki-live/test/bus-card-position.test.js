import test from 'node:test';
import assert from 'node:assert/strict';
import {busConnector, constrainBusCard, placeBusCard} from '../src/bus-card-position.js';

const summary = {left: 14, right: 290, top: 335, bottom: 550, bottomAnchor: true};
const header = {left: 14, right: 342, top: 14, bottom: 56};
const view = {
  w: 930,
  h: 580,
  cw: 300,
  ch: 390,
  x: 480,
  y: 395,
  lift: 70,
  gap: 106,
  headerOffset: 30,
  side: -1,
  obstacles: [header, summary],
};

test('a tall bus card leaves an expanded lower-left punctuality panel clickable', () => {
  const card = placeBusCard(view);
  assert.equal(card.overlap, 0);
  assert.equal(card.side, 1);
  assert.ok(card.left > summary.right && card.left >= view.x + 8);
  assert.ok(card.top + view.ch < view.h);
});

test('a shorter card stays above the summary on its preferred side', () => {
  const card = placeBusCard({...view, ch: 160, y: 258});
  assert.equal(card.overlap, 0);
  assert.equal(card.side, -1);
  assert.ok(card.top + 160 <= summary.top - 10);
  assert.ok(card.top >= header.bottom + 10);
});

test('a pinned panel stays fixed when the vehicle crosses the viewport or content grows', () => {
  const fixed = {left: 585, top: 120};
  assert.deepEqual(constrainBusCard(fixed, view), fixed);
  assert.deepEqual(constrainBusCard(fixed, {...view, x: 41, y: 62, ch: 397}), fixed);
});

test('expanding the summary displaces a pinned panel only far enough to clear it', () => {
  const fixed = {left: 50, top: 210};
  assert.deepEqual(constrainBusCard(fixed, {...view, ch: 168}), {left: 50, top: 157});
});

test('a far vehicle connects through the nearest exposed edge of the fixed panel', () => {
  const box = {left: 400, top: 150, width: 300, height: 200};
  const left = busConnector({x: 5, y: 230}, box),
    right = busConnector({x: 915, y: 230}, box);
  assert.equal(left.endX, 400);
  assert.ok(left.elbowX < 400);
  assert.equal(right.endX, 700);
  assert.ok(right.elbowX > 700);
  const above = busConnector({x: 520, y: 20}, box),
    below = busConnector({x: 520, y: 570}, box);
  assert.equal(above.endY, 150);
  assert.ok(above.elbowY < 150);
  assert.equal(below.endY, 350);
  assert.ok(below.elbowY > 350);
  assert.equal(busConnector({x: 600, y: 280}, box), null);
});
