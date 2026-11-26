import {defineMap, labels, poi} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'helsinki-streets',
  name: 'Helsinki Live',
  version: 1,
  extends: streets,
  defaultTheme: 'light',
  modules: {labels: labels({roads: 'major', places: 'major'}), poi: poi({categories: []})},
  view: {center: [24.915, 60.235], zoom: 10.5, pitch: 0, bearing: 0},
});
