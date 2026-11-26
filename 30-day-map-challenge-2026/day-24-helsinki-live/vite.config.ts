import {defineConfig} from 'vite';
import {tileflow} from '@tileflow/vite';
import {hslFeeds} from '../../sites/maps/helsinki-feed.mjs';
import {helsinkiBuildingRenderer} from './scripts/building-renderer-plugin.mjs';

const base = process.env.MAP_BASE ?? '/';
const proxy = Object.fromEntries(
  Object.entries(hslFeeds).map(([name, value]) => {
    const upstream = new URL(value as string);
    return [
      base + 'api/' + name,
      {
        target: upstream.origin,
        changeOrigin: true,
        rewrite: () => upstream.pathname,
      },
    ];
  }),
);

export default defineConfig({
  base,
  plugins: [helsinkiBuildingRenderer(), tileflow()],
  optimizeDeps: {rolldownOptions: {plugins: [helsinkiBuildingRenderer()]}},
  server: {proxy},
  preview: {proxy},
  worker: {format: 'es'},
});
