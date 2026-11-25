#!/usr/bin/env node
// Builds every published map into sites/maps/dist/<map-name>/, served at maps.tileflow.dev/<map-name>/.
// A map's name is its public address and never changes once shared.

import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Map name → the app that builds it. */
const maps = {
  'drinking-water-atlas': '30-day-map-challenge-2026/day-23-drinking-water-atlas',
  'helsinki-live': '30-day-map-challenge-2026/day-24-helsinki-live',
  'paris-on-film': '30-day-map-challenge-2026/day-20-paris-on-film',
  sniff: '30-day-map-challenge-2026/day-19-sniff',
  'sun-on-the-street': '30-day-map-challenge-2026/day-17-sun-on-the-street',
  'visibility-explorer': 'apps/visibility-explorer',
};

const root = fileURLToPath(new URL('../..', import.meta.url));
const site = join(root, 'sites/maps');
const dist = join(site, 'dist');
rmSync(dist, {recursive: true, force: true});
mkdirSync(dist, {recursive: true});
for (const file of ['_headers', '_redirects']) cpSync(join(site, 'static', file), join(dist, file));

for (const [name, app] of Object.entries(maps)) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'vite', 'build', '--outDir', join(dist, name), '--emptyOutDir', '--logLevel', 'warn'],
    {cwd: join(root, app), env: {...process.env, MAP_BASE: `/${name}/`}, stdio: 'inherit'},
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Built ${name} from ${app}.`);
}
