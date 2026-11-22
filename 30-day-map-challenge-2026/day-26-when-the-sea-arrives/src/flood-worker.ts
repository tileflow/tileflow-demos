// Builds the ground the water layer floods: a raster over the view with the elevation of every
// pixel (Tileflow Terrain), where today's ocean is (Tileflow World) and how high the sea must stand
// before it can flow there. That last height is a priority flood from the ocean: water rises over
// a ridge or a dike only once the sea is higher than it, so low land behind high ground stays dry,
// and inland depressions (the Caspian, the Dead Sea) never connect. It also counts what floods in
// view, with the people who live there (GHS-POP 2025).
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {PMTiles} from 'pmtiles';
import {EARTH, lngLat} from './geo';
import {block, lineAt, lineField, loadLines, loadSeaLevels, riseAt, type SeaLevels} from './sea-level';

/** Ground higher than this never floods in these projections: the flood stops there. */
export const CAP = 15;
/** The spill height of today's ocean, which the layer leaves to the map underneath. */
export const OCEAN = -1000;
/** The spill height of ground the ocean cannot reach below CAP. */
export const NEVER = 60000;
const MAX_PIXELS = 1_600_000;
const FLOOR = -50;

export type View = {
  /** The ground to prepare (screen plus a margin), Mercator. */
  poly: Array<[number, number]>;
  /** The ground on screen: what the figures count. */
  visible: Array<[number, number]>;
  zoom: number;
};
export type Raster = {
  /** Mercator of the north-west corner of pixel (0, 0), and the size of one pixel. */
  origin: [number, number];
  step: number;
  w: number;
  h: number;
  elev: Float32Array;
  spill: Float32Array;
  /** 1 today's ocean, 2 other water (lakes, lagoons, rivers), 0 land. */
  water: Uint8Array;
};
export type Counts = {
  /** Land the sea newly reaches, km². */
  area: number;
  people: number;
  /** Land already below the projected sea today (2020): kept dry by dikes and pumps, km². */
  defended: number;
  defendedPeople: number;
};
export type Request =
  | {id: number; type: 'build'; view: View; dataUrl: string; linesUrl: string; populationUrl: string; coastUrl: string}
  | {id: number; type: 'count'; scenario: number; quantile: number; year: number; line: number; visible?: Array<[number, number]>};
export type Reply =
  | {id: number; type: 'build'; raster: Raster; ms: Record<string, number>}
  | {id: number; type: 'count'; counts: Counts}
  | {id: number; type: 'error'; error: string};

// ------------------------------------------------------------------------------------------------
// Tiles

/** The managed Map the tiles are attributed to (`tileflow deploy`). */
const MAP_ID = 'map_tvmwFQ2baiqotKqX';
const API = 'https://cdn.tileflow.dev/tiles';
let templates: Promise<{terrain: string; world: string}> | undefined;
const template = () =>
  (templates ??= Promise.all(
    ['terrain', 'world'].map((t) => fetch(`${API}/${t}/tiles.json?map=${MAP_ID}`).then((r) => r.json()).then((j) => j.tiles[0] as string)),
  ).then(([terrain, world]) => ({terrain, world})));
const tileUrl = (t: string, z: number, x: number, y: number) => t.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

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
  while (cache.size > 400) cache.delete(cache.keys().next().value!);
  return p;
}

type Grid = {z: number; x: number; y: number; size: number; data: Float32Array | Uint8Array};

async function pixels(blob: Blob) {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', {willReadFrequently: true})!;
  ctx.drawImage(bmp, 0, 0);
  return {px: ctx.getImageData(0, 0, bmp.width, bmp.height).data, size: bmp.width};
}

/** Terrain in metres, or the parent tile where this one is not published. */
function terrain(z: number, x: number, y: number): Promise<Grid> {
  return cached(`t/${z}/${x}/${y}`, async (): Promise<Grid> => {
    const res = await fetch(tileUrl((await template()).terrain, z, x, y));
    if (!res.ok) {
      if (z > 0 && (res.status === 404 || res.status === 204)) return terrain(z - 1, x >> 1, y >> 1);
      throw new Error(`terrain ${z}/${x}/${y}: ${res.status}`);
    }
    const {px, size} = await pixels(await res.blob());
    const data = new Float32Array(size * size);
    for (let i = 0; i < data.length; i++) data[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    return {z, x, y, size, data};
  });
}

const OCEAN_SIZE = 512;
/** World's water polygons: 1 for today's ocean, 2 for other water (lakes, lagoons, rivers). */
function water(z: number, x: number, y: number): Promise<Grid> {
  return cached(`w/${z}/${x}/${y}`, async (): Promise<Grid> => {
    const res = await fetch(tileUrl((await template()).world, z, x, y));
    const data = new Uint8Array(OCEAN_SIZE * OCEAN_SIZE);
    if (res.status === 204 || res.status === 404) return {z, x, y, size: OCEAN_SIZE, data};
    if (!res.ok) throw new Error(`world ${z}/${x}/${y}: ${res.status}`);
    const t = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
    const layer = t.layers.water;
    if (!layer) return {z, x, y, size: OCEAN_SIZE, data};
    const c = new OffscreenCanvas(OCEAN_SIZE, OCEAN_SIZE);
    const ctx = c.getContext('2d', {willReadFrequently: true})!;
    const k = OCEAN_SIZE / layer.extent;
    // other water first, then the ocean over it
    for (const ocean of [false, true]) {
      ctx.fillStyle = ocean ? '#ff0000' : '#00ff00';
      ctx.beginPath();
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if ((f.properties.class === 'ocean') !== ocean) continue;
        for (const ring of f.loadGeometry()) {
          ring.forEach((p, j) => (j ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)));
          ctx.closePath();
        }
      }
      ctx.fill();
    }
    const px = ctx.getImageData(0, 0, OCEAN_SIZE, OCEAN_SIZE).data;
    for (let i = 0; i < data.length; i++) data[i] = px[i * 4] > 127 ? 1 : px[i * 4 + 1] > 127 ? 2 : 0;
    return {z, x, y, size: OCEAN_SIZE, data};
  });
}

/** One byte per pixel from a PMTiles archive of greyscale WebP tiles; size 1 where it has no tile. */
const archives = new Map<string, PMTiles>();
function bytes(url: string, z: number, x: number, y: number): Promise<Grid> {
  let archive = archives.get(url);
  if (!archive) archives.set(url, (archive = new PMTiles(new URL(url, self.location.href).href)));
  return cached(`b/${url}/${z}/${x}/${y}`, async (): Promise<Grid> => {
    const tile = await archive!.getZxy(z, x, y);
    if (!tile) return {z, x, y, size: 1, data: new Uint8Array([255])};
    const {px, size} = await pixels(new Blob([tile.data], {type: 'image/webp'}));
    const data = new Uint8Array(size * size);
    for (let i = 0; i < data.length; i++) data[i] = px[i * 4];
    return {z, x, y, size, data};
  });
}

/** People per km², from the log-encoded byte of the population archive. */
const DENSITY = new Float32Array(256).map((_, v) => Math.expm1((v / 255) * Math.log1p(150000)));
DENSITY[255] = 0;

/**
 * Bare-earth coastal elevation from DeltaDTM where Tileflow Terrain carries a surface model (with
 * trees and buildings, which lifts low deltas by metres): v / 5 - 10 metres, 254 above 6 m, 255 none.
 */
const COAST_MAX_ZOOM = 9;
function coastAt(t: Grid, gx: number, gy: number): number {
  if (t.size === 1) return NaN;
  const s = t.size;
  const x = Math.min(s - 1, Math.max(0, gx));
  const y = Math.min(s - 1, Math.max(0, gy));
  const x0 = Math.min(s - 2, Math.floor(x));
  const y0 = Math.min(s - 2, Math.floor(y));
  const d = t.data;
  const i = y0 * s + x0;
  const a = d[i];
  const b = d[i + 1];
  const c = d[i + s];
  const e = d[i + s + 1];
  if (a < 254 && b < 254 && c < 254 && e < 254) {
    const fx = x - x0;
    const fy = y - y0;
    return ((a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy) / 5 - 10;
  }
  const v = d[Math.round(y) * s + Math.round(x)];
  return v === 255 ? NaN : v === 254 ? Infinity : v / 5 - 10;
}

/** Every tile at zoom z under the raster, each with the grid that serves it (maybe a parent's). */
type Placed = {x: number; y: number; t: Grid};
async function tilesFor(r: Raster, z: number, load: (z: number, x: number, y: number) => Promise<Grid>): Promise<Placed[]> {
  const n = 2 ** z;
  const [u0, v0] = r.origin;
  const x0 = Math.max(0, Math.floor(u0 * n));
  const x1 = Math.min(n - 1, Math.floor((u0 + r.w * r.step) * n));
  const y0 = Math.max(0, Math.floor(v0 * n));
  const y1 = Math.min(n - 1, Math.floor((v0 + r.h * r.step) * n));
  const jobs: Array<Promise<Placed | null>> = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) jobs.push(load(z, x, y).then((t) => ({x, y, t}), (e) => (console.warn(e), null)));
  return (await Promise.all(jobs)).filter((p): p is Placed => !!p);
}

/**
 * Calls `each(i, gx, gy, grid)` for every raster pixel with its position inside the grid that
 * covers it, in that grid's pixels.
 */
function forPixels(r: Raster, z: number, placed: Placed[], each: (i: number, gx: number, gy: number, t: Grid) => void) {
  const n = 2 ** z;
  for (const {x, y, t} of placed) {
    const tz = 2 ** t.z;
    const px0 = Math.max(0, Math.ceil((x / n - r.origin[0]) / r.step - 0.5));
    const px1 = Math.min(r.w - 1, Math.floor(((x + 1) / n - r.origin[0]) / r.step - 0.5));
    const py0 = Math.max(0, Math.ceil((y / n - r.origin[1]) / r.step - 0.5));
    const py1 = Math.min(r.h - 1, Math.floor(((y + 1) / n - r.origin[1]) / r.step - 0.5));
    for (let py = py0; py <= py1; py++) {
      const v = r.origin[1] + (py + 0.5) * r.step;
      const gy = (v * tz - t.y) * t.size - 0.5;
      for (let px = px0; px <= px1; px++) {
        const u = r.origin[0] + (px + 0.5) * r.step;
        each(py * r.w + px, (u * tz - t.x) * t.size - 0.5, gy, t);
      }
    }
  }
}

function bilinear(t: Grid, gx: number, gy: number) {
  const s = t.size;
  const x = Math.min(s - 1, Math.max(0, gx));
  const y = Math.min(s - 1, Math.max(0, gy));
  const x0 = Math.min(s - 2, Math.floor(x));
  const y0 = Math.min(s - 2, Math.floor(y));
  const fx = x - x0;
  const fy = y - y0;
  const d = t.data;
  const i = y0 * s + x0;
  return (d[i] + (d[i + 1] - d[i]) * fx) * (1 - fy) + (d[i + s] + (d[i + s + 1] - d[i + s]) * fx) * fy;
}

const nearest = (t: Grid, gx: number, gy: number) =>
  t.data[Math.min(t.size - 1, Math.max(0, Math.round(gy))) * t.size + Math.min(t.size - 1, Math.max(0, Math.round(gx)))];

// ------------------------------------------------------------------------------------------------
// The raster

type State = Raster & {people: Float32Array; area: Float32Array; lng: Float32Array; lat: Float32Array; spans: Int32Array};
let state: State | undefined;
let levels: Promise<SeaLevels> | undefined;
let lines: Promise<Int16Array> | undefined;

function plan(view: View): Raster {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const [u, v] of view.poly) {
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  minV = Math.max(0, minV);
  maxV = Math.min(1, maxV);
  // about one raster pixel per screen pixel at the centre: the shoreline is the contour of a smooth
  // field, so it stays sharp between samples. Steps come in quarter octaves and the origin snaps to
  // them, so a pan rebuilds the same pixels.
  let step = 1.1 / (512 * 2 ** view.zoom);
  const need = ((maxU - minU) * (maxV - minV)) / (step * step);
  if (need > MAX_PIXELS) step *= Math.sqrt(need / MAX_PIXELS);
  step = 2 ** (Math.ceil(Math.log2(step) * 4) / 4);
  const snap = step * 16;
  const u0 = Math.floor(minU / snap) * snap;
  const v0 = Math.floor(minV / snap) * snap;
  const w = Math.ceil((maxU - u0) / step);
  const h = Math.ceil((maxV - v0) / step);
  return {origin: [u0, v0], step, w, h, elev: new Float32Array(w * h), spill: new Float32Array(w * h), water: new Uint8Array(w * h)};
}

async function build(view: View, populationUrl: string, coastUrl: string): Promise<{raster: Raster; ms: Record<string, number>}> {
  const t0 = performance.now();
  const r = plan(view);
  const {w, h, step} = r;
  // terrain and World water about one pixel per raster pixel; population at most z7
  const zt = Math.max(0, Math.min(12, Math.ceil(Math.log2(1 / (512 * step)))));
  const zo = Math.max(2, Math.min(13, zt));
  const zp = Math.max(0, Math.min(7, Math.round(Math.log2(1 / (256 * step)))));
  const zc = Math.max(0, Math.min(COAST_MAX_ZOOM, Math.round(Math.log2(1 / (256 * step)))));
  const [ter, sea, pop, coast] = await Promise.all([
    tilesFor(r, zt, terrain),
    tilesFor(r, zo, water),
    tilesFor(r, zp, (z, x, y) => bytes(populationUrl, z, x, y)),
    tilesFor(r, zc, (z, x, y) => bytes(coastUrl, z, x, y)),
  ]);
  const t1 = performance.now();

  const elev = r.elev;
  forPixels(r, zt, ter, (i, gx, gy, t) => (elev[i] = bilinear(t, gx, gy)));
  forPixels(r, zc, coast, (i, gx, gy, t) => {
    const c = coastAt(t, gx, gy);
    if (c === Infinity) elev[i] = Math.max(elev[i], 6);
    else if (!Number.isNaN(c)) elev[i] = c;
  });
  const wet = r.water;
  forPixels(r, zo, sea, (i, gx, gy, t) => (wet[i] = nearest(t, gx, gy)));
  const people = new Float32Array(w * h);
  const area = new Float32Array(h);
  const lat = new Float32Array(h);
  const lng = new Float32Array(w);
  for (let py = 0; py < h; py++) {
    lat[py] = lngLat(0, r.origin[1] + (py + 0.5) * step)[1];
    const m = step * EARTH * Math.cos((lat[py] * Math.PI) / 180);
    area[py] = (m * m) / 1e6;
  }
  for (let px = 0; px < w; px++) lng[px] = (r.origin[0] + (px + 0.5) * step) * 360 - 180;
  forPixels(r, zp, pop, (i, gx, gy, t) => {
    people[i] = DENSITY[nearest(t, gx, gy)] * area[Math.floor(i / w)];
  });
  const t2 = performance.now();

  priorityFlood(r);
  const t3 = performance.now();
  state = {...r, people, area, lng, lat, spans: spans(r, view.visible)};
  return {
    raster: {...r, elev: elev.slice(), spill: r.spill.slice(), water: r.water.slice()},
    ms: {tiles: Math.round(t1 - t0), sample: Math.round(t2 - t1), flood: Math.round(t3 - t2), terrainZoom: zt, pixels: w * h},
  };
}

/**
 * The spill height of every pixel: the lowest sea level at which water from today's ocean reaches
 * it, over the ground in between. A priority flood on a bucket queue in centimetres: each pixel is
 * reached once, from the lowest water front, so the first height it gets is final.
 */
function priorityFlood(r: Raster) {
  const {w, h, elev, spill, water} = r;
  const buckets = Math.ceil((CAP - FLOOR) * 100) + 1;
  const head = new Int32Array(buckets).fill(-1);
  const next = new Int32Array(w * h);
  spill.fill(NEVER);
  const push = (i: number, level: number) => {
    const b = Math.max(0, Math.round((level - FLOOR) * 100));
    spill[i] = level;
    next[i] = head[b];
    head[b] = i;
  };
  for (let i = 0; i < w * h; i++) if (water[i] === 1) push(i, FLOOR);
  for (let b = 0; b < buckets; b++) {
    while (head[b] !== -1) {
      const i = head[b];
      head[b] = next[i];
      const level = spill[i];
      const x = i % w;
      const visit = (j: number) => {
        if (spill[j] !== NEVER) return;
        const e = elev[j];
        if (e >= CAP) return;
        push(j, Math.max(level, e, FLOOR));
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < w * (h - 1)) visit(i + w);
    }
  }
  for (let i = 0; i < w * h; i++) if (water[i] === 1) spill[i] = OCEAN;
}

/** For every raster row, the first and last pixel inside the visible polygon (or -1, -1). */
function spans(r: Raster, poly: Array<[number, number]>) {
  const out = new Int32Array(r.h * 2).fill(-1);
  for (let py = 0; py < r.h; py++) {
    const v = r.origin[1] + (py + 0.5) * r.step;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ui, vi] = poly[i];
      const [uj, vj] = poly[j];
      if (vi > v === vj > v) continue;
      const u = ui + ((v - vi) * (uj - ui)) / (vj - vi);
      lo = Math.min(lo, u);
      hi = Math.max(hi, u);
    }
    if (lo > hi) continue;
    out[py * 2] = Math.max(0, Math.ceil((lo - r.origin[0]) / r.step - 0.5));
    out[py * 2 + 1] = Math.min(r.w - 1, Math.floor((hi - r.origin[0]) / r.step - 0.5));
  }
  return out;
}

async function count(scenario: number, quantile: number, year: number, line: number, visible?: Array<[number, number]>): Promise<Counts> {
  const out: Counts = {area: 0, people: 0, defended: 0, defendedPeople: 0};
  const s = state;
  if (!s) return out;
  if (visible) s.spans = spans(s, visible);
  const field = block(await levels!, scenario, quantile);
  const above = lineField(await lines!, line);
  for (let py = 0; py < s.h; py++) {
    const a = s.spans[py * 2];
    const b = s.spans[py * 2 + 1];
    if (a < 0) continue;
    const lat = s.lat[py];
    for (let px = a; px <= b; px++) {
      const i = py * s.w + px;
      const sp = s.spill[i];
      if (sp >= CAP || s.water[i]) continue;
      const extra = lineAt(above, s.lng[px], lat);
      const now = riseAt(field, s.lng[px], lat, year) + extra;
      if (now <= sp) continue;
      if (riseAt(field, s.lng[px], lat, 2020) + extra > sp) {
        out.defended += s.area[py];
        out.defendedPeople += s.people[i];
      } else {
        out.area += s.area[py];
        out.people += s.people[i];
      }
    }
  }
  return out;
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  const post = (r: Reply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer);
  try {
    if (req.type === 'build') {
      levels ??= loadSeaLevels(req.dataUrl);
      lines ??= loadLines(req.linesUrl);
      const {raster, ms} = await build(req.view, req.populationUrl, req.coastUrl);
      post({id: req.id, type: 'build', raster, ms}, [raster.elev.buffer, raster.spill.buffer, raster.water.buffer]);
    } else {
      post({id: req.id, type: 'count', counts: await count(req.scenario, req.quantile, req.year, req.line, req.visible)});
    }
  } catch (err) {
    post({id: req.id, type: 'error', error: String(err)});
  }
};
