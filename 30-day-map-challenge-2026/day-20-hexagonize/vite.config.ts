import {defineConfig} from 'vite';
import {tileflowMapLibreWorker} from '@tileflow/vite';

// The map is managed (`tileflow deploy` wrote public/tileflow/manifest.json): its hosted styles carry
// the Map ID that Terrain and Bathymetry tiles need, locally and on maps.tileflow.dev/hexagonize/.
export default defineConfig({
  base: process.env.MAP_BASE ?? '/',
  plugins: [tileflowMapLibreWorker()],
  worker: {format: 'es'},
});
