import {defineConfig} from 'vite';
import {tileflowMapLibreWorker} from '@tileflow/vite';

// The map is managed (public/map/manifest.json is its manifest): its hosted styles carry the Map ID
// that Terrain and World tiles need. Locally, the Map accepts requests from http://127.0.0.1:5327.
export default defineConfig({
  base: process.env.MAP_BASE ?? '/',
  plugins: [tileflowMapLibreWorker()],
  worker: {format: 'es'},
});
