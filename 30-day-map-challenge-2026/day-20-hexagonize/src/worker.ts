// Samples Tileflow tiles for every hexagon: elevation from Terrain, sea depth bands, lakes, rivers
// and land cover from World. Tiles are rasterised once into small grids and cached.
import {VectorTile, type VectorTileFeature} from '@mapbox/vector-tile';
import Pbf from 'pbf';

export type SampleRequest = {id: number; s: number; cells: Float64Array};
export type SampleResult = {
  id: number;
  /** Mean elevation of the cell's land, metres. */
  elev: Float32Array;
  /** 0 land, 1 sea, 2 lake, 3 river */
  kind: Uint8Array;
  /** Depth of the World bathymetry band the cell sits in, metres below sea level (positive). */
  band: Float32Array;
  /** Mean depth of the Bathymetry DEM under the cell, metres (positive), or -1 where it has none. */
  depth: Float32Array;
  /** Index into COVER, 0 when unknown. */
  cover: Uint8Array;
  ms: number;
};

export const COVER = ['', 'trees', 'grass', 'shrub', 'crop', 'barren', 'urban', 'snow', 'wetland', 'sand'] as const;
const COVER_INDEX: Record<string, number> = {ice: 7, glacier: 7, wood: 1, forest: 1, farmland: 4, rock: 5, scree: 5, sand: 9, beach: 9, swamp: 8, bog: 8, marsh: 8};
COVER.forEach((c, i) => c && (COVER_INDEX[c] = i));

/** The depths a World bathymetry band can start at; the tiles carry one of these as `min_depth`. */
const BANDS = [0, 50, 100, 200, 500, 1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000];
const SIZE = 512;
const STEP = 20; // raster value per index: antialiased edges round to one side or the other

/** The managed Map the tiles are attributed to (`tileflow deploy`); Bathymetry needs it. */
export const MAP_ID = 'map_tvmwFQ2baiqotKqX';
const API = 'https://cdn.tileflow.dev/tiles';
type Templates = {terrain: string; world: string; sea: string};
let templates: Promise<Templates> | undefined;
const template = () =>
  (templates ??= Promise.all(
    ['terrain', 'world', 'bathymetry/dem'].map((t) =>
      fetch(`${API}/${t}/tiles.json?map=${MAP_ID}`).then((r) => r.json()).then((j) => j.tiles[0] as string),
    ),
  ).then(([terrain, world, sea]) => ({terrain, world, sea})));
const tileUrl = (t: string, z: number, x: number, y: number) => t.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

// ------------------------------------------------------------------------------------------------
// Caches

const LIMIT = 160;
const cache = new Map<string, Promise<unknown>>();
function cached<T>(k: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(k) as Promise<T> | undefined;
  if (p) {
    cache.delete(k);
    cache.set(k, p);
    return p;
  }
  p = make();
  cache.set(k, p);
  p.catch(() => cache.delete(k));
  while (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
  return p;
}

/** Terrain as metres per pixel, or the parent tile's when this one is not published. */
type Dem = {z: number; x: number; y: number; data: Float32Array};
const terrain = (z: number, x: number, y: number) => dem('terrain', z, x, y);
const seaFloor = (z: number, x: number, y: number) => dem('sea', z, x, y);
function dem(kind: 'terrain' | 'sea', z: number, x: number, y: number): Promise<Dem> {
  return cached(`${kind}/${z}/${x}/${y}`, async (): Promise<Dem> => {
    const res = await fetch(tileUrl((await template())[kind], z, x, y));
    if (!res.ok) {
      if (z > 0 && (res.status === 404 || res.status === 204)) return dem(kind, z - 1, x >> 1, y >> 1);
      throw new Error(`${kind} ${z}/${x}/${y}: ${res.status}`);
    }
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', {willReadFrequently: true})!;
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const data = new Float32Array(bmp.width * bmp.height);
    for (let i = 0; i < data.length; i++) data[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    return {z, x, y, data};
  });
}

function world(z: number, x: number, y: number): Promise<VectorTile | null> {
  return cached(`w/${z}/${x}/${y}`, async () => {
    const res = await fetch(tileUrl((await template()).world, z, x, y));
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(`world ${z}/${x}/${y}: ${res.status}`);
    return new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
  });
}

type Raster = Uint8ClampedArray;

function draw(features: Array<{f: VectorTileFeature; value: number}>, extent: number, line = 0): Raster {
  const c = new OffscreenCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d', {willReadFrequently: true})!;
  const k = SIZE / extent;
  for (const {f, value} of features) {
    const g = f.loadGeometry();
    ctx.beginPath();
    for (const ring of g) {
      ring.forEach((p, i) => (i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)));
      if (!line) ctx.closePath();
    }
    const col = `rgb(${value * STEP},0,0)`;
    if (line) {
      ctx.strokeStyle = col;
      ctx.lineWidth = line;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.stroke();
    } else {
      ctx.fillStyle = col;
      ctx.fill();
    }
  }
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const out = new Uint8ClampedArray(SIZE * SIZE);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(px[i * 4] / STEP);
  return out;
}

const features = (t: VectorTile | null, layer: string) => {
  const l = t?.layers[layer];
  const out: VectorTileFeature[] = [];
  if (l) for (let i = 0; i < l.length; i++) out.push(l.feature(i));
  return out;
};

/** Bathymetry band index (1-based into BANDS) and land cover, both from World. */
function seaAndCover(z: number, x: number, y: number) {
  return cached(`sc/${z}/${x}/${y}`, async () => {
    const t = await world(z, x, y);
    const extent = t?.layers.bathymetry?.extent ?? t?.layers.landcover?.extent ?? 4096;
    const bands = features(t, 'bathymetry')
      .map((f) => ({f, value: nearestBand(-Number(f.properties.min_depth ?? 0)) + 1}))
      .sort((a, b) => a.value - b.value);
    const cover = features(t, 'landcover')
      .map((f) => ({f, value: COVER_INDEX[String(f.properties.class)] ?? 0}))
      .filter((c) => c.value);
    return {bands: draw(bands, extent), cover: draw(cover, extent)};
  });
}

/** Ocean (1), other water (2) and rivers (3, drawn about one cell wide). */
function water(z: number, x: number, y: number, riverPx: number) {
  const w = Math.max(1, Math.round(riverPx));
  return cached(`wa/${z}/${x}/${y}/${w}`, async () => {
    const t = await world(z, x, y);
    const extent = t?.layers.water?.extent ?? 4096;
    const polys = features(t, 'water').map((f) => ({f, value: f.properties.class === 'ocean' ? 1 : 2}));
    const area = draw(polys, extent);
    const rivers = features(t, 'waterway').filter((f) => f.properties.class === 'river' && !f.properties.underground);
    if (rivers.length) {
      const lines = draw(rivers.map((f) => ({f, value: 3})), extent, w);
      for (let i = 0; i < area.length; i++) if (lines[i] && !area[i]) area[i] = 3;
    }
    return area;
  });
}

const nearestBand = (depth: number) => {
  let best = 0;
  for (let i = 1; i < BANDS.length; i++) if (Math.abs(BANDS[i] - depth) < Math.abs(BANDS[best] - depth)) best = i;
  return best;
};

// ------------------------------------------------------------------------------------------------
// Sampling

// the centre and three points around it: small cells take their texture from their neighbours
const RING = Array.from({length: 3}, (_, i) => {
  const a = ((120 * i - 90) * Math.PI) / 180;
  return [Math.cos(a) * 0.5, Math.sin(a) * 0.5] as const;
});
const PER = 1 + RING.length;

type Lookup = (u: number, v: number) => number;

async function lookup<T extends {data?: Float32Array} | Raster>(
  z: number,
  points: Float64Array,
  load: (z: number, x: number, y: number) => Promise<T>,
): Promise<{at: Lookup; tiles: number}> {
  const n = 2 ** z;
  const need = new Map<number, [number, number]>();
  for (let i = 0; i < points.length; i += 2) {
    const x = Math.min(n - 1, Math.floor(points[i] * n));
    const y = Math.min(n - 1, Math.max(0, Math.floor(points[i + 1] * n)));
    need.set(y * n + x, [x, y]);
  }
  const got = new Map<number, T | undefined>();
  await Promise.all(
    [...need].map(async ([k, [x, y]]) => {
      try {
        got.set(k, await load(z, x, y));
      } catch (e) {
        console.warn(e);
      }
    }),
  );
  // consecutive points nearly always fall in the same tile
  let lastKey = -1;
  let last: unknown;
  const at: Lookup = (u, v) => {
    const x = Math.min(n - 1, Math.floor(u * n));
    const y = Math.min(n - 1, Math.max(0, Math.floor(v * n)));
    const k = y * n + x;
    if (k !== lastKey) {
      lastKey = k;
      last = got.get(k);
    }
    const t = last;
    if (!t) return 0;
    if (t instanceof Uint8ClampedArray) {
      const px = Math.min(SIZE - 1, Math.floor((u * n - x) * SIZE));
      const py = Math.min(SIZE - 1, Math.floor((v * n - y) * SIZE));
      return t[py * SIZE + px];
    }
    // terrain, possibly a parent tile
    const tt = t as {z: number; x: number; y: number; data: Float32Array};
    const m = 2 ** tt.z;
    const w = Math.sqrt(tt.data.length);
    const px = Math.min(w - 1, Math.max(0, Math.floor((u * m - tt.x) * w)));
    const py = Math.min(w - 1, Math.max(0, Math.floor((v * m - tt.y) * w)));
    return tt.data[py * w + px];
  };
  return {at, tiles: need.size};
}

async function sample({id, s, cells}: SampleRequest): Promise<SampleResult> {
  const t0 = performance.now();
  const count = cells.length / 2;
  const spacing = Math.sqrt(3) * s;
  // about one terrain pixel per cell: coarser tiles are already averaged, so big cells are not noisy
  const zt = Math.max(0, Math.min(12, Math.ceil(Math.log2(1.25 / (512 * spacing)))));
  const zb = Math.min(zt, 9);
  const zw = Math.min(Math.max(zt, 4), 14);
  const zs = Math.min(zt, 9);

  const points = new Float64Array(count * PER * 2);
  for (let c = 0; c < count; c++) {
    const u = cells[c * 2];
    const v = cells[c * 2 + 1];
    points[c * PER * 2] = u;
    points[c * PER * 2 + 1] = v;
    RING.forEach(([dx, dy], i) => {
      points[c * PER * 2 + 2 + i * 2] = u + dx * s;
      points[c * PER * 2 + 3 + i * 2] = v + dy * s;
    });
  }
  const riverPx = spacing * 2 ** zw * SIZE * 0.7;
  const [ter, sc, wa] = await Promise.all([
    lookup(zt, points, terrain),
    lookup(zb, cells, (z, x, y) => seaAndCover(z, x, y).then((r) => r.bands)),
    lookup(zw, points, (z, x, y) => water(z, x, y, riverPx)),
  ]);
  const cov = await lookup(zb, points, (z, x, y) => seaAndCover(z, x, y).then((r) => r.cover));
  const floor = await lookup(zs, points, seaFloor);

  const elev = new Float32Array(count);
  const kind = new Uint8Array(count);
  const band = new Float32Array(count);
  const depth = new Float32Array(count);
  const cover = new Uint8Array(count);
  const votes = new Uint8Array(COVER.length);
  for (let c = 0; c < count; c++) {
    let sea = 0;
    let lake = 0;
    let landSum = 0;
    let depthSum = 0;
    let depthN = 0;
    let land = 0;
    votes.fill(0);
    for (let i = 0; i < PER; i++) {
      const u = points[c * PER * 2 + i * 2];
      const v = points[c * PER * 2 + i * 2 + 1];
      const e = ter.at(u, v);
      const w = wa.at(u, v);
      const f = floor.at(u, v);
      if (f < 0) {
        depthSum -= f;
        depthN++;
      }
      if (w === 1 || (e < 1 && w !== 2 && w !== 3)) sea++;
      else {
        if (w === 2) lake++;
        landSum += e;
        land++;
      }
      votes[cov.at(u, v)]++;
    }
    elev[c] = land ? landSum / land : 0;
    const centreWater = wa.at(cells[c * 2], cells[c * 2 + 1]);
    kind[c] = sea * 2 > PER ? 1 : lake * 2 > PER ? 2 : centreWater === 3 ? 3 : 0;
    const b = sc.at(cells[c * 2], cells[c * 2 + 1]);
    band[c] = b ? BANDS[b - 1] : 0;
    depth[c] = depthN ? depthSum / depthN : -1;
    let best = 0;
    for (let i = 1; i < votes.length; i++) if (votes[i] > votes[best] || (best === 0 && votes[i])) best = i;
    cover[c] = best;
  }
  return {id, elev, kind, band, depth, cover, ms: Math.round(performance.now() - t0)};
}

self.onmessage = async (e: MessageEvent<SampleRequest>) => {
  try {
    const r = await sample(e.data);
    (self as unknown as Worker).postMessage(r, [r.elev.buffer, r.kind.buffer, r.band.buffer, r.depth.buffer, r.cover.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({id: e.data.id, error: String(err)});
  }
};
