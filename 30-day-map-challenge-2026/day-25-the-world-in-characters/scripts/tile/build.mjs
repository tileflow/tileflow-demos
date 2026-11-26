import { readFile, writeFile } from 'node:fs/promises';
import { createStyle } from '@tileflow/core';
import definition from './tileflow.config.mjs';

const style = createStyle(definition);
// Equal Earth and the paired Lambert hemispheres are geographical projections of
// the animation adapter, applied before the projected coordinates reach Canvas.
style.metadata['world-in-type:projection'] = {
  landscape: 'Equal Earth',
  portrait: 'Lambert azimuthal equal-area, western and eastern hemispheres stacked',
};
style['font-faces'] = {
  'JetBrains Mono': './fonts/jetbrains-mono.woff2',
  'Instrument Serif': './fonts/instrument-serif-latin.woff2',
};
// The plate has a single substrate. The land module is fully disabled to avoid its
// landcover fills. Its background colour still comes from the selected Tileflow theme.
style.layers.unshift({
  id: 'paper', type: 'background',
  paint: { 'background-color': definition.themes.paper.tokens.color['surface.background'] },
});

// All the plate's visible geography is supplied by the typesetter. Omit the unused
// default World source so no basemap or remote tile request can enter this map.
const used = new Set(style.layers.map((layer) => layer.source).filter(Boolean));
for (const key of Object.keys(style.sources)) if (!used.has(key)) delete style.sources[key];
if (process.argv[2]) style.sources.glyphs.data = JSON.parse(await readFile(process.argv[2], 'utf8'));

const score = {
  paper: style.layers[0].paint['background-color'],
  projections: style.metadata['world-in-type:projection'],
  roles: {},
};
for (const layer of style.layers.slice(1)) {
  if (layer.type !== 'symbol' || layer.layout['icon-image'] || !layer.layout['text-field']) {
    throw new Error('A non-text drawing layer has entered the plate: ' + layer.id);
  }
  score.roles[layer.filter[2]] = {
    color: layer.paint['text-color'], size: layer.layout['text-size'],
    font: layer.layout['text-font'], field: layer.layout['text-field'][1],
  };
}

for (const [file, value] of [['style.json', style], ['score.json', score]]) {
  await writeFile(new URL(file, import.meta.url), JSON.stringify(value, null, 2) + '\n', 'utf8');
}
