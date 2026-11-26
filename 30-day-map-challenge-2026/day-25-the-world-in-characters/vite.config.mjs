import {defineConfig} from 'vite';
import {buildRuntime} from './scripts/build-runtime.mjs';

export default defineConfig({
  base: process.env.MAP_BASE ?? '/',
  plugins: [{name: 'tileflow-runtime', buildStart: buildRuntime}],
});
