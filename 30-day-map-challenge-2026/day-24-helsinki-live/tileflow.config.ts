import {defineMap, labels, poi} from '@tileflow/core';
import {streets} from '@tileflow/maps';

export default defineMap({
  id: 'helsinki-streets',
  name: 'Helsinki Live',
  version: 1,
  extends: streets,
  defaultTheme: 'light',
  modules: {labels: labels({roads: 'major', places: 'major'}), poi: poi({categories: []})},
  view: {center: [24.9029, 60.1628], zoom: 16.7, pitch: 54, bearing: -26},
});
