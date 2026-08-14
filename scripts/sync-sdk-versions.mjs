#!/usr/bin/env node

import assert from 'node:assert/strict';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const publicPackageNames = new Set(
  [
    'capture',
    'cli',
    'core',
    'dev',
    'next',
    'react',
    'static',
    'svelte',
    'vite',
    'vue',
    'webpack',
  ].map((name) => `@tileflow/${name}`),
);

const npmRegistry = 'https://registry.npmjs.org/';
const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const publishedDependencySections = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const numericAlphaPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)$/u;
const automaticAlphaRangePattern = /^>=(0\.1\.0-alpha\.(?:0|[1-9]\d*)) <0\.1\.0-beta\.0$/u;
const canonicalSemverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const policyStart = '# sdk-sync:start';
const policyEnd = '# sdk-sync:end';

export function parseNumericAlpha(version, label = 'version') {
  assert.equal(typeof version, 'string', `${label} must be a string.`);
  const match = version.match(numericAlphaPattern);
  assert.ok(match, `${label} must be an exact numeric alpha version, received ${version}.`);
  return match.slice(1).map(Number);
}

export function compareNumericAlpha(left, right) {
  const leftParts = parseNumericAlpha(left, 'Left version');
  const rightParts = parseNumericAlpha(right, 'Right version');
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function parseCanonicalSemver(version) {
  const match = typeof version === 'string' ? version.match(canonicalSemverPattern) : null;
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 || right.length === 0)
    return left.length === right.length ? 0 : left.length ? -1 : 1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/u.test(a);
    const bNumeric = /^\d+$/u.test(b);
    if (aNumeric && bNumeric) return Number(a) - Number(b);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function compareCanonicalSemver(leftVersion, rightVersion) {
  const left = parseCanonicalSemver(leftVersion);
  const right = parseCanonicalSemver(rightVersion);
  assert.ok(left, `Left version must be canonical SemVer, received ${leftVersion}.`);
  assert.ok(right, `Right version must be canonical SemVer, received ${rightVersion}.`);
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] - right[field];
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function requireRegistryVersion(metadata, name, version) {
  assert.equal(metadata?.name, name, `Registry metadata name mismatch for ${name}.`);
  const manifest = metadata?.versions?.[version];
  assert.ok(manifest && typeof manifest === 'object', `${name}@${version} is absent from npm.`);
  assert.equal(manifest.name, name, `${name}@${version} has the wrong package name.`);
  assert.equal(manifest.version, version, `${name}@${version} has the wrong package version.`);
  return manifest;
}

function parsePublishedDependency(version, label) {
  if (numericAlphaPattern.test(version)) return {kind: 'exact', version};
  const match = version.match(automaticAlphaRangePattern);
  assert.ok(
    match,
    `${label} must be an exact numeric alpha or the canonical alpha compatibility range.`,
  );
  return {floor: match[1], kind: 'range'};
}

async function resolvePublishedDependency({name, range, getPackageMetadata, label}) {
  const parsed = parsePublishedDependency(range, label);
  if (parsed.kind === 'exact') return parsed.version;

  const metadata = await getPackageMetadata(name);
  const tagged = metadata?.['dist-tags']?.alpha;
  parseNumericAlpha(tagged, `${name} npm alpha dist-tag`);
  requireRegistryVersion(metadata, name, tagged);
  assert.ok(
    compareNumericAlpha(tagged, parsed.floor) >= 0,
    `${name} alpha ${tagged} is below the dependency floor ${parsed.floor}.`,
  );
  const competitors = Object.keys(metadata.versions)
    .filter((version) => version !== tagged && parseCanonicalSemver(version))
    .filter(
      (version) =>
        compareCanonicalSemver(version, parsed.floor) >= 0 &&
        compareCanonicalSemver(version, '0.1.0-beta.0') < 0 &&
        compareCanonicalSemver(version, tagged) >= 0,
    );
  assert.deepEqual(
    competitors,
    [],
    `${name} has an untagged version that the compatibility range could select: ${competitors.join(', ')}.`,
  );
  return tagged;
}

export async function discoverManifestPaths(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const entries = await readdir(join(root, 'apps'), {withFileTypes: true});
  const paths = ['package.json'];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const path = `apps/${entry.name}/package.json`;
    try {
      await readFile(join(root, path), 'utf8');
      paths.push(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return paths.sort();
}

function readSdkPins(manifest, path) {
  const pins = [];
  for (const section of dependencySections) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (!name.startsWith('@tileflow/')) continue;
      assert.ok(publicPackageNames.has(name), `${path} contains unknown Tileflow package ${name}.`);
      parseNumericAlpha(version, `${path} ${section}.${name}`);
      pins.push({name, path, section, version});
    }
  }
  return pins;
}

function collectDirectVersions(manifests) {
  const versions = new Map();
  for (const {manifest, path} of manifests) {
    for (const pin of readSdkPins(manifest, path)) {
      if (!versions.has(pin.name)) versions.set(pin.name, []);
      versions.get(pin.name).push(pin.version);
    }
  }
  assert.ok(versions.size > 0, 'No Tileflow SDK package is used by the demos.');
  return new Map(
    [...versions]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, pins]) => [name, [...pins].sort(compareNumericAlpha).at(-1)]),
  );
}

async function resolveTargets(currentVersions, getPackageMetadata) {
  const targets = new Map();
  for (const [name, current] of currentVersions) {
    const metadata = await getPackageMetadata(name);
    const target = metadata?.['dist-tags']?.alpha;
    parseNumericAlpha(target, `${name} npm alpha dist-tag`);
    requireRegistryVersion(metadata, name, target);
    assert.ok(
      compareNumericAlpha(target, current) >= 0,
      `${name} alpha tag may not roll back ${current}.`,
    );
    targets.set(name, target);
  }
  return targets;
}

async function resolveRequiredVersions(targets, getPackageMetadata) {
  const required = new Map();
  const queue = [...targets].map(([name, version]) => ({name, version}));
  while (queue.length > 0) {
    const current = queue.shift();
    const key = `${current.name}@${current.version}`;
    if (required.has(key)) continue;
    const metadata = await getPackageMetadata(current.name);
    const manifest = requireRegistryVersion(metadata, current.name, current.version);
    required.set(key, current);
    for (const section of publishedDependencySections) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (!name.startsWith('@tileflow/')) continue;
        assert.ok(
          publicPackageNames.has(name),
          `${key} contains unknown Tileflow dependency ${name}.`,
        );
        queue.push({
          name,
          version: await resolvePublishedDependency({
            name,
            range,
            getPackageMetadata,
            label: `${key} ${section}.${name}`,
          }),
        });
      }
    }
  }
  return [...required.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || compareNumericAlpha(a.version, b.version),
  );
}

export function renderWorkspacePolicy(source, requiredVersions) {
  const start = source.indexOf(policyStart);
  const end = source.indexOf(policyEnd);
  assert.equal(start === -1, end === -1, 'SDK sync workspace policy markers must appear together.');
  if (start === -1) {
    assert.doesNotMatch(
      source,
      /^minimumReleaseAge(?:Exclude)?:/mu,
      'Release-age policy must be managed by SDK sync.',
    );
  } else {
    assert.ok(start < end, 'SDK sync workspace policy markers are out of order.');
  }
  const block = [
    policyStart,
    'minimumReleaseAge: 1440',
    'minimumReleaseAgeExclude:',
    ...requiredVersions.map(({name, version}) => `  - '${name}@${version}'`),
    policyEnd,
  ].join('\n');
  const prefix = start === -1 ? source.trimEnd() : source.slice(0, start).trimEnd();
  const suffix = start === -1 ? '' : source.slice(end + policyEnd.length).trimStart();
  return `${prefix}\n\n${block}\n${suffix ? `\n${suffix}` : ''}`;
}

export async function createSyncPlan({repositoryRoot, getPackageMetadata}) {
  const root = resolve(repositoryRoot);
  const manifestPaths = await discoverManifestPaths(root);
  const manifests = await Promise.all(
    manifestPaths.map(async (path) => {
      const source = await readFile(join(root, path), 'utf8');
      return {manifest: JSON.parse(source), path, source};
    }),
  );
  const currentVersions = collectDirectVersions(manifests);
  const targetVersions = await resolveTargets(currentVersions, getPackageMetadata);
  const requiredVersions = await resolveRequiredVersions(targetVersions, getPackageMetadata);
  const desiredFiles = new Map();
  const updates = [];
  for (const entry of manifests) {
    const manifest = structuredClone(entry.manifest);
    for (const section of dependencySections) {
      for (const [name, current] of Object.entries(manifest[section] ?? {})) {
        if (!publicPackageNames.has(name)) continue;
        const target = targetVersions.get(name);
        assert.ok(target, `No target version was resolved for ${name}.`);
        if (current !== target) {
          manifest[section][name] = target;
          updates.push({current, name, path: entry.path, section, target});
        }
      }
    }
    desiredFiles.set(entry.path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const workspacePath = 'pnpm-workspace.yaml';
  const workspaceSource = await readFile(join(root, workspacePath), 'utf8');
  desiredFiles.set(workspacePath, renderWorkspacePolicy(workspaceSource, requiredVersions));
  const currentFiles = new Map(manifests.map(({path, source}) => [path, source]));
  currentFiles.set(workspacePath, workspaceSource);
  const changedFiles = [...desiredFiles]
    .filter(([path, contents]) => currentFiles.get(path) !== contents)
    .map(([path]) => path)
    .sort();
  return {changedFiles, currentVersions, desiredFiles, requiredVersions, targetVersions, updates};
}

export async function applySyncPlan(repositoryRoot, plan) {
  for (const path of plan.changedFiles) {
    await writeFile(join(resolve(repositoryRoot), path), plan.desiredFiles.get(path));
  }
}

export function summarizePlan(plan) {
  return {
    changed: plan.changedFiles.length > 0,
    changeCount: plan.changedFiles.length,
    changedFiles: plan.changedFiles,
    targets: Object.fromEntries(plan.targetVersions),
    requiredVersions: plan.requiredVersions.map(({name, version}) => `${name}@${version}`),
    updates: plan.updates,
  };
}

export function createRegistryClient(fetchImplementation = globalThis.fetch) {
  assert.equal(typeof fetchImplementation, 'function', 'A Fetch implementation is required.');
  const cache = new Map();
  return async (name) => {
    assert.ok(publicPackageNames.has(name), `Refusing to query unknown package ${name}.`);
    if (!cache.has(name)) {
      cache.set(
        name,
        (async () => {
          const response = await fetchImplementation(
            new URL(encodeURIComponent(name), npmRegistry),
            {
              cache: 'no-store',
              headers: {accept: 'application/json'},
              redirect: 'error',
              signal: AbortSignal.timeout(30_000),
            },
          );
          assert.equal(response.ok, true, `npm returned ${response.status} for ${name}.`);
          return response.json();
        })(),
      );
    }
    return cache.get(name);
  };
}

function assertCommitRef(ref, label) {
  assert.equal(ref?.object?.type, 'commit', `${label} must resolve to a commit.`);
  assert.match(ref.object.sha ?? '', commitPattern, `${label} has an invalid SHA.`);
  return ref.object.sha;
}

export async function mergeSyncPullRequest({baseSha, headSha, getMainRef, mergePull}) {
  assert.match(baseSha ?? '', commitPattern, 'Sync base SHA is invalid.');
  assert.match(headSha ?? '', commitPattern, 'Sync head SHA is invalid.');
  assert.notEqual(baseSha, headSha, 'Sync head must differ from its base.');
  assert.equal(
    assertCommitRef(await getMainRef(), 'main before sync'),
    baseSha,
    'main advanced before sync merge.',
  );
  let result;
  try {
    result = await mergePull({headSha, mergeMethod: 'squash'});
  } catch (error) {
    throw new Error('Protected SDK sync pull-request merge was rejected.', {cause: error});
  }
  assert.equal(result?.merged, true, 'GitHub did not merge the exact sync pull request.');
  assert.match(result.sha ?? '', commitPattern, 'GitHub returned an invalid merge SHA.');
  assert.equal(
    assertCommitRef(await getMainRef(), 'main after sync'),
    result.sha,
    'main does not contain the returned merge SHA.',
  );
  return result.sha;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  assert.ok(['apply', 'check', 'plan'].includes(command), 'Expected apply, check, or plan.');
  assert.deepEqual(rest, [], 'Unexpected arguments.');
  const plan = await createSyncPlan({
    repositoryRoot: process.cwd(),
    getPackageMetadata: createRegistryClient(),
  });
  if (command === 'apply') await applySyncPlan(process.cwd(), plan);
  if (command === 'check') {
    assert.deepEqual(plan.changedFiles, [], `SDK pins are stale: ${plan.changedFiles.join(', ')}.`);
  }
  console.log(JSON.stringify(summarizePlan(plan), null, 2));
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
