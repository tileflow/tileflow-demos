const R = 6371008.8,
  RAD = Math.PI / 180,
  LIMIT = Math.atan(Math.sinh(Math.PI)) / RAD;
const tileJSONURL = 'https://api.tileflow.dev/tiles/terrain/tiles.json';
const tileCache = new Map();
const CACHE_BYTES = 32 * 1024 * 1024,
  MAX_REQUESTS = 24;
let cacheBytes = 0,
  catalog = null;

function wrap(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function point(lat, lon, east, north) {
  const phi = lat * RAD,
    theta = Math.atan2(east, north),
    dist = Math.hypot(east, north) / R;
  const sin = Math.sin(dist),
    cos = Math.cos(dist),
    c = Math.cos(phi),
    s = Math.sin(phi);
  const targetPhi = Math.asin(Math.min(1, Math.max(-1, s * cos + c * sin * Math.cos(theta))));
  return {
    lat: targetPhi / RAD,
    lon: wrap(lon + Math.atan2(Math.sin(theta) * sin * c, cos - s * Math.sin(targetPhi)) / RAD),
  };
}

function offset(lat, lon, toLat, toLon) {
  const a = lat * RAD,
    b = toLat * RAD,
    dl = wrap(toLon - lon) * RAD;
  const ex = Math.cos(b) * Math.sin(dl);
  const ny = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dl);
  const sin = Math.hypot(ex, ny),
    cos = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dl);
  if (sin === 0) return {east: 0, north: 0};
  const scale = (R * Math.atan2(sin, cos)) / sin;
  return {east: scale * ex, north: scale * ny};
}

function check(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Request canceled', 'AbortError');
}

async function download(url, signal, read) {
  check(signal);
  const timeout = new AbortController();
  const abort = () => timeout.abort(signal.reason);
  signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(
    () => timeout.abort(new Error('Tileflow Terrain took too long to respond.')),
    20000,
  );
  try {
    const response = await fetch(url, {credentials: 'omit', signal: timeout.signal});
    return await read(response);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function serviceError(response) {
  if (response.status === 429)
    return new Error('Tileflow is temporarily limiting requests. Try again later.');
  if (response.status === 403) return new Error('Tileflow denied access to this terrain request.');
  return new Error('Tileflow Terrain returned HTTP ' + response.status + '.');
}

async function describe(signal) {
  if (catalog) return catalog;
  const info = await download(tileJSONURL, signal, async (response) => {
    if (!response.ok) throw serviceError(response);
    return response.json();
  });
  const url = info.tiles?.[0],
    tileSize = info.tileSize,
    release = info.tileflow?.tileVersion;
  if (
    info.encoding !== 'terrarium' ||
    info.scheme !== 'xyz' ||
    info.format !== 'webp' ||
    !Number.isInteger(tileSize) ||
    tileSize < 1 ||
    tileSize > 1024 ||
    !release ||
    !Number.isInteger(info.tileflow.baseMaxzoom) ||
    !url?.startsWith('https://') ||
    !['{x}', '{y}', '{z}'].every((token) => url.includes(token))
  ) {
    throw new Error('This explorer cannot read the format of the terrain catalog.');
  }
  const descriptorSha256 = new URL(url).searchParams.get('terrainDescriptorSha256');
  if (!/^[0-9a-f]{64}$/i.test(descriptorSha256) || !url.includes('/' + release + '/')) {
    throw new Error('The elevation source did not identify a fixed data release.');
  }
  catalog = {
    url,
    tileSize,
    release,
    descriptorSha256,
    baseMaxzoom: info.tileflow.baseMaxzoom,
    minzoom: info.minzoom ?? 0,
    attribution: info.attribution,
    coverage: info.tileflow.coverage,
  };
  return catalog;
}

async function decode(bytes, size) {
  // Only the lossless codec is valid for RGB-encoded elevations. No color profiles or
  // premultiplication are applied by createImageBitmap. Nonopaque samples become NoData.
  const marker = new TextDecoder('ascii').decode(bytes.subarray(8, 16));
  if (marker !== 'WEBPVP8L') throw new Error('The elevation tile must use lossless WebP (VP8L).');
  const bitmap = await createImageBitmap(new Blob([bytes], {type: 'image/webp'}), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
    imageOrientation: 'none',
  });
  try {
    if (bitmap.width !== size || bitmap.height !== size)
      throw new Error('An elevation tile has unexpected dimensions.');
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d', {willReadFrequently: true, colorSpace: 'srgb'});
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, size, size).data,
      elevations = new Float32Array(size * size);
    for (let i = 0, k = 0; i < elevations.length; i++, k += 4) {
      elevations[i] =
        data[k + 3] === 255 ? data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768 : NaN;
    }
    return elevations;
  } finally {
    bitmap.close();
  }
}

async function getTile(source, z, x, y, signal, metrics) {
  const url = source.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const cached = tileCache.get(url);
  if (cached) {
    metrics.tileCacheHits++;
    tileCache.delete(url);
    tileCache.set(url, cached);
    return cached;
  }
  const t0 = performance.now();
  const bytes = await download(url, signal, async (response) => {
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok) throw serviceError(response);
    return new Uint8Array(await response.arrayBuffer());
  });
  metrics.tileFetchMs += performance.now() - t0;
  if (!bytes) return null;
  metrics.tileBytes += bytes.byteLength;
  const t1 = performance.now();
  const values = await decode(bytes, source.tileSize);
  metrics.tileDecodeMs += performance.now() - t1;
  check(signal);
  if (tileCache.has(url)) return tileCache.get(url);
  tileCache.set(url, values);
  cacheBytes += values.byteLength;
  while (cacheBytes > CACHE_BYTES) {
    const oldest = tileCache.keys().next().value;
    cacheBytes -= tileCache.get(oldest).byteLength;
    tileCache.delete(oldest);
  }
  return values;
}

async function readTileWindow(source, zoom, {left, right, top, bottom}, {signal, progress, metrics}) {
  const dim = source.tileSize, n = 2 ** zoom;
  const width = right - left + 1,
    count = width * (bottom - top + 1);
  if (!Number.isFinite(count) || count < 1 || count > MAX_REQUESTS)
    throw new Error('This area exceeds the terrain tile limit for the explorer.');
  const tiles = new Array(count),
    jobs = new AbortController();
  const cancel = () => jobs.abort(signal.reason);
  signal?.addEventListener('abort', cancel, {once: true});
  let next = 0,
    done = 0,
    missing = 0;
  progress?.({done, total: count});
  async function work() {
    while (next < count) {
      check(jobs.signal);
      const index = next++,
        x = (((left + (index % width)) % n) + n) % n,
        y = top + Math.floor(index / width);
      const values = await getTile(source, zoom, x, y, jobs.signal, metrics);
      if (!values) missing++;
      tiles[index] = values;
      progress?.({done: ++done, total: count});
    }
  }
  try {
    check(signal);
    await Promise.all(Array.from({length: Math.min(3, count)}, work));
  } catch (error) {
    jobs.abort();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  check(signal);
  const sample = (x, y) => {
    const tx = Math.floor(x / dim),
      ty = Math.floor(y / dim);
    if (tx < left || tx > right || ty < top || ty > bottom) return NaN;
    const tile = tiles[(ty - top) * width + tx - left];
    return tile ? tile[(y - ty * dim) * dim + x - tx * dim] : NaN;
  };
  function heightAtPixel(sx, sy) {
    const x = Math.floor(sx),
      y = Math.floor(sy),
      fx = sx - x,
      fy = sy - y;
    let upper = sample(x, y);
    if (fx > 0) upper += fx * (sample(x + 1, y) - upper);
    if (fy > 0) {
      let lower = sample(x, y + 1);
      if (fx > 0) lower += fx * (sample(x + 1, y + 1) - lower);
      upper += fy * (lower - upper);
    }
    return upper;
  }
  const sourceTiles = tiles.map((tile, i) => ({
    z: zoom,
    x: (((left + (i % width)) % n) + n) % n,
    y: top + Math.floor(i / width),
    available: !!tile,
  }));
  return {heightAtPixel, sourceTiles, missing};
}

async function gridTerrain(lat, lon, {signal, progress, size = 401, spacing = 50} = {}) {
  check(signal);
  if (!Number.isFinite(lat) || Math.abs(lat) > LIMIT || !Number.isFinite(lon)) {
    throw new Error('Tileflow Terrain covers latitudes between 85.05° S and 85.05° N.');
  }
  if (
    !Number.isInteger(size) ||
    size % 2 !== 1 ||
    size < 3 ||
    size > 801 ||
    !Number.isFinite(spacing) ||
    spacing < 5 ||
    spacing > 1000
  ) {
    throw new RangeError('The terrain grid has an invalid resolution or extent.');
  }
  lon = wrap(lon);
  const metrics = {tileFetchMs: 0, tileDecodeMs: 0, tileBytes: 0, tileCacheHits: 0, gridMs: 0};
  const source = await describe(signal),
    dim = source.tileSize;
  const zoom = Math.min(
    source.baseMaxzoom,
    Math.max(
      source.minzoom,
      Math.ceil(Math.log2((2 * Math.PI * R * Math.cos(lat * RAD)) / (dim * spacing))),
    ),
  );
  const n = 2 ** zoom,
    totalPixels = n * dim,
    mid = (size - 1) / 2;
  // Keep source pixel coordinates continuous across 180°. Wrap tile x at lookup time.
  const mapStart = performance.now();
  const px = new Float64Array(size * size),
    py = new Float64Array(size * size);
  let xmin = Infinity,
    xmax = -Infinity,
    ymin = Infinity,
    ymax = -Infinity;
  for (let y = 0; y < size; y++) {
    const north = (mid - y) * spacing;
    for (let x = 0; x < size; x++) {
      const i = y * size + x,
        p = point(lat, lon, (x - mid) * spacing, north);
      if (Math.abs(p.lat) > LIMIT) {
        px[i] = NaN;
        py[i] = NaN;
        continue;
      }
      const sx = ((lon + wrap(p.lon - lon) + 180) / 360) * totalPixels - 0.5;
      const sy = (1 - Math.asinh(Math.tan(p.lat * RAD)) / Math.PI) * 0.5 * totalPixels - 0.5;
      px[i] = sx;
      py[i] = sy;
      xmin = Math.min(xmin, sx);
      xmax = Math.max(xmax, sx);
      ymin = Math.min(ymin, sy);
      ymax = Math.max(ymax, sy);
    }
  }
  metrics.gridMs = performance.now() - mapStart;
  const left = Math.floor(xmin / dim),
    right = Math.floor(Math.ceil(xmax) / dim);
  const top = Math.max(0, Math.floor(ymin / dim)),
    bottom = Math.min(n - 1, Math.floor(Math.ceil(ymax) / dim));
  const {heightAtPixel, sourceTiles, missing} = await readTileWindow(
    source, zoom, {left, right, top, bottom}, {signal, progress, metrics},
  );
  const sampleStart = performance.now();
  const heights = new Float32Array(px.length);
  let validCells = 0;
  for (let i = 0; i < px.length; i++) {
    if (!Number.isFinite(px[i])) {
      heights[i] = NaN;
      continue;
    }
    const upper = heightAtPixel(px[i], py[i]);
    heights[i] = upper;
    if (Number.isFinite(upper)) validCells++;
  }
  metrics.gridMs += performance.now() - sampleStart;
  return {
    heights,
    size,
    spacing,
    metrics,
    tiles: sourceTiles,
    release: source.release,
    descriptorSha256: source.descriptorSha256,
    lat,
    lon,
    zoom,
    validCells,
    tileCount: sourceTiles.length,
    missingTiles: missing,
    attribution: source.attribution,
    errors: missing
      ? [
          missing +
            (missing === 1
              ? ' elevation tile has no coverage.'
              : ' elevation tiles have no coverage.'),
        ]
      : [],
  };
}

// Read the native DEM pixels for uninterrupted point-to-point rays. At high
// latitudes, descend only as many tile levels as needed for the request budget.
export async function nativeTerrain(lat, lon, {signal, radius = 10000} = {}) {
  if (!Number.isFinite(lat) || Math.abs(lat) > LIMIT || !Number.isFinite(lon) || !(radius > 0 && radius <= 10000))
    throw new RangeError('The native elevation window needs a valid location and radius up to 10 km.');
  lon = wrap(lon);
  const source = await describe(signal);
  const dim = source.tileSize;
  const arc = radius / R;
  const lonSpan = Math.asin(Math.min(1, Math.sin(arc) / Math.cos(lat * RAD))) / RAD;
  const yAtLat = (at) => (1 - Math.asinh(Math.tan(at * RAD)) / Math.PI) / 2;
  let zoom = source.baseMaxzoom, bounds;
  for (; zoom >= source.minzoom; zoom--) {
    const scale = 2 ** zoom, pixels = scale * dim;
    // The half-pixel padding includes both neighbours for bilinear samples.
    const left = Math.floor(((lon - lonSpan + 180) / 360 * pixels - 0.5) / dim);
    const right = Math.floor(Math.ceil((lon + lonSpan + 180) / 360 * pixels - 0.5) / dim);
    const top = Math.max(0, Math.floor((yAtLat(Math.min(LIMIT, lat + arc / RAD)) * pixels - 0.5) / dim));
    const bottom = Math.min(scale - 1, Math.floor(Math.ceil(yAtLat(Math.max(-LIMIT, lat - arc / RAD)) * pixels - 0.5) / dim));
    if ((right - left + 1) * (bottom - top + 1) <= MAX_REQUESTS) {
      bounds = {left, right, top, bottom};
      break;
    }
  }
  if (!bounds) throw new Error('The native elevation window exceeds the terrain tile limit.');
  const metrics = {tileFetchMs: 0, tileDecodeMs: 0, tileBytes: 0, tileCacheHits: 0};
  const {heightAtPixel, sourceTiles, missing} = await readTileWindow(source, zoom, bounds, {signal, metrics});
  const pixels = 2 ** zoom * dim;
  const heightAtLngLat = (sampleLat, sampleLon) => {
    if (Math.abs(sampleLat) > LIMIT) return NaN;
    const sx = (lon + wrap(sampleLon - lon) + 180) / 360 * pixels - 0.5;
    return heightAtPixel(sx, yAtLat(sampleLat) * pixels - 0.5);
  };
  return {
    zoom, spacing: 2 * Math.PI * R * Math.cos(lat * RAD) / pixels,
    release: source.release, descriptorSha256: source.descriptorSha256,
    tiles: sourceTiles, missingTiles: missing, metrics, heightAtLngLat,
    heightAt(east, north) {
      const sample = point(lat, lon, east, north);
      return heightAtLngLat(sample.lat, sample.lon);
    },
  };
}

// A contiguous Web Mercator elevation mosaic around a point, for map-aligned rasters.
// Tiles that the release omits read as sea level.
export async function terrainMosaic(lat, lon, {signal, radius = 20000, zoom = 11} = {}) {
  if (!Number.isFinite(lat) || Math.abs(lat) > LIMIT || !Number.isFinite(lon) || !(radius > 0))
    throw new RangeError('The relief mosaic needs a valid location and radius.');
  lon = wrap(lon);
  const source = await describe(signal);
  const dim = source.tileSize;
  zoom = Math.max(source.minzoom, Math.min(zoom, source.baseMaxzoom));
  const yAtLat = (at) => (1 - Math.asinh(Math.tan(at * RAD)) / Math.PI) / 2;
  let bounds;
  for (; zoom >= source.minzoom; zoom--) {
    const pixels = 2 ** zoom * dim,
      metres = (2 * Math.PI * R * Math.cos(lat * RAD)) / pixels;
    const cx = ((lon + 180) / 360) * pixels,
      cy = yAtLat(lat) * pixels,
      span = radius / metres;
    const left = Math.floor((cx - span) / dim),
      right = Math.floor((cx + span) / dim);
    const top = Math.max(0, Math.floor((cy - span) / dim)),
      bottom = Math.min(2 ** zoom - 1, Math.floor((cy + span) / dim));
    if ((right - left + 1) * (bottom - top + 1) <= MAX_REQUESTS) {
      bounds = {left, right, top, bottom, cx, cy, metres};
      break;
    }
  }
  if (!bounds) throw new Error('The relief mosaic exceeds the terrain tile limit.');
  const {left, right, top, bottom} = bounds,
    n = 2 ** zoom,
    cols = right - left + 1,
    rows = bottom - top + 1;
  const width = cols * dim,
    height = rows * dim,
    heights = new Float32Array(width * height);
  const metrics = {tileFetchMs: 0, tileDecodeMs: 0, tileBytes: 0, tileCacheHits: 0};
  let next = 0;
  async function work() {
    while (next < cols * rows) {
      check(signal);
      const index = next++,
        tx = index % cols,
        ty = Math.floor(index / cols);
      const x = (((left + tx) % n) + n) % n;
      const tile = await getTile(source, zoom, x, top + ty, signal, metrics);
      for (let r = 0; r < dim; r++) {
        const row = (ty * dim + r) * width + tx * dim;
        for (let c = 0; c < dim; c++) {
          const v = tile ? tile[r * dim + c] : 0;
          heights[row + c] = Number.isFinite(v) ? v : 0;
        }
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(4, cols * rows)}, work));
  check(signal);
  const lngLat = (px, py) => {
    const gx = left * dim + px,
      gy = top * dim + py;
    return [
      (gx / (n * dim)) * 360 - 180,
      Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / (n * dim)))) / RAD,
    ];
  };
  return {
    zoom,
    width,
    height,
    heights,
    metres: bounds.metres,
    centre: {x: bounds.cx - left * dim, y: bounds.cy - top * dim},
    lngLat,
    release: source.release,
    metrics,
  };
}

export {gridTerrain};
export const TerrainProjection = {point, offset};
