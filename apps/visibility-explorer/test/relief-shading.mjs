import assert from 'node:assert/strict';
import test from 'node:test';
import {shadeRelief} from '../src/relief-shading.js';

const size = 161,
  metres = 30;
function mosaic(fill) {
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) heights[y * size + x] = fill(x, y);
  return {heights, width: size, height: size, metres, centre: {x: 80, y: 80}, radiusPx: 70};
}
const alphaAt = (shade, x, y) => shade.rgba[((y - shade.top) * shade.w + (x - shade.left)) * 4 + 3];

test('flat ground stays clear', () => {
  const shade = shadeRelief(mosaic(() => 100));
  assert.equal(Math.max(...shade.rgba.filter((_, i) => i % 4 === 3)), 0);
});

test('a ridge shades the ground on the side away from a north-west sun', () => {
  // A 600 m wall along the anti-diagonal through the centre.
  const shade = shadeRelief(mosaic((x, y) => (Math.abs(x + y - 160) < 2 ? 600 : 0)));
  const leeward = alphaAt(shade, 90, 90),
    sunward = alphaAt(shade, 70, 70);
  assert.ok(leeward > sunward + 40, `leeward ${leeward} vs sunward ${sunward}`);
});
