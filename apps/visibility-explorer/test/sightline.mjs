import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import geometry from '../src/discovery-geometry.js';

test('a source-pixel ridge just short of a summit can block an otherwise clear profile', () => {
  const size = 41, heights = new Float32Array(size * size);
  const options = {size, heights, spacing: 50, radius: 1000, observerHeight: 1.7, curvature: 0};
  const x = 40, y = 20;
  assert.equal(geometry.profile(options, x, y).status, 1);
  const nativeTerrain = {spacing: 10, heightAt: east => Math.max(0, 5 - Math.abs(east - 975))};
  const detailed = geometry.profile({...options, nativeTerrain}, x, y);
  assert.equal(detailed.status, 0);
  assert.ok(detailed.firstBlocker.distance >= 970 && detailed.firstBlocker.distance < 975);
});

test('a low ridge between major-axis samples blocks a person’s sightline in every octant', () => {
  const size = 11, center = 5;
  for (const [dx, dy] of [[4,3],[3,4],[-4,3],[-3,4],[4,-3],[3,-4],[-4,-3],[-3,-4]]) {
    const heights = new Float32Array(size * size);
    const acrossRows = Math.abs(dx) > Math.abs(dy);
    const edge = center + Math.sign(acrossRows ? dy : dx) * 2;
    for (let i = 0; i < size; i++) heights[acrossRows ? edge * size + i : i * size + edge] = 2;
    const options = {heights, size, spacing: 50, radius: 250, curvature: 0, targetHeight: 1.7, observerHeight: 1.7};
    const x = center + dx, y = center + dy;
    const result = geometry.profile(options, x, y);
    assert.equal(result.status, 0);
    assert.ok(Math.abs(result.firstBlocker.distance - 250 * 1.85 / 3) < .05);
    const raster = geometry.heightRaster(options);
    assert.equal(geometry.statusAt(raster, y * size + x, 1.7), 0);
    // Interpolating from a taller eye to the same target clears the ridge.
    assert.equal(geometry.statusAt(raster, y * size + x, 3), 1);
    assert.equal(geometry.profile({...options, observerHeight: 3}, x, y).status, 1);
  }
});

test('Madeira profile agrees with independent one-metre rays in 900 directions and distances', () => {
  const bytes = fs.readFileSync(new URL('../src/data/madeira.f32', import.meta.url));
  const h = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const size = 401, mid = 200, spacing = 50, curvature = 1, eyeHeight = 1.7;
  const options = {heights: h, size, spacing, observerHeight: eyeHeight, radius: 10000, curvature};
  function surface(x, y) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, k = j * size + i;
    return (1 - fy) * ((1 - fx) * h[k] + fx * h[k + 1])
      + fy * ((1 - fx) * h[k + size] + fx * h[k + size + 1]);
  }
  const eye = surface(mid, mid) + eyeHeight;
  const correction = curvature / (2 * 6371008.8);
  let visible = 0, blocked = 0;
  for (const range of [250, 1000, 2500, 5000, 9500]) {
    for (let bearing = 0; bearing < 360; bearing += 2) {
      const rad = bearing * Math.PI / 180, dx = Math.sin(rad) / spacing, dy = -Math.cos(rad) / spacing;
      const x = mid + dx * range, y = mid + dy * range, target = surface(x, y) - correction * range * range;
      let obstructed = false;
      for (let d = 1; d < range; d++) {
        const sightline = eye + (target - eye) * d / range;
        if (surface(mid + dx * d, mid + dy * d) - correction * d * d > sightline + .001) {
          obstructed = true;
          break;
        }
      }
      const result = geometry.profile(options, x, y, {samples: false});
      assert.equal(result.status, obstructed ? 0 : 1, `bearing ${bearing}° at ${range} m`);
      if (obstructed) blocked++;
      else visible++;
    }
  }
  assert.ok(visible > 0 && blocked > 0);
});

test('a nearby ridge below the overview grid spacing appears in the profile, horizon and raster', () => {
  const size = 21, heights = new Float32Array(size * size);
  const nearSize = 17, nearHeights = new Float32Array(nearSize * nearSize);
  for (let x = 0; x < nearSize; x++) nearHeights[5 * nearSize + x] = 4;
  const options = {
    size, heights, spacing: 50, radius: 450, observerHeight: 1.7, curvature: 0,
    nearTerrain: {size: nearSize, heights: nearHeights, spacing: 5},
  };
  const profile = geometry.profile(options, 10, 3);
  assert.equal(profile.status, 0);
  assert.ok(Math.abs(profile.firstBlocker.distance - (8 + 1.7) / (.8 + 1.7 / 350)) < .05);
  const horizon = geometry.horizonRay(options, 0);
  assert.ok(Math.abs(horizon.angle - Math.atan2(4 - 1.7, 15) * 180 / Math.PI) < 1e-8);
  const raster = geometry.heightRaster(options);
  assert.equal(geometry.statusAt(raster, 3 * size + 10, 1.7), 0);
  assert.equal(geometry.statusAt(raster, 3 * size + 10, 10), 1);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const p = geometry.profile(options, x, y, {samples: false});
      assert.equal(geometry.statusAt(raster, y * size + x, 1.7), p.status, `cell ${x},${y}`);
    }
  }
});
