import {createStyle} from '@tileflow/core';
import {defineConfig} from 'vite';
import {seaPaint} from './src/atlas-inks.mjs';
import {config} from './src/tileflow.config.mjs';

const style = createStyle(config);
// All atlas layers use local GeoJSON. Drop unused sources before shipping the style.
const usedSources = new Set(style.layers.map(layer => layer.source));
for (const id of Object.keys(style.sources)) {
  if (!usedSources.has(id)) delete style.sources[id];
}
style.layers.unshift({
  id: 'oceano',
  type: 'background',
  paint: {'background-color': seaPaint(config.themes.dia.tokens.color['surface.background'])},
});

export default defineConfig({
  base: process.env.MAP_BASE ?? '/',
  define: {__ATLAS_STYLE__: JSON.stringify(style)},
});
