import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import test from 'node:test';
import {localService} from '../shared/local-service.ts';
import {calculateWalk} from '../apps/field/server/walk.ts';

test('only an enabled local action may use the server credential', async (t) => {
  const keyName = 'DEMO_TEST_ONLY_SERVICE_KEY';
  const calls = [];
  const plugin = localService(keyName, async (value, key) => {
    calls.push({value, key});
    return {label: value};
  });
  let middleware;
  plugin.configureServer({middlewares: {use: (handler) => { middleware = handler; }}});
  const server = createServer((req, res) => middleware(req, res, () => res.writeHead(404).end()));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const run = (headers) => fetch(origin + '/__demo/live?value=lagoon', {method: 'POST', headers});
  const status = async () => (await fetch(origin + '/__demo/capabilities')).json();
  const localHeaders = {'X-Demo-Action': '1', Origin: origin};

  const previous = process.env[keyName];
  delete process.env[keyName];
  t.after(() => {
    if (previous === undefined) delete process.env[keyName];
    else process.env[keyName] = previous;
  });
  assert.deepEqual(await status(), {enabled: false});
  assert.equal((await run(localHeaders)).status, 403);

  process.env[keyName] = 'test-value';
  assert.deepEqual(await status(), {enabled: true});
  assert.equal((await run({Origin: origin})).status, 403);
  assert.equal((await run({...localHeaders, Origin: 'https://example.org'})).status, 403);
  assert.deepEqual(calls, []);

  const response = await run(localHeaders);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {label: 'lagoon'});
  assert.deepEqual(calls, [{value: 'lagoon', key: 'test-value'}]);
});

test('a disconnected walking route returns no live walk and skips elevation', async (t) => {
  const transport = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({code: 'ROUTING_NO_ROUTE', error: 'No walking route'}, {status: 422}));

  const result = await calculateWalk('lagoon', 'test-value', new AbortController().signal);

  assert.equal(result, null);
  assert.equal(transport.mock.callCount(), 1);
  assert.equal(new URL(transport.mock.calls[0].arguments[0]).pathname, '/v1/routing/route');
});
