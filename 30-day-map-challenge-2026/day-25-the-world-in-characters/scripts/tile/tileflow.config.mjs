import { defineMap, defineTheme, disable, geojsonSource, maplibreOverlay } from '@tileflow/core';

const paper = '#faf8f1';
const mono = ['JetBrains Mono', 'Menlo', 'Consolas', 'monospace'];
const serif = ['Instrument Serif', 'Baskerville', 'Georgia', 'serif'];
const inks = {
  water: '#33747d', shore: '#294640', border: '#9a543b', road: '#82543b',
  river: '#427a86', label: '#243e37', ocean: '#326d76',
};

const theme = defineTheme({
  id: 'paper', version: 1, colorScheme: 'light',
  tokens: {
    color: {
      'surface.background': paper, 'surface.water': paper, 'surface.land': paper,
      'surface.park': paper, 'surface.building': paper, 'boundaries.default': inks.border,
      'roads.default': inks.road, 'roads.casing': paper, 'roads.major': inks.road,
      'labels.primary': inks.label, 'labels.halo': paper, 'labels.muted': inks.ocean,
    },
  },
});

const symbol = (role, size, font = mono) => ({
  id: role,
  type: 'symbol',
  filter: ['==', ['get', 'role'], role],
  layout: {
    'symbol-placement': 'point',
    'text-field': ['get', 'text'],
    'text-size': size,
    'text-font': font,
    'text-rotate': ['coalesce', ['get', 'angle'], 0],
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-padding': 0,
  },
  paint: { 'text-color': inks[role] },
});

export default defineMap({
  id: 'the-world-in-type', name: 'Is this a map? / The world in type', version: 1,
  fonts: ['./fonts'],
  defaultTheme: 'paper', themes: { paper: theme },
  modules: Object.fromEntries(
    'addresses aeroways boundaries buildings labels land landforms nautical poi roads transit vegetation water'
      .split(' ').map((id) => [id, disable()]),
  ),
  sources: { glyphs: geojsonSource({ data: { type: 'FeatureCollection', features: [] } }) },
  overlays: {
    type: maplibreOverlay({
      source: 'glyphs', placement: 'above-labels',
      layers: [
        symbol('water', 12), symbol('shore', 12), symbol('border', 9), symbol('road', 9),
        symbol('river', 10), symbol('label', 14), symbol('ocean', 20, serif),
      ],
    }),
  },
});
