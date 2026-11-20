// Builds the hexagon scene off the main thread. It owns the sampled data, spreads sampling over a
// pool of workers (one terrain tile always goes to the same one, so each tile is decoded once) and
// answers with transferable arrays ready for the GPU.
import {cellSize, centerOf, levelZoom, lngLat, NEIGHBOURS, SQ3} from './grid';
import {COVER_COLORS, type RGB} from './colors';
import {COVER, type SampleRequest, type SampleResult} from './worker';

export const EARTH = 40075016.68557849;
/** Towards the sun: high in the west-north-west. Shared with the shaders. */
export const LIGHT: [number, number, number] = (() => {
  const v = [-0.62, -0.42, 0.95];
  const l = Math.hypot(...v);
  return v.map((x) => x / l) as [number, number, number];
})();

export type Mode = 'elevation' | 'cover';
export type View = {
  /** The ground the camera sees (grown by a margin), Mercator. */
  poly: Array<[number, number]>;
  /** The visible ground without margin, for the opening wave. */
  visible: Array<[number, number]>;
  center: [number, number];
  zoom: number;
  bearing: number;
  cellPx: number;
  maxCells: number;
  /** The level the caller wants (grid.ts); a smaller one is used when it would exceed `maxCells`. */
  level: number;
  /** Which way the zoom last went (1 in, -1 out): the neighbouring level on that side is sampled first. */
  heading: number;
};
export type SceneRequest =
  | {type: 'scene'; id: number; view: View; mode: Mode}
  | {type: 'colors'; id: number; mode: Mode}
  /** Land and islands in view at a sea level, against today's. */
  | {type: 'stats'; id: number; level: number}
  /** What one cell of the scene on screen is (`scene` is the id of the reply that built it). */
  | {type: 'cell'; id: number; scene: number; index: number};
export type Stats = {level: number; land: number; landToday: number; islands: number; islandsToday: number};
export type CellInfo = {
  elev: number;
  /** 0 land, 1 sea, 2 lake, 3 river */
  kind: number;
  cover: string;
  /** The sea level at which the ocean reaches this cell, metres (see `spill` in build). */
  spill: number;
  lng: number;
  lat: number;
};
export type SceneReply = {
  type: 'scene' | 'colors' | 'stats' | 'cell';
  id: number;
  count: number;
  level: number;
  /** The level asked for, before `maxCells` capped it. */
  wanted: number;
  origin: [number, number];
  zscale: number;
  /** Map zoom the relief exaggeration was computed for; the layer rescales it to the current zoom. */
  reliefZoom: number;
  radius: number;
  base: number;
  /** Relief exaggeration and terrace height, in the scene's displayed metres. */
  landScale: number;
  seaScale: number;
  landStep: number;
  centers?: Float32Array;
  /** Elevation of each cell in metres: land above 0, the sea floor below (negative). */
  elev?: Float32Array;
  /** The lowest neighbouring elevation, metres: walls need not reach further down. */
  low?: Float32Array;
  /** The sea level at which the ocean first reaches each cell, metres. */
  spill?: Float32Array;
  info?: Float32Array;
  colors: Uint8Array;
  covers: string[];
  stats?: Stats;
  cell?: CellInfo | null;
  timing: {region: number; sample: number; build: number; sampled: number};
};

// ------------------------------------------------------------------------------------------------
// Sampler pool

const POOL = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
const samplers = Array.from({length: POOL}, () => new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'}));
let requestId = 0;
const waiting = new Map<number, (r: SampleResult) => void>();
for (const w of samplers)
  w.onmessage = (e: MessageEvent<SampleResult & {error?: string}>) => {
    if (e.data.error) console.warn(e.data.error);
    const done = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    done?.(e.data);
  };
const ask = (w: Worker, s: number, uv: Float64Array) =>
  new Promise<SampleResult>((resolve) => {
    const id = ++requestId;
    waiting.set(id, resolve);
    w.postMessage({id, s, cells: uv} satisfies SampleRequest, [uv.buffer]);
  });

/** The terrain zoom a sampler reads for cells of this size (kept in step with worker.ts). */
const terrainZoom = (s: number) => Math.max(0, Math.min(12, Math.ceil(Math.log2(1.25 / (512 * SQ3 * s)))));

// ------------------------------------------------------------------------------------------------
// Sampled data

type Store = {elev: Float32Array; kind: Uint8Array; band: Float32Array; floor: Float32Array; cover: Uint8Array; n: number; index: Map<number, number>};
const OFF = 2 ** 21;
const cellKey = (q: number, r: number) => (q + OFF) * 4194304 + (r + OFF);
const stores = new Map<number, Store>();
function storeFor(level: number): Store {
  let s = stores.get(level);
  if (!s) {
    const cap = 1 << 16;
    s = {elev: new Float32Array(cap), kind: new Uint8Array(cap), band: new Float32Array(cap), floor: new Float32Array(cap), cover: new Uint8Array(cap), n: 0, index: new Map()};
    stores.set(level, s);
  }
  for (const l of stores.keys()) if (Math.abs(l - level) > 3) stores.delete(l);
  return s;
}
function grow(s: Store, need: number) {
  if (s.n + need <= s.elev.length) return;
  let cap = s.elev.length;
  while (cap < s.n + need) cap *= 2;
  const re = <T extends Float32Array | Uint8Array>(a: T, C: new (n: number) => T) => {
    const b = new C(cap);
    b.set(a);
    return b;
  };
  s.elev = re(s.elev, Float32Array);
  s.kind = re(s.kind, Uint8Array);
  s.band = re(s.band, Float32Array);
  s.floor = re(s.floor, Float32Array);
  s.cover = re(s.cover, Uint8Array);
}

type Region = {level: number; n: number; q: Int32Array; r: Int32Array; u: Float64Array; v: Float64Array};

function inside(poly: Array<[number, number]>, u: number, v: number) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, vi] = poly[i];
    const [uj, vj] = poly[j];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) hit = !hit;
  }
  return hit;
}

function regionAt(poly: Array<[number, number]>, level: number, max: number): Region {
  const size = cellSize(level);
  const us = poly.map((p) => p[0]);
  const vs = poly.map((p) => p[1]);
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  // rough upper bound, then exact rows: each row's span comes from the polygon's edges
  const rows = Math.ceil((v1 - v0) / (1.5 * size)) + 3;
  const cols = Math.ceil((u1 - u0) / (SQ3 * size)) + 3;
  const cap = Math.min(max + 1, rows * cols);
  const q = new Int32Array(cap);
  const r = new Int32Array(cap);
  const u = new Float64Array(cap);
  const v = new Float64Array(cap);
  let n = 0;
  const r0 = Math.floor(v0 / (1.5 * size)) - 1;
  const r1 = Math.ceil(v1 / (1.5 * size)) + 1;
  for (let rr = r0; rr <= r1 && n <= max; rr++) {
    const cv = 1.5 * size * rr;
    // where this row crosses the polygon
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ui, vi] = poly[i];
      const [uj, vj] = poly[j];
      if (vi > cv !== vj > cv) {
        const x = ((uj - ui) * (cv - vi)) / (vj - vi) + ui;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    if (lo > hi) continue;
    const q0 = Math.floor(lo / (SQ3 * size) - rr / 2);
    const q1 = Math.ceil(hi / (SQ3 * size) - rr / 2);
    for (let qq = q0; qq <= q1; qq++) {
      const cu = SQ3 * size * (qq + rr / 2);
      if (cu < lo || cu > hi) continue;
      if (n >= cap) break;
      q[n] = qq;
      r[n] = rr;
      u[n] = cu;
      v[n] = cv;
      n++;
    }
  }
  return {level, n, q: q.subarray(0, n), r: r.subarray(0, n), u: u.subarray(0, n), v: v.subarray(0, n)};
}

function regionFor(view: View): Region {
  let level = view.level;
  let region = regionAt(view.poly, level, view.maxCells);
  while (region.n > view.maxCells) region = regionAt(view.poly, --level, view.maxCells);
  return region;
}

async function ensureData(region: Region) {
  const store = storeFor(region.level);
  const size = cellSize(region.level);
  const zt = terrainZoom(size);
  const tiles = 2 ** zt;
  // cells grouped by the terrain tile they sit in; each tile always goes to the same sampler
  const parts: number[][] = samplers.map(() => []);
  for (let i = 0; i < region.n; i++) {
    if (store.index.has(cellKey(region.q[i], region.r[i]))) continue;
    const tx = Math.floor(region.u[i] * tiles);
    const ty = Math.floor(region.v[i] * tiles);
    parts[(((tx * 73856093) ^ (ty * 19349663)) >>> 0) % POOL].push(i);
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  if (!total) return 0;
  await Promise.all(
    parts.map(async (idx, w) => {
      if (!idx.length) return;
      const uv = new Float64Array(idx.length * 2);
      idx.forEach((i, k) => {
        uv[k * 2] = region.u[i];
        uv[k * 2 + 1] = region.v[i];
      });
      const res = await ask(samplers[w], size, uv);
      if (!res.elev) return;
      grow(store, idx.length);
      idx.forEach((i, k) => {
        const key = cellKey(region.q[i], region.r[i]);
        if (store.index.has(key)) return;
        const at = store.n++;
        store.index.set(key, at);
        store.elev[at] = res.elev[k];
        store.kind[at] = res.kind[k];
        store.band[at] = res.band[k];
        store.floor[at] = res.depth[k];
        store.cover[at] = res.cover[k];
      });
    }),
  );
  return total;
}

// ------------------------------------------------------------------------------------------------
// From data to blocks

const grainOf = (q: number, r: number) => {
  const n = Math.sin(q * 12.9898 + r * 78.233) * 43758.5453;
  return n - Math.floor(n);
};
const shadeRGB = ([r, g, b]: RGB, k: number): RGB => [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)];
const DIRS = NEIGHBOURS.map(([dq, dr]) => {
  const [x, y] = centerOf(dq, dr, 1);
  const l = Math.hypot(x, y);
  return [x / l, y / l];
});

type Scene = {
  id: number;
  region: Region;
  kind: Uint8Array;
  cover: Uint8Array;
  height: Float32Array;
  spill: Float32Array;
  /** Area of each cell, km² (Mercator cells shrink towards the poles). */
  area: Float32Array;
  /** 1 where the cell is on screen, not in the margin. */
  visible: Uint8Array;
  /** 1 where the cell lies on the edge of the scene. */
  edge: Uint8Array;
  /** Neighbour k of cell i, or -1. */
  next: Int32Array;
};
let scene: Scene | undefined;

/**
 * Per-cell colours the GPU cannot work out itself. Elevation colours depend on the sea level the
 * viewer picks, so the shader computes them (alpha 0 here); land cover comes from the tiles.
 */
function colorsFor(sc: Scene, mode: Mode): Uint8Array {
  const {region, kind, cover} = sc;
  const out = new Uint8Array(region.n * 4);
  if (mode !== 'cover') return out;
  for (let i = 0; i < region.n; i++) {
    if (kind[i] !== 0) continue;
    const g = grainOf(region.q[i], region.r[i]);
    const c = shadeRGB(COVER_COLORS[COVER[cover[i]]] ?? COVER_COLORS[''], 0.92 + g * 0.14);
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

function coversOf(sc: Scene) {
  const present = new Set<string>();
  for (let i = 0; i < sc.region.n; i++) if (sc.kind[i] === 0) present.add(COVER[sc.cover[i]]);
  return [...present];
}

function build(view: View, unsorted: Region, mode: Mode): Omit<SceneReply, 'id' | 'type' | 'timing'> {
  // nearest cells first: the depth test then rejects most of what lies behind them
  const fx = Math.sin((view.bearing * Math.PI) / 180);
  const fy = -Math.cos((view.bearing * Math.PI) / 180);
  const order = new Uint32Array(unsorted.n);
  const along = new Float64Array(unsorted.n);
  for (let i = 0; i < unsorted.n; i++) {
    order[i] = i;
    along[i] = unsorted.u[i] * fx + unsorted.v[i] * fy;
  }
  order.sort((a, b) => along[a] - along[b]);
  const region: Region = {
    level: unsorted.level,
    n: unsorted.n,
    q: Int32Array.from(order, (i) => unsorted.q[i]),
    r: Int32Array.from(order, (i) => unsorted.r[i]),
    u: Float64Array.from(order, (i) => unsorted.u[i]),
    v: Float64Array.from(order, (i) => unsorted.v[i]),
  };
  const {n, q, r} = region;
  const store = storeFor(region.level);
  const size = cellSize(region.level);
  const [cu, cv] = view.center;
  const lat = lngLat(cu, cv)[1];
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const spacingM = SQ3 * size * EARTH * cosLat;
  // relief scaled to the view, not to the cell: 3,000 m of mountain reads the same at any zoom. It is
  // computed for the zoom this level belongs to, so every scene of a level has the same heights; the
  // layer rescales it continuously to the actual zoom.
  const reliefZoom = levelZoom(region.level, view.cellPx);
  const metresPerPx = (EARTH * cosLat) / (512 * 2 ** reliefZoom);
  // the square root keeps continents readable: zoomed out, mountains would otherwise become spikes
  const landScale = Math.max(1.3, 0.88 * Math.sqrt(metresPerPx));
  const seaScale = Math.max(0.7, 0.285 * Math.sqrt(metresPerPx));
  const landStep = Math.max(8, (0.45 * spacingM) / landScale);

  let qmin = Infinity, qmax = -Infinity, rmin = Infinity, rmax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (q[i] < qmin) qmin = q[i];
    if (q[i] > qmax) qmax = q[i];
    if (r[i] < rmin) rmin = r[i];
    if (r[i] > rmax) rmax = r[i];
  }
  const W = qmax - qmin + 1;
  const H = rmax - rmin + 1;
  const grid = new Int32Array(Math.max(1, W * H)).fill(-1);
  for (let i = 0; i < n; i++) grid[(r[i] - rmin) * W + (q[i] - qmin)] = i;
  const at = (i: number, k: number) => {
    const qq = q[i] + NEIGHBOURS[k][0] - qmin;
    const rr = r[i] + NEIGHBOURS[k][1] - rmin;
    return qq < 0 || rr < 0 || qq >= W || rr >= H ? -1 : grid[rr * W + qq];
  };

  const kind = new Uint8Array(n);
  const elev = new Float32Array(n);
  const depth = new Float32Array(n);
  const cover = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = store.index.get(cellKey(q[i], r[i]));
    if (s === undefined) continue;
    kind[i] = store.kind[s];
    elev[i] = Math.max(0, store.elev[s]);
    cover[i] = store.cover[s];
    if (kind[i] === 1) depth[i] = store.floor[s] > 0 ? store.floor[s] : Math.max(20, store.band[s] * 1.4);
  }
  const next = new Float32Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      if (kind[i] !== 1) continue;
      let sum = depth[i] * 2;
      let c = 2;
      for (let k = 0; k < 6; k++) {
        const j = at(i, k);
        if (j >= 0 && kind[j] === 1) {
          sum += depth[j];
          c++;
        }
      }
      next[i] = sum / c;
    }
    for (let i = 0; i < n; i++) if (kind[i] === 1) depth[i] = next[i];
  }
  // one surface for land and sea floor: what is land depends on the sea level the viewer picks
  const height = new Float32Array(n);
  const smooth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    height[i] = kind[i] === 1 ? -depth[i] : elev[i];
    smooth[i] = kind[i] === 1 ? -depth[i] * seaScale : elev[i] * landScale;
  }

  // Where the ocean can reach: the open sea along the edge of the scene floods inwards, cell to
  // cell, and each cell learns the lowest sea level that reaches it (the highest pass on its best
  // way from the ocean). Land behind a ridge stays dry until the sea tops the ridge; a sea cut off
  // by a sill keeps its water as a lake when the ocean drops below the sill.
  const nbr = new Int32Array(n * 6);
  const edge = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 6; k++) {
      const j = at(i, k);
      nbr[i * 6 + k] = j;
      if (j < 0) edge[i] = 1;
    }
  const spill = new Float32Array(n).fill(Infinity);
  const heap = new MinHeap(n * 2);
  for (let i = 0; i < n; i++) if (kind[i] === 1 && edge[i]) heap.push(i, (spill[i] = height[i]));
  // a view with no open sea along its edge: every sea in it counts as the ocean
  if (!heap.size) for (let i = 0; i < n; i++) if (kind[i] === 1) heap.push(i, (spill[i] = height[i]));
  while (heap.size) {
    const [i, key] = heap.pop();
    if (key > spill[i]) continue;
    for (let k = 0; k < 6; k++) {
      const j = nbr[i * 6 + k];
      if (j < 0) continue;
      const s = Math.max(key, height[j]);
      if (s < spill[j]) heap.push(j, (spill[j] = s));
    }
  }
  // cells the ocean never reaches (no sea in view at all) fall back to their own elevation
  for (let i = 0; i < n; i++) if (spill[i] === Infinity) spill[i] = height[i];
  const area = new Float32Array(n);
  const visible = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.cos((lngLat(region.u[i], region.v[i])[1] * Math.PI) / 180);
    const d = (SQ3 * size * EARTH * c) / 1000;
    area[i] = (SQ3 / 2) * d * d;
    visible[i] = inside(view.visible, region.u[i], region.v[i]) ? 1 : 0;
  }

  const base = -7500 * seaScale - spacingM;
  const [lx, ly, lz] = LIGHT;
  const info = new Float32Array(n * 4);
  const low = new Float32Array(n);
  let reach = 0;
  for (const [u, v] of view.visible) reach = Math.max(reach, Math.hypot(u - cu, v - cv));
  reach ||= 1;
  for (let i = 0; i < n; i++) {
    let gx = 0;
    let gy = 0;
    let sum = 0;
    // a wall only needs to reach down to its lowest neighbour: below that nothing can see it
    let floor = height[i];
    for (let k = 0; k < 6; k++) {
      const j = at(i, k);
      const hj = j >= 0 ? smooth[j] : smooth[i];
      gx += (hj - smooth[i]) * DIRS[k][0];
      gy += (hj - smooth[i]) * DIRS[k][1];
      sum += hj;
      floor = j >= 0 ? Math.min(floor, height[j]) : -11000;
    }
    low[i] = floor;
    gx /= 3 * spacingM;
    gy /= 3 * spacingM;
    const dot = (-gx * lx - gy * ly + lz) / Math.hypot(gx, gy, 1);
    let shade = 1 + (kind[i] === 1 ? 0.55 : 0.85) * (dot - lz);
    const cavity = (sum / 6 - smooth[i]) / spacingM;
    shade *= 1 - Math.max(-0.06, Math.min(0.16, cavity * 0.3));
    info[i * 4] = Math.min(1.25, Math.hypot(region.u[i] - cu, region.v[i] - cv) / reach);
    info[i * 4 + 1] = grainOf(r[i], q[i]) * 0.16;
    info[i * 4 + 2] = Math.max(0.68, Math.min(1.25, shade));
    info[i * 4 + 3] = kind[i];
  }
  const centers = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    centers[i * 2] = (region.u[i] - cu) * EARTH;
    centers[i * 2 + 1] = (region.v[i] - cv) * EARTH;
  }
  scene = {id: 0, region, kind, cover, height, spill: spill.slice(), area, visible, edge, next: nbr};
  return {
    count: n,
    level: region.level,
    wanted: view.level,
    origin: [cu, cv],
    zscale: 1 / cosLat,
    reliefZoom,
    radius: size * EARTH,
    base,
    landScale,
    seaScale,
    landStep,
    centers,
    elev: height.slice(),
    low,
    spill,
    info,
    colors: colorsFor(scene, mode),
    covers: coversOf(scene),
  };
}

// ------------------------------------------------------------------------------------------------

const blank = (type: SceneReply['type'], id: number): SceneReply => ({
  type,
  id,
  count: -1,
  level: 0,
  wanted: 0,
  reliefZoom: 0,
  landScale: 1,
  seaScale: 1,
  landStep: 1,
  origin: [0, 0],
  zscale: 1,
  radius: 0,
  base: 0,
  colors: new Uint8Array(0),
  covers: [],
  timing: {region: 0, sample: 0, build: 0, sampled: 0},
});

/** Whether a cell is under water at a sea level (the shader decides the same way). */
function wet(sc: Scene, i: number, level: number) {
  const sp = sc.spill[i];
  return sc.kind[i] === 1 ? level > sp || sc.height[i] < sp : level > Math.max(sp, 0);
}

/** Land area in view, and islands: dry patches the scene's edge does not touch. */
function statsAt(sc: Scene, level: number) {
  const n = sc.region.n;
  let land = 0;
  for (let i = 0; i < n; i++) if (sc.visible[i] && !wet(sc, i, level)) land += sc.area[i];
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let islands = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i] || wet(sc, i, level)) continue;
    let top = 0;
    let size = 0;
    let open = false;
    let shown = false;
    stack[top++] = i;
    seen[i] = 1;
    while (top) {
      const c = stack[--top];
      size++;
      if (sc.edge[c]) open = true;
      if (sc.visible[c]) shown = true;
      for (let k = 0; k < 6; k++) {
        const j = sc.next[c * 6 + k];
        if (j >= 0 && !seen[j] && !wet(sc, j, level)) {
          seen[j] = 1;
          stack[top++] = j;
        }
      }
    }
    if (!open && shown && size >= 2) islands++;
  }
  return {land: Math.round(land), islands};
}

let latest = 0;
self.onmessage = async (e: MessageEvent<SceneRequest>) => {
  const req = e.data;
  const post = (reply: SceneReply) => {
    const transfer = [reply.centers, reply.elev, reply.low, reply.spill, reply.info, reply.colors].filter(Boolean).map((a) => a!.buffer);
    (self as unknown as Worker).postMessage(reply, transfer);
  };
  if (req.type === 'colors') {
    if (!scene) return post(blank('colors', req.id));
    post({...blank('colors', req.id), count: scene.region.n, colors: colorsFor(scene, req.mode), covers: coversOf(scene)});
    return;
  }
  if (req.type === 'stats') {
    const sc = scene;
    if (!sc) return post(blank('stats', req.id));
    const now = statsAt(sc, req.level);
    const today = statsAt(sc, 0);
    post({...blank('stats', req.id), stats: {level: req.level, land: now.land, landToday: today.land, islands: now.islands, islandsToday: today.islands}});
    return;
  }
  if (req.type === 'cell') {
    const sc = scene;
    const i = req.index;
    if (!sc || sc.id !== req.scene || i < 0 || i >= sc.region.n) return post({...blank('cell', req.id), cell: null});
    const [lng, lat] = lngLat(sc.region.u[i], sc.region.v[i]);
    post({...blank('cell', req.id), cell: {elev: sc.height[i], kind: sc.kind[i], cover: COVER[sc.cover[i]], spill: sc.spill[i], lng, lat}});
    return;
  }
  latest = req.id;
  const t0 = performance.now();
  const region = regionFor(req.view);
  const t1 = performance.now();
  const sampled = await ensureData(region);
  if (req.id !== latest) {
    // the camera has moved on: answer anyway, so the caller is never left waiting
    post(blank('scene', req.id));
    return;
  }
  const t2 = performance.now();
  const built = build(req.view, region, req.mode);
  scene!.id = req.id;
  const t3 = performance.now();
  post({type: 'scene', id: req.id, ...built, timing: {region: Math.round(t1 - t0), sample: Math.round(t2 - t1), build: Math.round(t3 - t2), sampled}});
  prefetch(req.id, req.view, region.level);
};

/** A binary heap of cell indices by key, for the flood from the ocean. Stale entries are skipped by the caller. */
class MinHeap {
  private keys: Float64Array;
  private items: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.items = new Int32Array(cap);
  }
  push(item: number, key: number) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const it = new Int32Array(this.size * 2);
      it.set(this.items);
      this.items = it;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p];
      this.items[i] = this.items[p];
      i = p;
    }
    this.keys[i] = key;
    this.items[i] = item;
  }
  pop(): [number, number] {
    const item = this.items[0];
    const key = this.keys[0];
    const lastKey = this.keys[--this.size];
    const lastItem = this.items[this.size];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lastKey) break;
      this.keys[i] = this.keys[c];
      this.items[i] = this.items[c];
      i = c;
    }
    this.keys[i] = lastKey;
    this.items[i] = lastItem;
    return [item, key];
  }
}

/**
 * While the camera rests, the neighbouring levels are sampled ahead (the side the zoom last went
 * first), over the ground they would show, so the next change of level only has to build.
 */
async function prefetch(id: number, view: View, level: number) {
  const dir = view.heading < 0 ? -1 : 1;
  // two levels ahead: a zoom crosses one level every third of a doubling, faster than tiles arrive
  for (const dl of [dir, 2 * dir, -dir]) {
    if (id !== latest) return;
    const k = 2 ** (-dl / 3);
    const [cu, cv] = view.center;
    const poly = view.poly.map(([u, v]) => [cu + (u - cu) * k, cv + (v - cv) * k] as [number, number]);
    const region = regionAt(poly, level + dl, view.maxCells);
    if (region.n <= view.maxCells) await ensureData(region);
  }
}
