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
  // the plain map shows only for a moment before the hexagons: hillshade without contours or 3D
  // terrain keeps that moment cheap (contours are traced from the DEM on the CPU, tile by tile)
  terrain: 'hillshade',
  // the sea floor as a continuous relief: the app samples the same Bathymetry DEM for its hexagons
  marine: {bathymetry: bathymetry({display: 'relief'}), nautical: false},
  // Tenerife and La Gomera: the Teide rises 3,715 m and the ocean floor drops past 3,000 m around them
  view: {center: [-16.62, 28.27], zoom: 8.1, pitch: 52, bearing: -18},
});
