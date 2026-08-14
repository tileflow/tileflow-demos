#!/usr/bin/env node

import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {join} from 'node:path';
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

async function validateAssets({assetBase, name, origin}) {
  const manifest = await requestJson(`${origin}${assetBase}/manifest.json`);
  assert.equal(manifest.version, 1, `${name} manifest version changed unexpectedly.`);
  assert.equal(
    manifest.maps?.madrid,
    '/tileflow/styles/madrid.json',
    `${name} manifest does not expose the Madrid map.`,
  );

  const style = await requestJson(`${origin}${assetBase}/styles/madrid.json`);
  assert.equal(style.version, 8, `${name} did not serve a MapLibre v8 style.`);
  assert.ok(Array.isArray(style.layers) && style.layers.length > 0, `${name} style has no layers.`);
}

async function smokeDemo({
  name,
  executable,
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

    for (const assetBase of assetBases) await validateAssets({assetBase, name, origin});
    console.log(`Validated ${name} at ${origin}.`);
  } finally {
    await stopServer(child);
  }
}

const vitePort = await reserveFreePort();
await smokeDemo({
  name: 'Vite demo',
  executable: join(repositoryRoot, 'apps/vite-basic/node_modules/.bin/vite'),
  arguments: ['preview', '--host', '127.0.0.1', '--port', vitePort.toString(), '--strictPort'],
  cwd: join(repositoryRoot, 'apps/vite-basic'),
  origin: `http://127.0.0.1:${vitePort}`,
});

const nextPort = await reserveFreePort();
await smokeDemo({
  name: 'Next demo static assets',
  executable: join(repositoryRoot, 'apps/next-basic/node_modules/.bin/next'),
  arguments: ['start', '--hostname', '127.0.0.1', '--port', nextPort.toString()],
  cwd: join(repositoryRoot, 'apps/next-basic'),
  origin: `http://127.0.0.1:${nextPort}`,
  assetBases: ['/tileflow', '/api/tileflow'],
});
