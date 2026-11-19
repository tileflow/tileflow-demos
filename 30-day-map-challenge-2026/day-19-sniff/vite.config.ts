import {defineConfig} from 'vite';
import {tileflow} from '@tileflow/vite';

export default defineConfig({
  base: process.env.MAP_BASE ?? '/',
  plugins: [tileflow()],
  build: {target: 'es2022'},
});
