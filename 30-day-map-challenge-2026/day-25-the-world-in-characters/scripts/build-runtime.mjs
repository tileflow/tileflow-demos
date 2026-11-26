// Bundle the browser modules that public/ imports from the installed Tileflow and MapLibre packages.
// vite.config.mjs runs this before every dev server and build.
import {build} from 'esbuild';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, 'public/runtime');
const renderer = join(runtime, 'renderer');
const require = createRequire(join(root, 'package.json'));
const packageRoot = (name) => dirname(require.resolve(name + '/package.json'));
const shared = {bundle: true, format: 'esm', target: 'es2022', platform: 'browser', minify: true};

export async function buildRuntime() {
  await mkdir(renderer, {recursive: true});
  await build({
    ...shared,
    entryPoints: [join(root, 'runtime/entry.mjs')],
    outfile: join(runtime, 'tileflow.mjs'),
    legalComments: 'inline',
    plugins: [{name: 'served-renderer', setup(builder) {
      builder.onResolve({filter: /^maplibre-gl$/}, () => ({path: './renderer/maplibre-gl.mjs', external: true}));
    }}],
  });
  await build({
    ...shared,
    entryPoints: [join(root, 'scripts/visor-dev/detail-data/worker-source.mjs')],
    outfile: join(root, 'public/detail/worker.mjs'),
    legalComments: 'eof',
  });

  const maplibre = packageRoot('maplibre-gl');
  for (const file of ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl.css']) {
    await copyFile(join(maplibre, 'dist', file), join(renderer, file));
  }
  await copyFile(join(maplibre, 'LICENSE.txt'), join(renderer, 'LICENSE.txt'));

  const notices = [];
  for (const name of ['@tileflow/core', '@tileflow/dom', '@tileflow/interactions']) {
    const dir = dirname(createRequire(join(packageRoot('@tileflow/dom'), 'package.json')).resolve(name + '/package.json'));
    const {version} = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
      const text = await readFile(join(dir, file), 'utf8').catch(() => null);
      if (text) notices.push(`${name} ${version} / ${file}\n\n${text}`);
    }
  }
  await writeFile(join(runtime, 'TILEFLOW-NOTICES.txt'), notices.join('\n\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildRuntime();
