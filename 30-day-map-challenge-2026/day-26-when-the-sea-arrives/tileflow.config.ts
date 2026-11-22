// The managed Map behind this demo (deployed as `hexagonize`, map_tvmwFQ2baiqotKqX): its hosted style
// carries the Map ID that Terrain and World tiles need.
import {bathymetry, defineMap, labels, poi} from '@tileflow/core';
import {outdoors} from '@tileflow/maps';

export default defineMap({
  id: 'hexagonize',
  name: 'Hexagonize',
  version: 1,
  extends: outdoors,
  defaultTheme: 'light',
  modules: {
    labels: labels({places: 'major', roads: 'none', water: 'major'}),
    poi: poi({categories: []}),
  },
  // the water layer floods a flat map: hillshade gives the relief without 3D terrain
  terrain: 'hillshade',
  marine: {bathymetry: bathymetry({display: 'relief'}), nautical: false},
  // the deployed Map keeps this view; the app opens on its own (src/main.ts)
  view: {center: [-16.62, 28.27], zoom: 8.1, pitch: 52, bearing: -18},
});
