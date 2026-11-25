import {tileflow} from '@tileflow/vite';
import {defineConfig} from 'vite';

export default defineConfig({
  base: process.env.MAP_BASE ?? '/',
  plugins: [tileflow()],
  worker: {format: 'es'},
});
