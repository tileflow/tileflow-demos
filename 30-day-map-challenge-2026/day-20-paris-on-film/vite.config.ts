import {tileflow} from '@tileflow/vite';
import {defineConfig} from 'vite';
import {buildModel} from './scripts/build-model.mjs';

export default defineConfig({
  base: process.env.MAP_BASE ?? '/',
  plugins: [tileflow(), {name:'paris-city-model', buildStart(){buildModel();}}],
  worker: {format:'es'},
});
