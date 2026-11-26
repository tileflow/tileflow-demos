import madeiraUrl from './data/madeira.f32?url';
import madeiraMetadata from './data/madeira.json';
import madeiraNearUrl from './data/madeira-near.f32?url';
import madeiraNearMetadata from './data/madeira-near.json';
import {gridTerrain, nativeTerrain, TerrainProjection} from './world-terrain';
import Visibility from './visibility';
import DiscoveryGeometry from './discovery-geometry';
import * as PeakCatalog from './peak-catalog';

const SIZE = 401,
  MID = (SIZE - 1) / 2,
  STEP = 50,
  R = 6371008.8,
  DEG = Math.PI / 180,
  LAT_LIMIT = 85.0511287798066;
let madeira, madeiraNear, current, generation, controller, result, options, frame;
let computedRev,
  cachedHorizon,
  canonical,
  rawCatalog,
  catalogControl,
  catalogRadius,
  catalogSequence = 0,
  lastTerrainMs = 0;
let view = {mode: 'visibility', showHidden: true};
const mercY = (lat) => Math.asinh(Math.tan(lat * DEG));
const invY = (y) => Math.atan(Math.sinh(y)) / DEG;
function screenGrid(grid) {
  const {lat, lon} = grid,
    radius = (MID + 0.5) * STEP;
  const arc = radius / R,
    dx = Math.asin(Math.sin(arc) / Math.cos(lat * DEG)) / DEG;
  const ymin = mercY(Math.max(-LAT_LIMIT, lat - arc / DEG)),
    ymax = mercY(Math.min(LAT_LIMIT, lat + arc / DEG));
  const min = lon - dx,
    max = lon + dx,
    segments =
      min < -180
        ? [
            [min, -180, 360],
            [-180, max, 0],
          ]
        : max > 180
          ? [
              [min, 180, 0],
              [180, max, -360],
            ]
          : [[min, max, 0]];
  return segments
    .filter(([a, b]) => a < b)
    .map(([west, east, offset]) => {
      const w = Math.max(1, Math.round((SIZE * (east - west)) / (max - min)));
      const h = Math.max(1, Math.round((SIZE * (ymax - ymin)) / ((max - min) * DEG)));
      const indices = new Int32Array(w * h).fill(-1);
      for (let y = 0; y < h; y++) {
        const latY = invY(ymax - ((y + 0.5) / h) * (ymax - ymin));
        for (let x = 0; x < w; x++) {
          const pt = TerrainProjection.offset(
            lat,
            lon,
            latY,
            west + ((x + 0.5) / w) * (east - west),
          );
          const col = Math.round(MID + pt.east / STEP),
            row = Math.round(MID - pt.north / STEP);
          if (col >= 0 && col < SIZE && row >= 0 && row < SIZE)
            indices[y * w + x] = row * SIZE + col;
        }
      }
      const coords = [
        [west + offset, invY(ymax)],
        [east + offset, invY(ymax)],
        [east + offset, invY(ymin)],
        [west + offset, invY(ymin)],
      ];
      return {w, h, coords, indices};
    });
}
const heightPalette = [
  [21, 155, 134, 255],
  [207, 230, 166, 255],
  [241, 213, 120, 255],
  [221, 147, 74, 255],
  [184, 94, 75, 255],
  [121, 70, 90, 255],
];
function textures(mask) {
  const visible = heightPalette[0],
    hidden = [85, 91, 90, 56],
    stripe = [91, 83, 77, 184],
    base = [219, 215, 205, 93];
  return frame.map(({w, h, coords, indices}) => {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      if (idx < 0 || mask[idx] === Visibility.OUTSIDE) continue;
      const unknown =
        view.mode === 'height' ? canonical.validity[idx] !== 1 : mask[idx] === Visibility.UNKNOWN;
      if (unknown) {
        rgba.set((Math.floor(idx / SIZE) + (idx % SIZE)) % 8 < 2 ? stripe : base, i * 4);
        continue;
      }
      if (view.mode === 'height') {
        const extra =
          mask[idx] === Visibility.VISIBLE
            ? 0
            : Math.max(0, canonical.minimumObserverHeightM[idx] - options.observerHeight);
        rgba.set(
          heightPalette[
            extra <= 0
              ? 0
              : extra <= 10
                ? 1
                : extra <= 30
                  ? 2
                  : extra <= 100
                    ? 3
                    : extra <= 200
                      ? 4
                      : 5
          ],
          i * 4,
        );
      } else if (mask[idx] === Visibility.VISIBLE) rgba.set(visible, i * 4);
      else if (view.showHidden) rgba.set(hidden, i * 4);
    }
    return {w, h, coords, rgba};
  });
}
const withinSector = (bearing, width, center) =>
  width >= 360 ||
  bearing == null ||
  Math.abs(((bearing - center + 540) % 360) - 180) <= width / 2 + 1e-8;
function applySector(result) {
  if (options.sectorWidth === 360) return result;
  const {mask} = result,
    counts = [0, 0, 0, 0];
  let farthest = null;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === Visibility.OUTSIDE) continue;
    const dx = (i % SIZE) - MID,
      dy = MID - Math.floor(i / SIZE),
      d = STEP * Math.hypot(dx, dy);
    const bearing = d ? (Math.atan2(dx, dy) / DEG + 360) % 360 : null;
    if (!withinSector(bearing, options.sectorWidth, options.sectorBearing)) {
      mask[i] = Visibility.OUTSIDE;
      continue;
    }
    counts[mask[i]]++;
    if (mask[i] === Visibility.VISIBLE) farthest = Math.max(farthest ?? 0, d);
  }
  const unit = STEP * STEP,
    known = counts[0] + counts[1],
    analyzed = known + counts[3];
  return {
    mask,
    stats: {
      ...result.stats,
      visibleArea: counts[1] * unit,
      hiddenArea: counts[0] * unit,
      unknownArea: counts[3] * unit,
      knownArea: known * unit,
      analyzedArea: analyzed * unit,
      visibleFraction: known ? counts[1] / known : null,
      visiblePercent: known ? (counts[1] * 100) / known : null,
      coverageFraction: analyzed ? known / analyzed : null,
      farthestVisible: farthest,
      edgeVisible: farthest !== null && farthest >= options.radius - STEP,
    },
  };
}
function projected(d, result) {
  const parts = textures(result.mask);
  return {parts, transfer: parts.map((p) => p.rgba.buffer)};
}
function scenario() {
  return {
    generationId: generation + '/' + computedRev,
    observer: {
      latitude: current.lat,
      longitude: current.lon,
      surfaceM: current.surfaceM,
      heightM: options.observerHeight,
    },
    targetHeightM: options.targetHeight,
    radiusM: options.radius,
    sectorDeg: {bearing: options.sectorBearing, width: options.sectorWidth},
    release: current.release,
    descriptorSha256: current.descriptorSha256,
    terrainZoom: current.zoom,
    sourcePixelSizeM: (2 * Math.PI * R * Math.cos(current.lat * DEG)) / (512 * 2 ** current.zoom),
    source: 'Tileflow Terrain · Mapterhorn',
    sourceTiles: current.tiles || null,
    gridSha256: current.gridSha256 || null,
    grid: {
      size: SIZE,
      spacingM: STEP,
      projection: 'spherical azimuthal equidistant',
      earthRadiusM: R,
      rows: 'north to south',
      cols: 'west to east',
      sampling: 'bilinear',
      units: 'metres',
    },
    nearGrid: current.nearGrid,
    nativeGrid: current.nativeGrid,
    curvature: options.curvature,
    refraction: 1 - options.curvature,
    algorithm: 'discovery-geometry-grid-edges-v2',
    noData: 'unknown; a known obstruction still proves hidden',
  };
}
function compute(d) {
  view = d.view || view;
  const previousRadius = options?.radius,
    cold =
      !canonical ||
      previousRadius !== d.radius ||
      d.targetHeight !== options.targetHeight ||
      d.curvature !== options.curvature;
  options = Object.freeze({
    heights: current.heights,
    nearTerrain: current.nearTerrain,
    nativeTerrain: current.nativeTerrain,
    size: SIZE,
    spacing: STEP,
    radius: d.radius,
    observerHeight: d.eye,
    targetHeight: d.targetHeight,
    curvature: d.curvature,
    sectorBearing: d.sectorBearing,
    sectorWidth: d.sectorWidth,
  });
  const t0 = performance.now();
  if (cold) canonical = DiscoveryGeometry.heightRaster(options);
  const t1 = performance.now();
  result = applySector(DiscoveryGeometry.classify(canonical, options.observerHeight));
  const t2 = performance.now();
  computedRev = d.rev;
  cachedHorizon = null;
  const {parts, transfer} = projected(d, result);
  postMessage(
    {
      type: 'analysis',
      id: d.id,
      rev: d.rev,
      stats: result.stats,
      parts,
      ground: current.surfaceM,
      release: current.release,
      view,
      scenario: scenario(),
      metrics: {
        terrainMs: lastTerrainMs,
        heightsMs: t1 - t0,
        classifyMs: t2 - t1,
        textureMs: performance.now() - t2,
        cachedHeights: !cold,
        cells: SIZE * SIZE,
        ...current.metrics,
      },
      incomplete: current.missingTiles || 0,
    },
    transfer,
  );
  requestCatalog(d);
}
function targetGeometry(p, samples = false) {
  const {east, north} = TerrainProjection.offset(current.lat, current.lon, p.lat, p.lon);
  const x = MID + east / STEP,
    y = MID - north / STEP;
  const g = DiscoveryGeometry.profile(options, x, y, {samples});
  if (!withinSector(g.bearing, options.sectorWidth, options.sectorBearing)) {
    return {
      ...g,
      status: 2,
      reason: 'sector',
      points: [],
      minimumObserverHeightM: null,
      additionalObserverHeightM: null,
      lowerBoundM: null,
    };
  }
  const col = Math.round(x),
    row = Math.round(y);
  if (
    col >= 0 &&
    col < SIZE &&
    row >= 0 &&
    row < SIZE &&
    result.mask[row * SIZE + col] !== Visibility.OUTSIDE
  ) {
    const index = row * SIZE + col,
      threshold = canonical.minimumObserverHeightM[index];
    g.cell = {
      status: result.mask[index],
      minimumObserverHeightM: Number.isFinite(threshold) ? threshold : null,
      additionalObserverHeightM: Number.isFinite(threshold)
        ? result.mask[index] === Visibility.VISIBLE
          ? 0
          : Math.max(0, threshold - options.observerHeight)
        : null,
    };
  }
  if (samples)
    for (const q of g.points || [])
      Object.assign(
        q,
        TerrainProjection.point(current.lat, current.lon, (q.x - MID) * STEP, (MID - q.y) * STEP),
      );
  // An out-of-range pin may still land inside the cached elevation grid.
  if (g.status === 2 && !Number.isFinite(g.elevation)) {
    const native = current.nativeTerrain?.heightAtLngLat(p.lat, p.lon);
    const z = Number.isFinite(native) ? native : sampledHeight(current.heights, x, y);
    if (Number.isFinite(z)) g.elevation = z;
  }
  return g;
}
function classifyPeaks() {
  if (!rawCatalog || !result || catalogRadius !== options.radius) return;
  const t0 = performance.now();
  const peaks = rawCatalog.peaks
    .map((p) => {
      const g = targetGeometry(p, true);
      let sensitive = false;
      if (
        (g.status === 0 || g.status === 1) &&
        Number.isFinite(p.catalogElevationM) &&
        Number.isFinite(g.elevation) &&
        g.distance > 0
      ) {
        const difference = p.catalogElevationM - g.elevation;
        const blocks = g.points
          .slice(1, -1)
          .some(
            (q) =>
              q.corrected != null &&
              q.sightline + (difference * q.distance) / g.distance < q.corrected - 1e-6,
          );
        sensitive = (g.status === 1 && blocks) || (g.status === 0 && !blocks && g.complete);
      }
      return {
        ...p,
        sensitiveToElevation: sensitive,
        modelElevationM: g.elevation ?? null,
        distanceM: g.distance,
        azimuthDeg: g.bearing,
        angularElevationDeg: g.angularElevationDeg,
        status: ['hidden', 'visible', 'outside', 'unknown'][g.status],
        minimumObserverHeightM: g.minimumObserverHeightM,
        additionalObserverHeightM: g.additionalObserverHeightM,
      };
    })
    .filter((p) => p.status !== 'outside' && p.distanceM > 0.1);
  const {peaks: unused, ...meta} = rawCatalog;
  postMessage({
    type: 'peaks',
    nearTerrainStatus: current.nearGrid.status,
    nativeTerrainStatus: current.nativeGrid.status,
    id: generation,
    rev: computedRev,
    ...meta,
    peaks,
    unavailable: !!meta.error && !meta.loadedTiles,
    classifyMs: performance.now() - t0,
  });
}
function requestCatalog(d) {
  if (catalogRadius === options.radius) {
    if (rawCatalog) classifyPeaks();
    return;
  }
  catalogControl?.abort();
  catalogControl = new AbortController();
  rawCatalog = null;
  const seq = ++catalogSequence,
    signal = catalogControl.signal;
  catalogRadius = options.radius;
  PeakCatalog.query({
    lat: current.lat,
    lon: current.lon,
    radius: catalogRadius,
    signal,
    onProgress: (p) => {
      if (seq === catalogSequence && generation === d.id)
        postMessage({type: 'catalog-progress', id: d.id, rev: computedRev, ...p});
    },
  })
    .then((r) => {
      if (seq !== catalogSequence || generation !== d.id || signal.aborted) return;
      rawCatalog = r;
      classifyPeaks();
    })
    .catch((e) => {
      if (seq !== catalogSequence || generation !== d.id || signal.aborted) return;
      rawCatalog = {
        peaks: [],
        partial: true,
        error: e.message || 'Tileflow World is unavailable',
        loadedTiles: 0,
      };
      classifyPeaks();
    });
}
function probe(d) {
  const g = targetGeometry(d, d.type === 'profile');
  postMessage({
    ...g, type: d.type, id: d.id, rev: d.rev, probeId: d.probeId,
    nearTerrainStatus: current.nearGrid.status, nativeTerrainStatus: current.nativeGrid.status,
    observerResolutionM: current.observerResolutionM,
  });
}
function exportScenario(d) {
  postMessage({
    type: 'export',
    id: d.id,
    rev: d.rev,
    scenario: scenario(),
    stats: result.stats,
    peakRelease: rawCatalog?.release,
    heights: current.heights,
    mask: result.mask,
    nearHeights: current.nearTerrain?.heights || null,
    threshold: canonical.minimumObserverHeightM,
    validity: canonical.validity,
    profile: d.target ? targetGeometry(d.target, true) : null,
    horizon: cachedHorizon,
  });
}
// Interpolate across cell centers. Exact rows/columns need no off-ray neighbours.
function sampledHeight(heights, x, y) {
  const nearX = Math.round(x),
    nearY = Math.round(y);
  if (Math.abs(x - nearX) < 1e-10) x = nearX;
  if (Math.abs(y - nearY) < 1e-10) y = nearY;
  if (x < 0 || y < 0 || x > SIZE - 1 || y > SIZE - 1) return NaN;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    i = iy * SIZE + ix,
    fx = x - ix,
    fy = y - iy;
  let near = heights[i];
  if (fx) near += fx * (heights[i + 1] - near);
  if (!fy) return near;
  let far = heights[i + SIZE];
  if (fx) far += fx * (heights[i + SIZE + 1] - far);
  return near + fy * (far - near);
}
// Independent altitude queries serve inspected points outside the active grid.
let heightQueue = Promise.resolve();
function queuePointHeight(d) {
  heightQueue = heightQueue.then(async () => {
    let z = NaN;
    try {
      const native = current?.nativeTerrain?.heightAtLngLat(d.lat, d.lon);
      if (Number.isFinite(native)) z = native;
      else if (madeira && (!current || sameRelease(current, madeiraMetadata))) {
        const {east, north} = TerrainProjection.offset(32.7355, -16.9289, d.lat, d.lon);
        z = sampledHeight(madeira, MID + east / STEP, MID - north / STEP);
      }
      if (!Number.isFinite(z)) {
        const patch = await gridTerrain(d.lat, d.lon, {size: 3, spacing: STEP});
        z = patch.heights[4];
      }
    } catch {
      /* The requested location may have no elevation coverage. */
    }
    postMessage({
      type: 'probe-height',
      probeId: d.probeId,
      lat: d.lat,
      lon: d.lon,
      elevation: Number.isFinite(z) ? z : null,
    });
  });
}
let horizonMs = 0;
function horizon(d) {
  if (!cachedHorizon) {
    const t0 = performance.now(),
      bins = [];
    const count = Math.min(
      2880,
      Math.max(360, Math.ceil((2 * Math.PI * options.radius) / STEP / 4) * 4),
    );
    for (let i = 0; i < count; i++) {
      const bearing = (i * 360) / count,
        q = DiscoveryGeometry.horizonRay(options, bearing);
      bins.push({
        bearing,
        angle: q.angle,
        distance: q.distance,
        complete: q.complete,
        where:
          q.x == null
            ? null
            : TerrainProjection.point(
                current.lat,
                current.lon,
                (q.x - MID) * STEP,
                (MID - q.y) * STEP,
              ),
      });
    }
    horizonMs = performance.now() - t0;
    cachedHorizon = bins;
  }
  postMessage({
    type: 'horizon',
    id: d.id,
    rev: d.rev,
    radius: options.radius,
    bins: cachedHorizon,
    elapsedMs: horizonMs,
  });
}
const NEAR_SIZE = 129;
const NEAR_STEP = 5;
const sameRelease = (a, b) => a.release === b.release && a.descriptorSha256 === b.descriptorSha256;

async function readSnapshot(url, size, signal) {
  try {
    const response = await fetch(url, {signal});
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === size * size * Float32Array.BYTES_PER_ELEMENT) return new Float32Array(bytes);
  } catch (error) {
    if (signal.aborted) throw error;
  }
  return null;
}

async function loadObserverTerrain(d, signal) {
  const useSnapshot = d.cachedMadeira && (!d.terrainIdentity || sameRelease(d.terrainIdentity, madeiraMetadata));
  if (useSnapshot) {
    const [wide, near] = await Promise.all([
      madeira || readSnapshot(madeiraUrl, SIZE, signal),
      madeiraNear || readSnapshot(madeiraNearUrl, NEAR_SIZE, signal),
    ]);
    signal.throwIfAborted();
    madeira = wide;
    madeiraNear = near;
  }
  const grid = useSnapshot && madeira
    ? {...madeiraMetadata, lat: d.lat, lon: d.lon, heights: madeira, missingTiles: 0}
    : await gridTerrain(d.lat, d.lon, {
      signal, progress: ({done, total}) => postMessage({type: 'progress', id: d.id, done, total}),
    });
  if (d.terrainIdentity && !sameRelease(grid, d.terrainIdentity))
    throw new Error('The map and elevation analysis use different terrain releases. Reload the map and try again.');

  let nearTerrain = null;
  try {
    const patch = useSnapshot && madeiraNear
      ? {...madeiraNearMetadata, heights: madeiraNear}
      : await gridTerrain(d.lat, d.lon, {signal, size: NEAR_SIZE, spacing: NEAR_STEP});
    if (sameRelease(grid, patch) && Number.isFinite(patch.heights[(patch.heights.length - 1) / 2]))
      nearTerrain = patch;
  } catch (error) {
    if (signal.aborted) throw error;
    // The wide survey can still be explored. Report its coarser sampling
    // explicitly when the finer patch has no coverage or could not be loaded.
  }
  signal.throwIfAborted();
  const surfaceM = nearTerrain
    ? nearTerrain.heights[(nearTerrain.heights.length - 1) / 2]
    : grid.heights[MID * SIZE + MID];
  if (!Number.isFinite(surfaceM))
    throw new Error('Elevation data is unavailable here. Try placing the observer somewhere else.');

  const nearGrid = nearTerrain ? {
    status: nearTerrain.validCells === NEAR_SIZE * NEAR_SIZE ? 'refined' : 'partial',
    size: NEAR_SIZE, spacingM: NEAR_STEP, halfExtentM: (NEAR_SIZE - 1) / 2 * NEAR_STEP,
    zoom: nearTerrain.zoom, validCells: nearTerrain.validCells,
    sourcePixelSizeM: (2 * Math.PI * R * Math.cos(d.lat * DEG)) / (512 * 2 ** nearTerrain.zoom),
    sourceTiles: nearTerrain.tiles, gridSha256: nearTerrain.gridSha256 || null,
  } : {status: 'coarse', spacingM: STEP};
  let native = null;
  try {
    const window = await nativeTerrain(d.lat, d.lon, {signal, radius: MID * STEP});
    if (sameRelease(grid, window) && Number.isFinite(window.heightAt(0, 0))) native = window;
  } catch (error) {
    if (signal.aborted) throw error;
  }
  signal.throwIfAborted();
  const nativeGrid = native ? {
    zoom: native.zoom, sourcePixelSizeM: native.spacing, sourceTiles: native.tiles,
    status: native.missingTiles ? 'partial' : 'native',
  } : {status: 'coarse'};
  const wideResolution = Math.max(STEP, 2 * Math.PI * R * Math.cos(d.lat * DEG) / (512 * 2 ** grid.zoom));
  let observerResolutionM = wideResolution;
  if (nearTerrain) {
    observerResolutionM = Math.max(nearGrid.spacingM, nearGrid.sourcePixelSizeM);
    if (nearGrid.status === 'partial') {
      // A missing tile elsewhere in the near patch does not coarsen the observer's footing.
      const cells = Math.ceil(observerResolutionM / NEAR_STEP) + 1;
      const center = (NEAR_SIZE - 1) / 2;
      for (let y = -cells; y <= cells; y++) {
        for (let x = -cells; x <= cells; x++) {
          if (Number.isFinite(nearTerrain.heights[(center + y) * NEAR_SIZE + center + x])) continue;
          const value = native?.heightAt(x * NEAR_STEP, -y * NEAR_STEP);
          observerResolutionM = Math.max(observerResolutionM, Number.isFinite(value) ? native.spacing : wideResolution);
        }
      }
    }
  }
  return {...grid, nearTerrain, nearGrid, nativeTerrain: native, nativeGrid, surfaceM, observerResolutionM};
}

self.onmessage = async ({data: d}) => {
  if (d.type === 'probe-height') {
    queuePointHeight(d);
    return;
  }
  if (d.type === 'cancel') {
    generation = d.id;
    controller?.abort();
    catalogControl?.abort();
    catalogSequence++;
    current = null;
    return;
  }
  if (d.type === 'load') {
    controller?.abort();
    controller = new AbortController();
    generation = d.id;
    current = null;
    options = null;
    result = null;
    computedRev = undefined;
    canonical = null;
    cachedHorizon = null;
    rawCatalog = null;
    catalogRadius = null;
    catalogControl?.abort();
    catalogSequence++;
    const t0 = performance.now();
    try {
      const grid = await loadObserverTerrain(d, controller.signal);
      if (generation !== d.id) return;
      current = grid;
      lastTerrainMs = performance.now() - t0;
      frame = screenGrid(grid);
      postMessage({type: 'ready', id: d.id});
    } catch (e) {
      if (d.id === generation) postMessage({type: 'error', id: d.id, message: e.message});
    }
    return;
  }
  if (!current || generation !== d.id) return;
  try {
    if (d.type === 'compute') compute(d);
    else if (options && d.rev === computedRev) {
      if (d.type === 'probe' || d.type === 'profile') probe(d);
      else if (d.type === 'view') {
        view = d.view;
        const {parts, transfer} = projected(d, result);
        postMessage({type: 'view', id: d.id, rev: d.rev, view, parts}, transfer);
      } else if (d.type === 'export') exportScenario(d);
      else if (d.type === 'horizon') horizon(d);
    }
  } catch (e) {
    postMessage({type: 'error', id: d.id, message: e.message});
  }
};
