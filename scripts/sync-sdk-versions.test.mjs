import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  applySyncPlan,
  compareCanonicalSemver,
  compareNumericAlpha,
  createRegistryClient,
  createSyncPlan,
  mergeSyncPullRequest,
  parseNumericAlpha,
  renderWorkspacePolicy,
  summarizePlan,
} from './sync-sdk-versions.mjs';

const alpha8 = '0.1.0-alpha.8';
const alpha14 = '0.1.0-alpha.14';
const alpha16 = '0.1.0-alpha.16';
const alpha17 = '0.1.0-alpha.17';

async function writeJson(path, value) {
  await mkdir(join(path, '..'), {recursive: true});
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function packageVersion(name, version, dependencies = {}) {
  return {name, version, dependencies};
}

function metadata(name, alpha, versions) {
  return {name, 'dist-tags': {alpha}, versions};
}

function registry(overrides = {}) {
  const entries = {
    '@tileflow/capture': metadata('@tileflow/capture', alpha16, {
      [alpha16]: packageVersion('@tileflow/capture', alpha16, {
        '@tileflow/core': alpha16,
        '@tileflow/dev': alpha16,
      }),
    }),
    '@tileflow/cli': metadata('@tileflow/cli', alpha16, {
      [alpha16]: packageVersion('@tileflow/cli', alpha16, {
        '@tileflow/capture': alpha16,
        '@tileflow/core': alpha16,
        '@tileflow/dev': alpha16,
      }),
    }),
    '@tileflow/core': metadata('@tileflow/core', alpha16, {
      [alpha16]: packageVersion('@tileflow/core', alpha16),
    }),
    '@tileflow/dev': metadata('@tileflow/dev', alpha16, {
      [alpha16]: packageVersion('@tileflow/dev', alpha16, {'@tileflow/core': alpha16}),
    }),
    '@tileflow/next': metadata('@tileflow/next', alpha16, {
      [alpha16]: packageVersion('@tileflow/next', alpha16, {'@tileflow/dev': alpha16}),
    }),
    '@tileflow/react': metadata('@tileflow/react', alpha16, {
      [alpha16]: packageVersion('@tileflow/react', alpha16, {
        '@tileflow/core': alpha16,
        '@tileflow/static': alpha16,
      }),
    }),
    '@tileflow/static': metadata('@tileflow/static', alpha16, {
      [alpha16]: packageVersion('@tileflow/static', alpha16),
    }),
    '@tileflow/vite': metadata('@tileflow/vite', alpha16, {
      [alpha16]: packageVersion('@tileflow/vite', alpha16, {'@tileflow/dev': alpha16}),
    }),
    ...overrides,
  };
  return async (name) => {
    assert.ok(entries[name], `Unexpected package request: ${name}.`);
    return entries[name];
  };
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tileflow-demos-sync-'));
  await writeJson(join(root, 'package.json'), {name: 'tileflow-demos', private: true});
  await writeJson(join(root, 'apps/vite/package.json'), {
    name: '@tileflow-demos/vite',
    private: true,
    dependencies: {
      '@tileflow/core': alpha14,
      '@tileflow/react': alpha14,
      '@tileflow/vite': alpha14,
    },
    devDependencies: {'@tileflow/cli': alpha14},
  });
  await writeJson(join(root, 'apps/next/package.json'), {
    name: '@tileflow-demos/next',
    private: true,
    dependencies: {
      '@tileflow/core': alpha8,
      '@tileflow/next': alpha8,
      '@tileflow/react': alpha8,
    },
    devDependencies: {'@tileflow/cli': alpha8},
  });
  await writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
  return root;
}

test('accepts only exact numeric alphas and compares canonical prereleases', () => {
  assert.deepEqual(parseNumericAlpha(alpha16), [0, 1, 0, 16]);
  assert.ok(compareNumericAlpha(alpha8, alpha16) < 0);
  assert.ok(compareCanonicalSemver('0.1.0-alpha.17.1', alpha17) > 0);
  assert.ok(compareCanonicalSemver('0.1.0-beta', alpha17) > 0);
  for (const invalid of ['^0.1.0-alpha.16', '0.1.0', '0.1.0-beta.1', '01.1.0-alpha.1']) {
    assert.throws(() => parseNumericAlpha(invalid), /exact numeric alpha/u);
  }
});

test('updates every demo to the public alpha and resolves the transitive SDK graph', async () => {
  const root = await createFixture();
  try {
    const plan = await createSyncPlan({repositoryRoot: root, getPackageMetadata: registry()});
    assert.deepEqual(plan.changedFiles, [
      'apps/next/package.json',
      'apps/vite/package.json',
      'pnpm-workspace.yaml',
    ]);
    assert.equal(plan.updates.length, 8);
    assert.deepEqual(
      plan.requiredVersions.map(({name, version}) => `${name}@${version}`),
      [
        '@tileflow/capture@0.1.0-alpha.16',
        '@tileflow/cli@0.1.0-alpha.16',
        '@tileflow/core@0.1.0-alpha.16',
        '@tileflow/dev@0.1.0-alpha.16',
        '@tileflow/next@0.1.0-alpha.16',
        '@tileflow/react@0.1.0-alpha.16',
        '@tileflow/static@0.1.0-alpha.16',
        '@tileflow/vite@0.1.0-alpha.16',
      ],
    );
    assert.equal(summarizePlan(plan).changed, true);
    await applySyncPlan(root, plan);
    const next = JSON.parse(await readFile(join(root, 'apps/next/package.json'), 'utf8'));
    assert.equal(next.dependencies['@tileflow/core'], alpha16);
    assert.equal(next.devDependencies['@tileflow/cli'], alpha16);
    const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
    assert.match(workspace, /minimumReleaseAge: 1440/u);
    assert.match(workspace, /@tileflow\/static@0\.1\.0-alpha\.16/u);

    const noOp = await createSyncPlan({repositoryRoot: root, getPackageMetadata: registry()});
    assert.deepEqual(noOp.changedFiles, []);
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('fails closed on a registry rollback or a competing range version', async () => {
  const root = await createFixture();
  try {
    await assert.rejects(
      createSyncPlan({
        repositoryRoot: root,
        getPackageMetadata: registry({
          '@tileflow/core': metadata('@tileflow/core', alpha8, {
            [alpha8]: packageVersion('@tileflow/core', alpha8),
          }),
        }),
      }),
      /may not roll back/u,
    );

    const range = '>=0.1.0-alpha.16 <0.1.0-beta.0';
    await assert.rejects(
      createSyncPlan({
        repositoryRoot: root,
        getPackageMetadata: registry({
          '@tileflow/next': metadata('@tileflow/next', alpha16, {
            [alpha16]: packageVersion('@tileflow/next', alpha16, {'@tileflow/dev': range}),
          }),
          '@tileflow/dev': metadata('@tileflow/dev', alpha16, {
            [alpha16]: packageVersion('@tileflow/dev', alpha16, {'@tileflow/core': alpha16}),
            '0.1.0-alpha.17.1': packageVersion('@tileflow/dev', '0.1.0-alpha.17.1'),
          }),
        }),
      }),
      /untagged version/u,
    );
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('owns one explicit workspace release-age policy block', () => {
  const required = [{name: '@tileflow/core', version: alpha16}];
  const first = renderWorkspacePolicy("packages:\n  - 'apps/*'\n", required);
  assert.equal((first.match(/sdk-sync:start/gu) ?? []).length, 1);
  assert.match(first, /minimumReleaseAge: 1440/u);
  const second = renderWorkspacePolicy(first, required);
  assert.equal(first, second);
  assert.throws(
    () => renderWorkspacePolicy('minimumReleaseAge: 5\n', required),
    /managed by SDK sync/u,
  );
});

test('registry client uses the fixed npm host and rejects unknown packages', async () => {
  let observed;
  const client = createRegistryClient(async (url, options) => {
    observed = {options, url: url.toString()};
    return {ok: true, json: async () => metadata('@tileflow/core', alpha16, {})};
  });
  await client('@tileflow/core');
  assert.equal(observed.url, 'https://registry.npmjs.org/%40tileflow%2Fcore');
  assert.equal(observed.options.redirect, 'error');
  await assert.rejects(client('@tileflow/private'), /Refusing to query unknown/u);
});

test('merges only the exact tested pull request through protected main', async () => {
  const baseSha = '1'.repeat(40);
  const headSha = '2'.repeat(40);
  const mergeSha = '3'.repeat(40);
  let mainSha = baseSha;
  const result = await mergeSyncPullRequest({
    baseSha,
    headSha,
    getMainRef: async () => ({object: {sha: mainSha, type: 'commit'}}),
    mergePull: async ({headSha: exactHead, mergeMethod}) => {
      assert.equal(exactHead, headSha);
      assert.equal(mergeMethod, 'squash');
      mainSha = mergeSha;
      return {merged: true, sha: mergeSha};
    },
  });
  assert.equal(result, mergeSha);

  await assert.rejects(
    mergeSyncPullRequest({
      baseSha,
      headSha,
      getMainRef: async () => ({object: {sha: '4'.repeat(40), type: 'commit'}}),
      mergePull: async () => assert.fail('must not merge stale main'),
    }),
    /main advanced/u,
  );
});
