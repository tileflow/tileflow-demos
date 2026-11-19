import {defineConfig} from 'vite';
import {tileflow} from '@tileflow/vite';

export default defineConfig({
  // served at maps.tileflow.dev/sun-on-the-street/
  base: process.env.MAP_BASE ?? '/',
  plugins: [tileflow()],
  worker: {format: 'es'},
});
