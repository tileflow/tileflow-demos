import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import seed from './data/peak-catalog-seed.json';

const tileJSON = 'https://api.tileflow.dev/tiles/world/tiles.json';
const DEG = Math.PI / 180,
  EARTH = 6371008.8,
  LIMIT = Math.atan(Math.sinh(Math.PI)) / DEG;
const TILE_BUDGET = 22,
  CONCURRENCY = 3,
  TILE_CACHE_SIZE = 150,
  MAX_BYTES = 2 * 1024 * 1024;
const CACHE_AGE = 5 * 60 * 1000;
const cachedTiles = new Map();
let lastDescriptor,
  refreshedAt = 0;
const wrapLon = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
const sin = Math.sin,
  cos = Math.cos;

function check(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Request canceled', 'AbortError');
}
async function get(url, signal, handler) {
  check(signal);
  const controller = new AbortController(),
    abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(
    () => controller.abort(new Error('Tileflow World took too long to respond.')),
    8000,
  );
  try {
    const response = await fetch(url, {credentials: 'omit', signal: controller.signal});
    if (!response.ok) {
      const error = new Error('Tileflow World returned HTTP ' + response.status + '.');
      error.status = response.status;
      throw error;
    }
    return await handler(response);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
function describe(info) {
  const world = info?.tileflow?.world;
  const source = info?.vector_layers?.find(
    (layer) =>
      ['natural_label', 'mountain_peak'].includes(layer.id) &&
      layer.fields?.class &&
      Object.keys(layer.fields).some((k) => k === 'name' || k.startsWith('name_')),
  );
  const template = info?.tiles?.find(
    (s) =>
      typeof s === 'string' &&
      s.startsWith('https://') &&
      ['{x}', '{y}', '{z}'].every((token) => s.includes(token)),
  );
  if (
    !template ||
    !source ||
    !world?.releaseId ||
    !/^[0-9a-f]{64}$/i.test(world.descriptorSha256) ||
    !template.includes('/' + world.releaseId + '/') ||
    new URL(template).searchParams.get('worldDescriptorSha256') !== world.descriptorSha256 ||
    (info.scheme && info.scheme !== 'xyz')
  )
    throw new Error('This release of Tileflow World uses an unsupported peak catalog schema.');
  return {
    release: world.releaseId,
    descriptorSha256: world.descriptorSha256,
    template,
    layer: source.id,
    minzoom: Math.max(7, info.minzoom ?? 0, source.minzoom ?? 0),
    maxzoom: Math.min(14, info.maxzoom, source.maxzoom ?? info.maxzoom),
  };
}
async function descriptor(signal) {
  if (lastDescriptor && Date.now() - refreshedAt < CACHE_AGE)
    return {source: lastDescriptor, archived: false};
  let info;
  try {
    info = await get(tileJSON, signal, (response) => response.json());
  } catch (e) {
    check(signal);
    // The snapshot is an identified, immutable release, including complete per-tile peak extracts.
    // Access failures cannot trigger fresh bulk requests; only those saved extracts are eligible.
    const source = lastDescriptor || seed.descriptor;
    if (source) return {source, archived: true, message: e.message};
    throw e;
  }
  lastDescriptor = describe(info);
  refreshedAt = Date.now();
  return {source: lastDescriptor, archived: false};
}
const tileY = (lat, n) =>
  Math.min(
    n - 1,
    Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(lat * DEG)) / Math.PI) * n) / 2)),
  );
const tileLat = (y, n) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / DEG;
const distance = (lat, lon, y, x) => {
  const a =
    sin(((y - lat) * DEG) / 2) ** 2 +
    cos(lat * DEG) * cos(y * DEG) * sin(((x - lon) * DEG) / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(Math.min(1, a)));
};
function plan(lat, lon, radius, source) {
  const angle = radius / EARTH,
    north = Math.min(LIMIT, lat + angle / DEG),
    south = Math.max(-LIMIT, lat - angle / DEG);
  const dLon = Math.asin(Math.min(1, sin(angle) / cos(lat * DEG))) / DEG;
  for (let z = source.maxzoom; z >= source.minzoom; z--) {
    const n = 2 ** z,
      firstX = Math.floor(((lon - dLon + 180) * n) / 360),
      lastX = Math.floor(((lon + dLon + 180) * n) / 360);
    const y0 = tileY(north, n),
      y1 = tileY(south, n);
    if ((lastX - firstX + 1) * (y1 - y0 + 1) > 2 * TILE_BUDGET) continue;
    const tiles = [],
      seen = new Set();
    for (let y = y0; y <= y1; y++)
      for (let x = firstX; x <= lastX; x++) {
        const xmin = (x * 360) / n - 180,
          xmax = ((x + 1) * 360) / n - 180,
          closestLon = Math.min(xmax, Math.max(xmin, lon));
        const closestLat = Math.min(
          tileLat(y, n),
          Math.max(
            tileLat(y + 1, n),
            Math.atan2(sin(lat * DEG), cos(lat * DEG) * cos((closestLon - lon) * DEG)) / DEG,
          ),
        );
        if (distance(lat, lon, closestLat, closestLon) > radius + 0.01) continue;
        const wrapped = ((x % n) + n) % n,
          key = z + '/' + wrapped + '/' + y;
        if (!seen.has(key)) {
          tiles.push({z, x: wrapped, y, key});
          seen.add(key);
        }
      }
    if (tiles.length <= TILE_BUDGET) return {z, tiles};
  }
  throw new Error('The search radius exceeds the peak catalog tile limit.');
}
function nameOf(p) {
  const value = [p.name_en, p.name, p.name_latin].find((s) => typeof s === 'string' && s.trim());
  return value ? value.trim() : null;
}
function decode(bytes, source, tile) {
  if (!bytes.byteLength) return [];
  if (bytes.byteLength > MAX_BYTES) throw new Error('A World tile exceeds the decoding limit.');
  const layer = new VectorTile(new Pbf(bytes)).layers[source.layer];
  if (!layer) return [];
  const rows = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i),
      p = f.properties;
    if (f.type !== 1 || !['peak', 'volcano'].includes(p.class)) continue;
    const geometry = f.toGeoJSON(tile.x, tile.y, tile.z).geometry;
    if (geometry.type !== 'Point') continue;
    const [longitude, lat] = geometry.coordinates,
      lon = wrapLon(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = nameOf(p),
      elevation = p.ele;
    const catalogElevationM =
      (typeof elevation === 'number' ||
        (typeof elevation === 'string' && /^-?\d+(\.\d+)?$/.test(elevation.trim()))) &&
      Number.isFinite(+elevation)
        ? +elevation
        : null;
    const featureId = Number.isSafeInteger(f.id) && f.id > 0 ? String(f.id) : null;
    // Duplicate buffered geometry is quantized on the same global MVT lattice at a given zoom.
    // Keep unnamed features separate unless both their class and precise location coincide.
    const id = featureId
      ? 'world:' + p.class + ':' + featureId
      : 'world:' + p.class + ':' + (name ?? '') + ':' + lat.toFixed(7) + ',' + lon.toFixed(7);
    rows.push({id, name, lat, lon, catalogElevationM, classification: p.class});
  }
  return rows;
}
const cacheKey = (source, tile) => source.descriptorSha256 + '/' + tile.key;
function getCached(source, tile) {
  const key = cacheKey(source, tile);
  if (cachedTiles.has(key)) {
    const rows = cachedTiles.get(key);
    cachedTiles.delete(key);
    cachedTiles.set(key, rows);
    return rows;
  }
  if (
    seed.descriptor?.descriptorSha256 === source.descriptorSha256 &&
    Object.hasOwn(seed.tiles, tile.key)
  )
    return seed.tiles[tile.key];
  return null;
}
async function getTile(source, tile, signal, archived, metrics) {
  const saved = getCached(source, tile);
  if (saved !== null) {
    metrics.cachedTiles++;
    return saved;
  }
  if (archived) throw new Error('This tile is missing from the saved World release.');
  const url = source.template.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y);
  const bytes = await get(url, signal, async (response) => {
    if (response.status === 204) return new Uint8Array(0);
    if (Number(response.headers.get('content-length')) > MAX_BYTES)
      throw new Error('A World tile exceeds the download limit.');
    return new Uint8Array(await response.arrayBuffer());
  });
  check(signal);
  const start = performance.now(),
    rows = decode(bytes, source, tile);
  metrics.decodeMs += performance.now() - start;
  metrics.decodedBytes += bytes.byteLength;
  cachedTiles.set(cacheKey(source, tile), rows);
  if (cachedTiles.size > TILE_CACHE_SIZE) cachedTiles.delete(cachedTiles.keys().next().value);
  return rows;
}
async function query({lat, lon, radius, signal, onProgress}) {
  if (
    ![lat, lon, radius].every(Number.isFinite) ||
    Math.abs(lat) > LIMIT ||
    radius <= 0 ||
    radius > 100000
  )
    throw new RangeError('The coordinates or radius are outside the peak catalog range.');
  const start = performance.now(),
    metrics = {decodedBytes: 0, decodeMs: 0, cachedTiles: 0, elapsedMs: 0};
  const result = {
    peaks: [],
    partial: true,
    zoom: null,
    release: null,
    descriptorSha256: null,
    generalized: false,
    totalTiles: 0,
    loadedTiles: 0,
    failedTiles: 0,
    archived: false,
    notice: null,
    error: null,
    metrics,
  };
  try {
    lon = wrapLon(lon);
    const {source, archived, message} = await descriptor(signal),
      {z, tiles} = plan(lat, lon, radius, source);
    Object.assign(result, {
      zoom: z,
      release: source.release,
      descriptorSha256: source.descriptorSha256,
      generalized: z < 14,
      totalTiles: tiles.length,
      archived,
      notice: message ? 'Using the saved World release.' : null,
    });
    const peaks = new Map();
    let cursor = 0,
      stop = false;
    const clipped = Math.abs(lat) + radius / EARTH / DEG > LIMIT;
    function progress() {
      onProgress?.({loaded: result.loadedTiles, failed: result.failedTiles, total: tiles.length});
    }
    progress();
    async function run() {
      while (cursor < tiles.length && !stop) {
        check(signal);
        const tile = tiles[cursor++];
        try {
          const rows = await getTile(source, tile, signal, archived, metrics);
          for (const row of rows)
            if (!peaks.has(row.id) && distance(lat, lon, row.lat, row.lon) <= radius)
              peaks.set(row.id, {...row});
          result.loadedTiles++;
        } catch (e) {
          check(signal);
          result.failedTiles++;
          result.error = e.message;
          if (e.status === 429 || e.status === 403 || e.status === 401) stop = true;
        }
        progress();
      }
    }
    await Promise.all(Array.from({length: Math.min(tiles.length, CONCURRENCY)}, run));
    check(signal);
    result.failedTiles = tiles.length - result.loadedTiles;
    result.partial = clipped || result.failedTiles > 0;
    result.peaks = [...peaks.values()].sort((a, b) => a.id.localeCompare(b.id));
    progress();
  } catch (e) {
    check(signal);
    result.error = e.message;
  }
  metrics.elapsedMs = performance.now() - start;
  return result;
}

export {query, describe, plan, decode, distance};
