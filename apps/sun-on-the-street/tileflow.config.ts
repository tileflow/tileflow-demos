import {buildings, defineMap, labels, poi} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'sun-streets',
  name: 'Sun on the street',
  version: 1,
  extends: streets,
  defaultTheme: 'light',
  modules: {
    labels: labels({places: 'major', roads: 'major', water: 'none'}),
    poi: poi({categories: []}),
    // the app draws exact ground shadows itself; the map's own would add a second, shorter set
    buildings: buildings({threeDimensional: {shadows: false}}),
  },
  view: {center: [-73.9803, 40.7575], zoom: 15.6, pitch: 0, bearing: 29},
});
