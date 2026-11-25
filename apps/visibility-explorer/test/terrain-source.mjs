import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {nativeTerrain, TerrainProjection} from '../src/world-terrain.js';

test('the opening near grid uses the same pinned release, eye surface and foreground ridge as Outdoors', async () => {
  const file = name => new URL('../src/data/' + name, import.meta.url);
  const [near, wide, bytes] = await Promise.all([
    readFile(file('madeira-near.json'), 'utf8').then(JSON.parse),
    readFile(file('madeira.json'), 'utf8').then(JSON.parse),
    readFile(file('madeira-near.f32')),
  ]);
  assert.equal(near.release, wide.release);
  assert.equal(near.descriptorSha256, wide.descriptorSha256);
  assert.equal(near.gridSha256, createHash('sha256').update(bytes).digest('hex'));
  const n = near.size, mid = (n - 1) / 2;
  const heights = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  assert.equal(heights.length, n * n);
  const eye = heights[mid * n + mid] + 1.7;
  assert.ok(Math.abs(eye - 1797.857319) < .001);
  const ruivo = TerrainProjection.offset(near.lat, near.lon, 32.75887632053872, -16.942763328552246);
  const distance = Math.hypot(ruivo.east, ruivo.north);
  function clearance(d) {
    const x = mid + ruivo.east * d / (distance * near.spacing);
    const y = mid - ruivo.north * d / (distance * near.spacing);
    const i = Math.floor(y) * n + Math.floor(x);
    const fx = x % 1, fy = y % 1;
    const z = (1 - fy) * ((1 - fx) * heights[i] + fx * heights[i + 1])
      + fy * ((1 - fx) * heights[i + n] + fx * heights[i + n + 1]);
    return eye + d / distance * (1857.28125 - eye) - z;
  }
  assert.ok(clearance(8.5) > 0);
  assert.ok(clearance(9.5) < 0);
});

test('the native window caps requests, wraps the antimeridian and keeps missing pixels unknown', async (t) => {
  const descriptor = 'a'.repeat(64);
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('tiles.json')) return Response.json({
      encoding: 'terrarium', scheme: 'xyz', format: 'webp', tileSize: 512,
      tiles: ['https://example.org/sample/{z}/{x}/{y}.webp?terrainDescriptorSha256=' + descriptor],
      tileflow: {tileVersion: 'sample', baseMaxzoom: 12},
    });
    urls.push(url);
    return new Response(null, {status: 404});
  });
  const tile = await nativeTerrain(79, 179.9999);
  assert.ok(tile.tiles.length > 1 && tile.tiles.length <= 24);
  assert.equal(tile.missingTiles, tile.tiles.length);
  assert.equal(new Set(urls).size, tile.tiles.length);
  assert.ok(tile.tiles.some(t => t.x === 0));
  assert.ok(tile.tiles.some(t => t.x === 2 ** tile.zoom - 1));
  for (const dx of [-300, 0, 300]) assert.ok(Number.isNaN(tile.heightAt(dx, 0)));
  const n = urls.length;
  await assert.rejects(nativeTerrain(79, 179.9999, {signal: AbortSignal.abort()}), {name: 'AbortError'});
  assert.equal(urls.length, n);
});
