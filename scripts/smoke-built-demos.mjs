#!/usr/bin/env node

import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

async function reserveFreePort() {
  const server = createServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'Failed to reserve a loopback port.');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function capture(stream, append) {
  stream.setEncoding('utf8');
  stream.on('data', append);
}

async function waitForServer(child, url, output) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Demo server exited before ${url} was ready.\n${output()}`);
    }
    try {
      const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(1_000)});
      if (response.ok) return;
    } catch {
      // Startup connection failures are expected until the server binds its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}.\n${output()}`);
}

async function requestText(url) {
  const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(5_000)});
  assert.equal(response.status, 200, `${url} returned ${response.status}.`);
  return response.text();
}

async function requestJson(url) {
  const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(5_000)});
  assert.equal(response.status, 200, `${url} returned ${response.status}.`);
  const source = await response.text();
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(
      `${url} did not return JSON (${response.headers.get('content-type')}): ${source.slice(0, 200)}`,
      {cause: error},
    );
  }
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = once(child, 'exit');
  const timeout = new Promise((resolve) => setTimeout(resolve, 5_000, 'timeout'));
  if ((await Promise.race([exited, timeout])) === 'timeout') {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

async function validateAssets({assetBase, cwd, mapId, name, origin}) {
  const requireDemo = createRequire(join(cwd, 'package.json'));
  const {parseTileflowRuntimeManifest} = requireDemo('@tileflow/core/manifest');
  const manifest = parseTileflowRuntimeManifest(await requestJson(`${origin}${assetBase}/manifest.json`));
  const styleUrl = manifest.maps?.[mapId]?.themes?.light?.styleUrl;
  assert.equal(
    typeof styleUrl,
    'string',
    `${name} manifest does not expose the light style for ${mapId}.`,
  );
  const styleLocation = new URL(styleUrl, origin);
  assert.equal(styleLocation.origin, origin, `${name} points ${mapId} at another origin.`);

  const style = await requestJson(styleLocation);
  assert.equal(style.version, 8, `${name} did not serve a MapLibre v8 style.`);
  assert.ok(Array.isArray(style.layers) && style.layers.length > 0, `${name} style has no layers.`);
}

async function smokeDemo({
  name,
  executable,
  mapId,
  captureDirectory,
  arguments: args,
  cwd,
  origin,
  assetBases = ['/tileflow'],
}) {
  let output = '';
  const child = spawn(executable, args, {
    cwd,
    env: {...process.env, NEXT_TELEMETRY_DISABLED: '1'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  };
  capture(child.stdout, append);
  capture(child.stderr, append);

  try {
    await waitForServer(child, origin, () => output);
    const html = await requestText(origin);
    assert.match(html, /<html/u, `${name} did not serve an HTML document.`);

    for (const assetBase of assetBases) await validateAssets({assetBase, cwd, mapId, name, origin});
    console.log(`Validated ${name} at ${origin}.`);
    if (captureDirectory) {
      const output = resolve(captureDirectory, mapId);
      await mkdir(output, {recursive: true});
      const captureArgs = ['capture', mapId + '-desktop', '--app-origin', origin, '--out-dir', output, '--json'];
      try {
        const {stdout} = await promisify(execFile)(join(cwd, 'node_modules/.bin/tileflow'), captureArgs, {cwd});
        console.log(stdout);
      } catch (error) {
        const diagnostics = error.stdout + error.stderr;
        await writeFile(join(output, 'diagnostics.txt'), diagnostics);
        throw new Error(`Capture failed for ${name}.\n${diagnostics}`, {cause: error});
      }
    }
  } finally {
    await stopServer(child);
  }
}

const captureDirectory = process.env.DEMO_CAPTURE_DIR;
const viteDemos = [
  ['vite-basic', 'madrid'],
  ['locator', 'locator'],
  ['field', 'field'],
  ['territories', 'territories'],
];

for (const [name, mapId] of viteDemos) {
  if (captureDirectory && name === 'vite-basic') continue;
  const port = await reserveFreePort();
  const cwd = join(repositoryRoot, 'apps', name);
  try {
    await smokeDemo({
      name, mapId, cwd, captureDirectory,
      executable: join(cwd, 'node_modules/.bin/vite'),
      arguments: ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      origin: `http://127.0.0.1:${port}`,
    });
  } catch (error) {
    if (!captureDirectory) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (!captureDirectory) {
  const nextPort = await reserveFreePort();
  await smokeDemo({
    name: 'Next demo static assets',
    mapId: 'madrid',
    executable: join(repositoryRoot, 'apps/next-basic/node_modules/.bin/next'),
    arguments: ['start', '--hostname', '127.0.0.1', '--port', nextPort.toString()],
    cwd: join(repositoryRoot, 'apps/next-basic'),
    origin: `http://127.0.0.1:${nextPort}`,
    assetBases: ['/tileflow', '/api/tileflow'],
  });
}
