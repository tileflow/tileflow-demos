// Prepares, per World z15 tile, what the sun layer draws:
//   - `buildings`: every wall as a quad whose top the GPU slides along the sun's shadow, so the
//     ground shadow of the whole tile is one draw call for any sun position;
//   - `sidewalks`: sidewalk segments beside each street, with their minutes of direct sun that day
//     and, for the share shown in the panel, their sunlit length every five minutes.
//
// Positions are Web Mercator metres from a shared origin (u east, v south), the projection the map
// draws in. Real lengths (heights, offsets, rays) are divided by cos(latitude) to match them.
// Tiles are fetched by the URLs the map uses; they are immutable, so the browser serves the map's
// own downloads from its cache.

import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {localInstant, solarPosition, zoneOffsetMinutes} from './sun';
import {marchOnGpu} from './gpu-march';

export const Z = 15;
const EARTH = 40075016.68557849; // metres round the equator: one Mercator unit
const CELL = 2; // Mercator metres per height-raster cell
const SAMPLE = 3; // real metres between sidewalk samples
const STEP_MINUTES = 5;
const SLOTS = 1440 / STEP_MINUTES;
const MAX_RAY = 1200; // real metres a shadow can reach
const NEAR_BUILDING = 25; // a sidewalk has a building within this many real metres
const FACE_GAP = 1.5;
const OFFSET: Record<string, number> = {primary: 13, secondary: 13, tertiary: 7, street: 7, pedestrian: 4};
const SIDEWALK_HALF = 1.5; // real metres from the kerb to the middle of a sidewalk with no building on it
const SIDEWALK_WIDEST = 4; // real metres from the kerb to the furthest a sidewalk's middle can be
const FACE_SEARCH: Record<string, number> = {primary: 30, secondary: 30, tertiary: 18, street: 18, pedestrian: 14};

export type WorkerRequest =
  | {kind: 'buildings'; job: number; x: number; y: number; origin: [number, number]}
  | {kind: 'sidewalks'; job: number; x: number; y: number; origin: [number, number]; date: string; timeZone: string; gpu?: boolean; also?: string[]; trees?: boolean}
  | {kind: 'point'; job: number; x: number; y: number; origin: [number, number]; u: number; v: number; date: string; timeZone: string; trees?: boolean};

/** One sidewalk spot through a whole year. */
export type PointResult = {
  kind: 'point';
  job: number;
  x: number;
  y: number;
  year: number;
  /** Per day of the year: minutes of direct sun, and minutes with the sun above the horizon. */
  sun: Float32Array;
  daylight: Float32Array;
  /** On the chosen date, per five-minute slot: 1 sun up, 2 sun up and on the spot. */
  today: Uint8Array;
  ms: number[];
};

export type BuildingsResult = {kind: 'buildings'; job: number; x: number; y: number; walls: Float32Array; estimated: number; total: number; ms: [number, number]};

export type SidewalksResult = {
  kind: 'sidewalks';
  job: number;
  x: number;
  y: number;
  date: string;
  /** Other dates averaged into the minutes (a month is a few days of it); runs stay those of `date`. */
  also?: string[];
  /** Per vertex: a.u a.v b.u b.v side end minutes (6 vertices per segment). */
  segments: Float32Array;
  /** Per segment: middle u, v (Mercator metres from the origin), real length and minutes of sun. */
  pieces: Float32Array;
  /** Per segment, in order: how many sunlit runs, then each run's first and last-plus-one slot. */
  runs: Uint16Array;
  /** Milliseconds waiting for tiles, computing, rasterising and marching rays. */
  ms: number[];
};

type ParsedTile = {
  buildings: {rings: [number, number][][]; height: number; estimated: boolean}[];
  roads: {line: [number, number][]; cls: string}[];
  /** Every street at ground level that cars use, with half its width in real metres. */
  carriageways: {line: [number, number][]; half: number}[];
  /** Every tree, and points every few metres along each row of trees. */
  trees: [number, number][];
};

/** Street trees carry no height in the tiles: a typical crown, in real metres, solid down to the ground. */
const TREE_HEIGHT = 10;
const TREE_RADIUS = 3.5;
const TREE_ROW_SPACING = 7;

/** Half the width of the roadway, kerb to kerb, in real metres: sidewalks never cross it. */
const CARRIAGEWAY: Record<string, number> = {motorway: 11, trunk: 10, primary: 9, secondary: 8, tertiary: 5, street: 4, service: 2.5};

const n = 2 ** Z;
const tileCache = new Map<string, Promise<ParsedTile>>();
let templatePromise: Promise<string> | undefined;

function template(): Promise<string> {
  templatePromise ??= fetch('https://api.tileflow.dev/tiles/world/tiles.json')
    .then((r) => r.json())
    .then((j) => j.tiles[0] as string);
  return templatePromise;
}

const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;
const latOfMercY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** Clip a polyline (tile coordinates) to the tile square; returns the inside pieces. */
function clipLine(line: {x: number; y: number}[], extent: number): {x: number; y: number}[][] {
  const out: {x: number; y: number}[][] = [];
  let current: {x: number; y: number}[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const {x: x0, y: y0} = line[i];
    const dx = line[i + 1].x - x0, dy = line[i + 1].y - y0;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, x0], [dx, extent - x0], [-dy, y0], [dy, extent - y0]] as const) {
      if (p === 0) {
        if (q < 0) ok = false;
      } else if (p < 0) t0 = Math.max(t0, q / p);
      else t1 = Math.min(t1, q / p);
    }
    if (!ok || t0 > t1) {
      if (current.length > 1) out.push(current);
      current = [];
      continue;
    }
    if (current.length === 0 || t0 > 0) {
      if (current.length > 1) out.push(current);
      current = [{x: x0 + t0 * dx, y: y0 + t0 * dy}];
    }
    current.push({x: x0 + t1 * dx, y: y0 + t1 * dy});
    if (t1 < 1) {
      out.push(current);
      current = [];
    }
  }
  if (current.length > 1) out.push(current);
  return out;
}

/** A tile's buildings and streets in Mercator units (0–1). */
function loadTile(x: number, y: number): Promise<ParsedTile> {
  const key = `${x}/${y}`;
  let promise = tileCache.get(key);
  if (!promise) {
    promise = (async () => {
      const url = (await template()).replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`World tile ${key}: HTTP ${res.status}`);
      const tile = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
      const at = (px: number, py: number, extent: number): [number, number] => [(x + px / extent) / n, (y + py / extent) / n];
      const parsed: ParsedTile = {buildings: [], roads: [], carriageways: [], trees: []};
      const b = tile.layers.building;
      if (b)
        for (let i = 0; i < b.length; i++) {
          const f = b.feature(i);
          parsed.buildings.push({
            rings: f.loadGeometry().map((ring) => ring.map((p) => at(p.x, p.y, b.extent))),
            height: Number(f.properties.height ?? 10),
            estimated: f.properties.height_source !== 'height',
          });
        }
      const r = tile.layers.road;
      if (r)
        for (let i = 0; i < r.length; i++) {
          const f = r.feature(i);
          const p = f.properties;
          const cls = String(p.class);
          if (p.structure === 'tunnel' || p.structure === 'bridge' || p.underground || p.covered || p.indoor) continue;
          const keep = cls in OFFSET && !p.link;
          const half = CARRIAGEWAY[cls];
          if (!keep && half === undefined) continue;
          for (const part of f.loadGeometry())
            for (const piece of clipLine(part, r.extent)) {
              const line = piece.map((q) => at(q.x, q.y, r.extent));
              if (keep) parsed.roads.push({line, cls});
              if (half !== undefined) parsed.carriageways.push({line, half});
            }
        }
      const t = tile.layers.tree;
      if (t)
        for (let i = 0; i < t.length; i++) {
          const f = t.feature(i);
          for (const part of f.loadGeometry()) {
            if (f.type === 1) {
              for (const q of part) if (q.x >= 0 && q.y >= 0 && q.x < t.extent && q.y < t.extent) parsed.trees.push(at(q.x, q.y, t.extent));
              continue;
            }
            // a row of trees: one every few metres along it (tile units per real metre, roughly)
            const step = (TREE_ROW_SPACING / (EARTH / n)) * t.extent / Math.cos(Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))));
            for (const piece of clipLine(part, t.extent))
              for (let s = 0; s + 1 < piece.length; s++) {
                const a = piece[s], b = piece[s + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
                for (let d = 0; d < len; d += step) parsed.trees.push(at(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len, t.extent));
              }
          }
        }
      return parsed;
    })();
    tileCache.set(key, promise);
    promise.catch(() => tileCache.delete(key));
    // keep memory bounded
    if (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value!);
  }
  return promise;
}

const post = (message: unknown, transfer: Transferable[]) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.kind === 'buildings') {
      const result = await buildings(request);
      post(result, [result.walls.buffer]);
    } else if (request.kind === 'point') {
      const result = await point(request);
      post(result, [result.sun.buffer, result.daylight.buffer, result.today.buffer]);
    } else {
      const result = await sidewalks(request);
      post(result, [result.segments.buffer, result.pieces.buffer, result.runs.buffer]);
    }
  } catch (error) {
    post({kind: 'error', job: request.job, x: request.x, y: request.y, message: String(error)}, []);
  }
};

/** Walls as quads: per vertex u, v, height (Mercator metres), top (0 foot, 1 top). */
async function buildings({job, x, y, origin}: Extract<WorkerRequest, {kind: 'buildings'}>): Promise<BuildingsResult> {
  const t0 = performance.now();
  const tile = await loadTile(x, y);
  const t1 = performance.now();
  const [ox, oy] = [mercX(origin[0]), mercY(origin[1])];
  const scale = 1 / Math.cos((latOfMercY((y + 0.5) / n) * Math.PI) / 180);
  const out: number[] = [];
  let estimated = 0;
  for (const b of tile.buildings) {
    if (b.estimated) estimated++;
    const h = b.height * scale;
    for (const ring of b.rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        const au = (a[0] - ox) * EARTH, av = (a[1] - oy) * EARTH, cu = (c[0] - ox) * EARTH, cv = (c[1] - oy) * EARTH;
        if (au === cu && av === cv) continue;
        // two triangles: foot a, foot c, top c; foot a, top c, top a
        out.push(au, av, h, 0, cu, cv, h, 0, cu, cv, h, 1, au, av, h, 0, cu, cv, h, 1, au, av, h, 1);
      }
  }
  return {kind: 'buildings', job, x, y, walls: Float32Array.from(out), estimated, total: tile.buildings.length, ms: [t1 - t0, performance.now() - t1]};
}

/** The instant of every five-minute slot of a day, per date and time zone (Intl is slow). */
const instantCache = new Map<string, Date[]>();
function slotInstants(date: string, timeZone: string): Date[] {
  const key = `${date}|${timeZone}`;
  let list = instantCache.get(key);
  if (!list) {
    list = Array.from({length: SLOTS}, (_, slot) => localInstant(date, slot * STEP_MINUTES, timeZone));
    instantCache.set(key, list);
  }
  return list;
}

/**
 * A tile and its eight neighbours as rasters in Mercator metres from the origin: building heights
 * (shadows reach in from outside the tile) and roadways, kerb to kerb.
 */
async function scene(x: number, y: number, origin: [number, number], withTrees = true) {
  const tiles = await Promise.all([-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => loadTile(x + dx, y + dy))));
  const loaded = performance.now();
  const lat = latOfMercY((y + 0.5) / n);
  const lon = ((x + 0.5) / n) * 360 - 180;
  const k = 1 / Math.cos((lat * Math.PI) / 180); // real metres → Mercator metres
  const [ox, oy] = [mercX(origin[0]), mercY(origin[1])];
  const tileSize = EARTH / n;
  const gu0 = ((x - 1) / n - ox) * EARTH, gv0 = ((y - 1) / n - oy) * EARTH;
  const size = Math.ceil((3 * tileSize) / CELL);

  // Building heights. Scanline fill in which each edge visits only the rows it crosses.
  const height = new Float32Array(size * size);
  const rows: number[][] = [];
  for (const tile of tiles)
    for (const b of tile.buildings) {
      const h = b.height * k;
      let minV = Infinity, maxV = -Infinity;
      const rings = b.rings.map((ring) => {
        const flat = new Float64Array(ring.length * 2);
        for (let i = 0; i < ring.length; i++) {
          const u = (ring[i][0] - ox) * EARTH, v = (ring[i][1] - oy) * EARTH;
          flat[2 * i] = u;
          flat[2 * i + 1] = v;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
        return flat;
      });
      const j0 = Math.max(0, Math.floor((minV - gv0) / CELL)), j1 = Math.min(size - 1, Math.ceil((maxV - gv0) / CELL));
      if (j1 < j0) continue;
      for (let j = 0; j <= j1 - j0; j++) (rows[j] ??= []).length = 0;
      for (const flat of rings) {
        const m = flat.length / 2;
        for (let i = 0, prev = m - 1; i < m; prev = i++) {
          const ua = flat[2 * prev], va = flat[2 * prev + 1], ub = flat[2 * i], vb = flat[2 * i + 1];
          if (va === vb) continue;
          const lo = Math.min(va, vb), hi = Math.max(va, vb);
          const ja = Math.max(j0, Math.ceil((lo - gv0) / CELL - 0.5)), jb = Math.min(j1, Math.ceil((hi - gv0) / CELL - 0.5) - 1);
          for (let j = ja; j <= jb; j++) {
            const vc = gv0 + (j + 0.5) * CELL;
            rows[j - j0].push(ua + ((vc - va) / (vb - va)) * (ub - ua));
          }
        }
      }
      for (let j = j0; j <= j1; j++) {
        const xs = rows[j - j0];
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        const base = j * size;
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const c0 = Math.max(0, Math.ceil((xs[i] - gu0) / CELL - 0.5)), c1 = Math.min(size - 1, Math.floor((xs[i + 1] - gu0) / CELL - 0.5));
          for (let c = c0; c <= c1; c++) if (height[base + c] < h) height[base + c] = h;
        }
      }
    }

  // What casts shade: the buildings, and the trees' crowns over them (where the sidewalks run stays
  // decided by the buildings alone)
  let shade = height;
  if (withTrees) {
    shade = height.slice();
    const h = TREE_HEIGHT * k, r = TREE_RADIUS * k, reachCells = Math.ceil(r / CELL);
    for (const tile of tiles)
      for (const [mx, my] of tile.trees) {
        const u = (mx - ox) * EARTH, v = (my - oy) * EARTH;
        const ci = Math.floor((u - gu0) / CELL), cj = Math.floor((v - gv0) / CELL);
        for (let j = cj - reachCells; j <= cj + reachCells; j++) {
          if (j < 0 || j >= size) continue;
          for (let i = ci - reachCells; i <= ci + reachCells; i++) {
            if (i < 0 || i >= size) continue;
            const du = gu0 + (i + 0.5) * CELL - u, dv = gv0 + (j + 0.5) * CELL - v;
            if (du * du + dv * dv <= r * r && shade[j * size + i] < h) shade[j * size + i] = h;
          }
        }
      }
  }
  let maxHeight = 0;
  for (let i = 0; i < shade.length; i++) if (shade[i] > maxHeight) maxHeight = shade[i];

  // Roadways, kerb to kerb: a sidewalk never runs across one
  const roadway = new Uint8Array(size * size);
  for (const tile of tiles)
    for (const cw of tile.carriageways) {
      const w = cw.half * k, w2 = w * w;
      const pts = cw.line.map(([mx, my]) => [(mx - ox) * EARTH, (my - oy) * EARTH] as const);
      for (let s = 0; s + 1 < pts.length; s++) {
        const [ua, va] = pts[s], [ub, vb] = pts[s + 1];
        const du = ub - ua, dv = vb - va, len2 = du * du + dv * dv;
        const i0 = Math.max(0, Math.floor((Math.min(ua, ub) - w - gu0) / CELL)), i1 = Math.min(size - 1, Math.floor((Math.max(ua, ub) + w - gu0) / CELL));
        const j0 = Math.max(0, Math.floor((Math.min(va, vb) - w - gv0) / CELL)), j1 = Math.min(size - 1, Math.floor((Math.max(va, vb) + w - gv0) / CELL));
        for (let j = j0; j <= j1; j++) {
          const cv = gv0 + (j + 0.5) * CELL;
          for (let i = i0; i <= i1; i++) {
            const cu = gu0 + (i + 0.5) * CELL;
            const t = len2 > 0 ? Math.max(0, Math.min(1, ((cu - ua) * du + (cv - va) * dv) / len2)) : 0;
            const eu = cu - ua - t * du, ev = cv - va - t * dv;
            if (eu * eu + ev * ev <= w2) roadway[j * size + i] = 1;
          }
        }
      }
    }
  return {tiles, lat, lon, k, ox, oy, gu0, gv0, size, height, shade, roadway, maxHeight, loaded};
}

async function sidewalks({job, x, y, origin, date, timeZone, gpu: useGpu = true, also = [], trees = true}: Extract<WorkerRequest, {kind: 'sidewalks'}>): Promise<SidewalksResult> {
  // The tile and its eight neighbours: shadows reach in from outside the tile
  const t0 = performance.now();
  const {tiles, lat, lon, k, ox, oy, gu0, gv0, size, height, shade, roadway, maxHeight, loaded: t1} = await scene(x, y, origin, trees);
  const tRaster = performance.now();

  const cellAt = (u: number, v: number) => {
    const i = Math.floor((u - gu0) / CELL), j = Math.floor((v - gv0) / CELL);
    return i >= 0 && i < size && j >= 0 && j < size ? j * size + i : -1;
  };

  // The sun every five minutes; shadows fall away from it (u east, v south)
  const stepsOf = (day: string) => {
    const instants = slotInstants(day, timeZone);
    const list: {slot: number; du: number; dv: number; rise: number}[] = [];
    for (let slot = 0; slot < SLOTS; slot++) {
      const sun = solarPosition(instants[slot], lat, lon);
      if (sun.altitude <= 0.5) continue;
      const a = (sun.azimuth * Math.PI) / 180;
      list.push({slot, du: Math.sin(a), dv: -Math.cos(a), rise: Math.tan((sun.altitude * Math.PI) / 180)});
    }
    return list;
  };
  const steps = stepsOf(date);
  /** For each sun position, 1 when nothing stands between the point and the sun. */
  const sunMaskCpu = (u: number, v: number, mask: Uint8Array, at: number, steps: {du: number; dv: number; rise: number}[]) => {
    for (let s = 0; s < steps.length; s++) {
      const {du, dv, rise} = steps[s];
      const reach = Math.min(MAX_RAY * k, maxHeight / rise);
      let lit = 1;
      for (let d = 1.5; d <= reach; d += 1.5) {
        const fi = (u + du * d - gu0) / CELL, fj = (v + dv * d - gv0) / CELL;
        if (fi < 0 || fj < 0 || fi >= size || fj >= size) break;
        if (shade[(fj | 0) * size + (fi | 0)] > d * rise) {
          lit = 0;
          break;
        }
      }
      mask[at + s] = lit;
    }
  };
  const nearBuilding = (u: number, v: number) => {
    for (let a = 0; a < 16; a++) {
      const ang = (a * Math.PI) / 8;
      for (let d = CELL; d <= NEAR_BUILDING * k; d += CELL) {
        const c = cellAt(u + Math.cos(ang) * d, v + Math.sin(ang) * d);
        if (c >= 0 && height[c] > 0) return true;
      }
    }
    return false;
  };

  // 1. Where the sidewalks run: points along both sides of every street, and which join up
  const pu: number[] = [], pv: number[] = [], joins: number[] = [];
  for (const road of tiles[4].roads) {
    const pts = road.line.map(([mx, my]) => [(mx - ox) * EARTH, (my - oy) * EARTH] as [number, number]);
    const search = FACE_SEARCH[road.cls] * k;
    const ownHalf = (CARRIAGEWAY[road.cls] ?? 0) * k;
    // the sidewalk runs beside the kerb; it follows the building line only where buildings stand on
    // the sidewalk, never into front gardens and setbacks
    const kerb = ownHalf + SIDEWALK_HALF * k, widest = ownHalf + SIDEWALK_WIDEST * k;
    for (const side of [1, -1]) {
      const samples: {u: number; v: number; nu: number; nv: number; dist: number; face: boolean}[] = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
        const len = Math.hypot(ub - ua, vb - va);
        if (len < 0.5) continue;
        const nu = (-(vb - va) / len) * side, nv = ((ub - ua) / len) * side;
        for (let s = 0; s < len; s += SAMPLE * k) {
          const u = ua + ((ub - ua) * s) / len, v = va + ((vb - va) * s) / len;
          let face = -1;
          for (let d = CELL; d <= search; d += CELL / 2) {
            const c = cellAt(u + nu * d, v + nv * d);
            if (c >= 0 && height[c] > 0) {
              face = d;
              break;
            }
          }
          samples.push({u, v, nu, nv, dist: face >= (FACE_GAP + 1) * k ? Math.min(face - FACE_GAP * k, widest) : kerb, face: face >= 0});
        }
      }
      // a moving median keeps the sidewalk straight past doorways, setbacks and gaps
      const smooth = samples.map((_, i) => {
        const win = samples.slice(Math.max(0, i - 4), i + 5).map((q) => q.dist).sort((a, b) => a - b);
        return win[win.length >> 1];
      });
      let prevU = NaN, prevV = NaN;
      for (let i = 0; i < samples.length; i++) {
        const q = samples[i];
        const u = q.u + q.nu * smooth[i], v = q.v + q.nv * smooth[i];
        const c = cellAt(u, v);
        // off the street's own roadway (narrow streets put it at the house fronts) and on no other
        const crossing = c >= 0 && roadway[c] === 1 && smooth[i] >= ownHalf;
        const ok = c >= 0 && height[c] === 0 && !crossing && (road.cls === 'pedestrian' ? q.face : nearBuilding(u, v));
        if (!ok) {
          prevU = NaN;
          continue;
        }
        joins.push(Math.hypot(u - prevU, v - prevV) < SAMPLE * k * 2.5 ? 1 : 0);
        pu.push(u);
        pv.push(v);
        prevU = u;
        prevV = v;
      }
    }
  }

  // 2. Sun or shade at every point for every sun position: on the GPU when there is one
  const tm = performance.now();
  const masks = new Uint8Array(pu.length * steps.length);
  const ranOnGpu =
    useGpu &&
    steps.length > 0 &&
    marchOnGpu({height: shade, size, maxHeight, pu, pv, gu0, gv0, steps: steps.map((st) => [st.du, st.dv, st.rise, Math.min(MAX_RAY * k, maxHeight / st.rise)]), out: masks});
  if (!ranOnGpu) for (let i = 0; i < pu.length; i++) sunMaskCpu(pu[i], pv[i], masks, i * steps.length, steps);
  // other days of the month: only their minutes, added up per point
  const extra = new Float32Array(pu.length);
  for (const day of also) {
    const st = stepsOf(day);
    const m = new Uint8Array(pu.length * st.length);
    const gpuOk =
      useGpu &&
      st.length > 0 &&
      marchOnGpu({height: shade, size, maxHeight, pu, pv, gu0, gv0, steps: st.map((q) => [q.du, q.dv, q.rise, Math.min(MAX_RAY * k, maxHeight / q.rise)]), out: m});
    if (!gpuOk) for (let i = 0; i < pu.length; i++) sunMaskCpu(pu[i], pv[i], m, i * st.length, st);
    for (let i = 0; i < pu.length; i++) {
      let lit = 0;
      for (let q = 0; q < st.length; q++) lit += m[i * st.length + q];
      extra[i] += lit * STEP_MINUTES;
    }
  }
  const tMask = performance.now() - tm;

  // 3. Segments between joined points, with their minutes and runs of sun
  const verts: number[] = [];
  const pieces: number[] = [];
  const runs: number[] = [];
  const litSlots = new Uint8Array(SLOTS + 1);
  const quad = [
    [-1, 0],
    [1, 0],
    [1, 1],
    [-1, 0],
    [1, 1],
    [-1, 1],
  ];
  const ns = steps.length;
  const minutesAt = (i: number) => {
    let lit = 0;
    for (let s = 0; s < ns; s++) lit += masks[i * ns + s];
    return (lit * STEP_MINUTES + extra[i]) / (1 + also.length);
  };
  let prevMinutes = 0;
  for (let i = 0; i < pu.length; i++) {
    const minutes = minutesAt(i);
    if (joins[i] && i > 0) {
      const a = i - 1;
      const real = Math.hypot(pu[i] - pu[a], pv[i] - pv[a]) / k;
      pieces.push((pu[a] + pu[i]) / 2, (pv[a] + pv[i]) / 2, real, (prevMinutes + minutes) / 2);
      // the slots in which both ends are in the sun, as runs
      litSlots.fill(0);
      for (let s = 0; s < ns; s++) if (masks[a * ns + s] && masks[i * ns + s]) litSlots[steps[s].slot] = 1;
      const at = runs.length;
      runs.push(0);
      for (let slot = 0, open = -1; slot <= SLOTS; slot++) {
        if (litSlots[slot] && open < 0) open = slot;
        else if (!litSlots[slot] && open >= 0) {
          runs.push(open, slot);
          runs[at]++;
          open = -1;
        }
      }
      // a quad between the two points: side −1/+1 across, end 0/1 along
      for (const [sd, end] of quad) verts.push(pu[a], pv[a], pu[i], pv[i], sd, end, end ? minutes : prevMinutes);
    }
    prevMinutes = minutes;
  }
  const t2 = performance.now();
  return {
    kind: 'sidewalks',
    job,
    x,
    y,
    date,
    also,
    segments: Float32Array.from(verts),
    pieces: Float32Array.from(pieces),
    runs: Uint16Array.from(runs),
    ms: [t1 - t0, t2 - t1, tRaster - t1, tMask, ranOnGpu ? 1 : 0],
  };
}

/** A spot's direct sun every five minutes of every day of the year of the chosen date. */
async function point({job, x, y, origin, u, v, date, timeZone, trees = true}: Extract<WorkerRequest, {kind: 'point'}>): Promise<PointResult> {
  const t0 = performance.now();
  const {lat, lon, k, gu0, gv0, size, shade, maxHeight} = await scene(x, y, origin, trees);
  const lit = (when: Date): 0 | 1 | 2 => {
    const sun = solarPosition(when, lat, lon);
    if (sun.altitude <= 0.5) return 0;
    const a = (sun.azimuth * Math.PI) / 180;
    const du = Math.sin(a), dv = -Math.cos(a), rise = Math.tan((sun.altitude * Math.PI) / 180);
    const reach = Math.min(MAX_RAY * k, maxHeight / rise);
    for (let d = 1.5; d <= reach; d += 1.5) {
      const fi = (u + du * d - gu0) / CELL, fj = (v + dv * d - gv0) / CELL;
      if (fi < 0 || fj < 0 || fi >= size || fj >= size) break;
      if (shade[(fj | 0) * size + (fi | 0)] > d * rise) return 1;
    }
    return 2;
  };
  const year = Number(date.slice(0, 4));
  const days = Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000);
  const sun = new Float32Array(days), daylight = new Float32Array(days);
  for (let d = 0; d < days; d++) {
    // the zone's offset at noon holds for the whole day (a clock change moves an hour at night)
    const offset = zoneOffsetMinutes(timeZone, new Date(Date.UTC(year, 0, 1 + d, 12)));
    const midnight = Date.UTC(year, 0, 1 + d) - offset * 60000;
    for (let slot = 0; slot < SLOTS; slot++) {
      const state = lit(new Date(midnight + slot * STEP_MINUTES * 60000));
      if (state) daylight[d] += STEP_MINUTES;
      if (state === 2) sun[d] += STEP_MINUTES;
    }
  }
  const instants = slotInstants(date, timeZone);
  const today = new Uint8Array(SLOTS);
  for (let slot = 0; slot < SLOTS; slot++) today[slot] = lit(instants[slot]);
  return {kind: 'point', job, x, y, year, sun, daylight, today, ms: [0, performance.now() - t0]};
}
