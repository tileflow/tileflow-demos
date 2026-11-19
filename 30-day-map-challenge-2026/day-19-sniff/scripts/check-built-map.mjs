import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The SDK can enable its own opaque meshes through metadata even in a flat style.
for (const [file, family] of [['styles/scent-trail/dawn.json', false], ['families/scent-trail.json', true]]) {
  const built = JSON.parse(await readFile(new URL(`../dist/tileflow/${file}`, import.meta.url), 'utf8'));
  const style = family ? built.template : built;
  assert.equal(style.metadata?.['tileflow:buildings'], undefined, `${file} mounts a second 3D buildings renderer`);
  assert.ok(style.layers.some(layer => layer.type === 'fill' && layer['source-layer'] === 'building'), `${file} is missing the flat footprints`);
  assert.ok(!style.layers.some(layer => layer.type === 'fill-extrusion' && layer['source-layer'] === 'building'), `${file} draws opaque building extrusions`);
}
