import {defineConfig} from 'vite';

export default defineConfig({
  base: process.env.MAP_BASE ?? '/',
});
