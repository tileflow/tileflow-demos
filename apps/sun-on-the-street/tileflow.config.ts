import {defineMap, labels, poi} from '@tileflow/core';
import {streets} from '@tileflow/maps';

// Streets' own buildings, colours and materials included, without their shadows: the app draws the
// exact ground shadows itself, and the map's would add a second, shorter set.
const buildings = streets.modules.buildings as unknown as {renderStack: Record<string, unknown>};
const {flatShadow, shadowSoft, shadowCore, ...renderStack} = buildings.renderStack;

export default defineMap({
  id: 'sun-streets',
  name: 'Sun on the street',
  version: 1,
  extends: streets,
  defaultTheme: 'light',
  modules: {
    labels: labels({places: 'major', roads: 'major', water: 'none'}),
    poi: poi({categories: []}),
    buildings: {...buildings, renderStack} as typeof streets.modules.buildings,
  },
  // Lower Manhattan and Brooklyn Heights, tilted
  view: {center: [-74.0065, 40.7072], zoom: 13.7, pitch: 40, bearing: 20},
});
