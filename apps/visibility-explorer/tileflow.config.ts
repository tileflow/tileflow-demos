import {defineMap} from '@tileflow/core';
import {outdoors, outdoorsThemes} from '@tileflow/maps';

// The explorer draws the official Outdoors map; the Vite plugin compiles it from the SDK.
export default defineMap({
  id: 'visibility',
  name: 'Visibility Explorer',
  version: 1,
  extends: outdoors,
  themes: {light: outdoorsThemes.light},
  defaultTheme: 'light',
  // The eye-view audit reconstructs camera rays on a flat Mercator terrain mesh.
  projection: 'mercator',
  view: {center: [-16.9289, 32.7355], zoom: 11},
});
