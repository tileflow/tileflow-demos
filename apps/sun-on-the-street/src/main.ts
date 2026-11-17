import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {createTileflowMap} from '@tileflow/dom';
import tzlookup from '@photostructure/tz-lookup';
import {Popup, type Map as MapLibreMap, type MapMouseEvent} from 'maplibre-gl';
import {localInstant, solarPosition} from './sun';
import {chart, clock12, monthName, withDay, withMonth, type Scope} from './when';
import {SunLayer, type SunLayerColors} from './sun-layer';
import {bindSpot, spotCard, spotLoading, type SpotRank} from './spot';
import {Z, type BuildingsResult, type PointResult, type SidewalksResult, type WorkerRequest} from './worker';

const params = new URLSearchParams(location.search);
const MIN_ZOOM = Number(params.get('minzoom') ?? 13);
const MAX_TILES = Number(params.get('maxtiles') ?? 320);
/** Street trees shade the sidewalks too (`?notrees` leaves only the buildings). */
const TREES = !params.has('notrees');

/** Night, dawn, day and dusk, and the colours the sun layer uses in each. */
const LOOKS: Record<'night' | 'dawn' | 'day' | 'dusk', {theme: string; colors: SunLayerColors; accent: string}> = {
  night: {theme: 'dark', accent: '#8ea2ff', colors: {sun: [1, 0.8, 0.35], shade: [0.42, 0.5, 0.95], shadow: [0, 0, 0, 0]}},
  dawn: {theme: 'dawn', accent: '#ff9a3c', colors: {sun: [1, 0.62, 0.2], shade: [0.36, 0.38, 0.85], shadow: [0.16, 0.1, 0.3, 0.4], light: [1, 0.7, 0.42, 0.16]}},
  day: {theme: 'light', accent: '#f59f00', colors: {sun: [1, 0.72, 0.0], shade: [0.26, 0.39, 0.93], shadow: [0.05, 0.08, 0.25, 0.38], light: [1, 0.8, 0.42, 0.13]}},
  dusk: {theme: 'dusk', accent: '#ff7a59', colors: {sun: [1, 0.55, 0.28], shade: [0.42, 0.42, 0.95], shadow: [0.1, 0.06, 0.22, 0.42], light: [1, 0.62, 0.4, 0.18]}},
};
const BLEND = ['dark', 'dawn', 'light', 'dusk', 'dark'];
const useBlend = params.get('themes') !== 'switch';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $<HTMLParagraphElement>('status');
const bigEl = $('big');
const lineEl = $('line');
const subEl = $('sub');

const today = new Date();
/** The chosen day; the year is fixed and never shown, the sun repeats each year to within a minute. */
let date = params.get('date') ?? `2026-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
let minutesNow = params.has('time') ? toMinutes(params.get('time')!) : 14 * 60;
/** What the map adds up: one moment, a whole day, or a whole month. */
let scope: Scope = params.get('mode') === 'day' ? 'day' : params.get('mode') === 'month' ? 'month' : 'hour';

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

const controller = createTileflowMap($('map'), {
  // the manifest sits beside the page, which may be served under a path (maps.tileflow.dev/<map>/)
  source: {map: 'sun-streets', manifestUrl: `${import.meta.env.BASE_URL}tileflow/manifest.json`},
  ...(useBlend ? {themeBlend: {themes: BLEND, position: 2}} : {theme: 'light' as const, themeTransition: {duration: 900}}),
  navigationControl: true,
  viewMode: params.get('buildings3d') === 'off' ? '2d' : '3d',
  onError: ({code, error}) => console.warn(code, error),
});

// ------------------------------------------------------------------------------------------------
// State

const layer = new SunLayer();
layer.minZoom = MIN_ZOOM - 0.5;
let origin: [number, number] | undefined;
let timeZone = 'UTC';
let center: [number, number] = [0, 0];
let shownLook: keyof typeof LOOKS | '' = '';
let playing = 0;
const walls = new Map<string, Float32Array>();
const sidewalks = new Map<string, SidewalksResult>();
let visible: string[] = [];
const stats: Record<string, {n: number; wait: number; compute: number}> & {lastAt?: number} = {} as never;

const minutes = () => minutesNow;
const sunNow = () => solarPosition(localInstant(date, minutes(), timeZone), center[1], center[0]);

/** What the sidewalks are computed for: a day, or a month as four of its days averaged. */
function computeFor(): {date: string; also: string[]} {
  if (scope !== 'month') return {date, also: []};
  const m = date.slice(0, 8);
  return {date: m + '17', also: [m + '03', m + '10', m + '24']};
}
const forKey = (f: {date: string; also?: string[]} = computeFor()) => [f.date, ...(f.also ?? [])].join();

// ------------------------------------------------------------------------------------------------
// Workers: buildings first (shadows appear at once), then sidewalks, nearest to the centre first

const pool = Array.from({length: Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1))}, () => ({
  worker: new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'}),
  busy: false,
}));
type Job = WorkerRequest & {priority: number};
let queue: Job[] = [];
let jobId = 0;
const inFlight = new Set<string>();

/** A job before it gets its number (Omit over each kind of request, not their union). */
type NewJob = Job extends infer J ? (J extends unknown ? Omit<J, 'job'> : never) : never;
function enqueue(job: NewJob) {
  const key = `${job.kind}|${job.x}/${job.y}`;
  if (inFlight.has(key) || queue.some((q) => q.kind === job.kind && q.x === job.x && q.y === job.y)) return;
  queue.push({...job, job: ++jobId} as Job);
}

function pump() {
  // nearest to the centre first, so the middle of the screen completes before the edges; at the
  // same distance the shadows (buildings) before the sidewalks
  queue.sort((a, b) => a.priority - b.priority || (a.kind === b.kind ? 0 : a.kind === 'buildings' ? -1 : 1));
  for (const slot of pool) {
    if (slot.busy || queue.length === 0) continue;
    const job = queue.shift()!;
    slot.busy = true;
    inFlight.add(`${job.kind}|${job.x}/${job.y}`);
    slot.worker.onmessage = (event) => {
      slot.busy = false;
      inFlight.delete(`${job.kind}|${job.x}/${job.y}`);
      receive(event.data);
      pump();
    };
    const {priority: _p, ...request} = job;
    slot.worker.postMessage(request satisfies WorkerRequest);
  }
  renderStatus();
}

function receive(message: BuildingsResult | SidewalksResult | PointResult | {kind: 'error'; message: string}) {
  if (message.kind === 'error') return console.warn(message.message);
  if (message.job < firstCurrentJob) return; // computed for an origin left behind
  const stat = (stats[message.kind] ??= {n: 0, wait: 0, compute: 0});
  stat.n++;
  (stat as never as Record<string, number>).first ??= Math.round(performance.now());
  (stat as never as Record<string, number>).last = Math.round(performance.now());
  stat.wait += message.ms[0];
  stat.compute += message.ms[1];
  if (message.ms.length > 2) for (let i = 2; i < message.ms.length; i++) (stat as never as Record<string, number>)['m' + i] = ((stat as never as Record<string, number>)['m' + i] ?? 0) + message.ms[i];
  stats.lastAt = performance.now();
  const key = `${message.x}/${message.y}`;
  if (message.kind === 'point') return showSpot(message);
  if (message.kind === 'buildings') {
    walls.set(key, message.walls);
    layer.setWalls(key, message.walls);
  } else if (forKey(message) === forKey()) {
    sidewalks.set(key, message);
    layer.setSidewalks(key, message.segments);
    remeasure();
  }
}

function renderStatus() {
  const pending = queue.length + inFlight.size;
  if (map && map.getZoom() < MIN_ZOOM) statusEl.textContent = 'Zoom in to street level to see the sun on every sidewalk.';
  else if (pending) statusEl.textContent = `Following the sun… ${pending} tiles to go`;
  else statusEl.textContent = '';
}

// ------------------------------------------------------------------------------------------------
// What is in view

let map: MapLibreMap | undefined;

function tilesInView(m: MapLibreMap): {key: string; x: number; y: number; d: number}[] {
  const n = 2 ** Z;
  const {clientWidth: w, clientHeight: h} = m.getContainer();
  // at a steep pitch the top of the screen reaches the horizon; stop at 80 % of the height
  const top = m.getPitch() > 50 ? h * 0.25 : 0;
  const pts = [
    [0, top],
    [w, top],
    [w, h],
    [0, h],
  ].map(([x, y]) => m.unproject([x, y]));
  const tx = (lon: number) => ((lon + 180) / 360) * n;
  const ty = (lat: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const c = m.getCenter();
  const cx = tx(c.lng), cy = ty(c.lat);
  const out: {key: string; x: number; y: number; d: number}[] = [];
  for (let x = Math.floor(Math.min(...pts.map((p) => tx(p.lng)))); x <= Math.floor(Math.max(...pts.map((p) => tx(p.lng)))); x++)
    for (let y = Math.floor(Math.min(...pts.map((p) => ty(p.lat)))); y <= Math.floor(Math.max(...pts.map((p) => ty(p.lat)))); y++)
      out.push({key: `${x}/${y}`, x, y, d: Math.hypot(x + 0.5 - cx, y + 0.5 - cy)});
  return out.sort((a, b) => a.d - b.d).slice(0, MAX_TILES);
}

/**
 * Zoomed out, the map's own ground, greenery, water and buildings step back towards the ground colour
 * so the sidewalks, the subject of the map, read first; at street level the map is as designed.
 */
let receded: boolean | undefined;
function emphasise(m: MapLibreMap) {
  const want = m.getZoom() < 15;
  if (want === receded) return;
  receded = want;
  void controller
    .getThemeController()
    ?.setEmphasis(want ? {recede: {land: 0.5, vegetation: 0.55, water: 0.35, buildings: 0.45, roads: 0.2}, labels: 0.7} : undefined, {transition: {duration: 600}});
}

/** Drops everything computed around the old origin; results still on their way are ignored. */
let firstCurrentJob = 0;
function restart() {
  queue = [];
  firstCurrentJob = jobId + 1;
  for (const key of [...walls.keys(), ...sidewalks.keys()]) layer.removeTile(key);
  walls.clear();
  sidewalks.clear();
  origin = undefined;
}

function follow(m: MapLibreMap) {
  const c = m.getCenter();
  center = [c.lng, c.lat];
  timeZone = tzlookup(c.lat, c.lng);
  chartView.update(view());
  if (m.getZoom() < MIN_ZOOM) {
    visible = [];
    renderStatus();
    remeasure();
    return;
  }
  // far from where the session started (another city), start afresh around here: positions stay
  // small and exact in 32-bit floats, and nothing from the old place is kept or drawn
  if (origin && Math.hypot(c.lng - origin[0], (c.lat - origin[1]) * 1.3) > 1) restart();
  origin ??= [c.lng, c.lat];
  layer.origin = origin;
  const tiles = tilesInView(m);
  visible = tiles.map((t) => t.key);
  const want = new Set<string>();
  for (const t of tiles)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${t.x + dx}/${t.y + dy}`;
        if (want.has(key)) continue;
        want.add(key);
        if (!walls.has(key)) enqueue({kind: 'buildings', x: t.x + dx, y: t.y + dy, origin, priority: t.d});
      }
  for (const t of tiles)
    if (!sidewalks.has(t.key))
      enqueue({kind: 'sidewalks', x: t.x, y: t.y, origin, ...computeFor(), timeZone, gpu: !params.has('cpu'), trees: TREES, priority: t.d});
  // forget what is far away, and work no longer needed; draw only what is wanted
  queue = queue.filter((q) => want.has(`${q.x}/${q.y}`));
  if (walls.size > want.size + 80)
    for (const key of [...walls.keys()])
      if (!want.has(key)) {
        walls.delete(key);
        sidewalks.delete(key);
        layer.removeTile(key);
      }
  layer.setDrawn(want);
  pump();
  remeasure();
}

// ------------------------------------------------------------------------------------------------
// Time

function lookAt(): keyof typeof LOOKS {
  const alt = sunNow().altitude;
  const morning = minutes() < 12 * 60 + 30;
  if (alt < -4) return 'night';
  if (alt < 10) return morning ? 'dawn' : 'dusk';
  return 'day';
}

/** Position in the dark → dawn → light → dusk → dark blend, from the sun's height. */
function blendPosition(alt = sunNow().altitude, t = minutes()): number {
  // Half-mixed dark and dawn reads as olive, so the night ↔ dawn/dusk step is kept short (civil
  // twilight) and the pure dawn or dusk theme holds while the sun is near the horizon.
  const ramp = alt <= -7 ? 0 : alt < -4 ? (alt + 7) / 3 : alt < 4 ? 1 : alt < 14 ? 1 + (alt - 4) / 10 : 2;
  return t < 12 * 60 + 30 ? ramp : 4 - ramp;
}

/** The map's own ground in each theme of the blend (at street level), which the paper behind the text takes. */
const GROUND: Record<string, [number, number, number]> = {dark: [47, 47, 49], dawn: [247, 236, 214], light: [245, 240, 229], dusk: [69, 66, 64]};
let shownInk = '';
/** The paper follows the map's ground through the day, and the ink turns light when it darkens. */
function setPaper(position = blendPosition()) {
  const at = Math.max(0, Math.min(BLEND.length - 1, position));
  const i = Math.min(BLEND.length - 2, Math.floor(at)), f = at - i;
  const a = GROUND[BLEND[i]], b = GROUND[BLEND[i + 1]];
  const rgb = useBlend ? a.map((c, n) => Math.round(c + (b[n] - c) * f)) : GROUND[LOOKS[lookAt()].theme];
  const root = document.documentElement;
  root.style.setProperty('--paper', rgb.join(' '));
  const ink = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.5 ? 'light' : 'dark';
  if (ink !== shownInk) {
    shownInk = ink;
    root.dataset.ink = ink;
    paintSpot();
  }
}

/**
 * Turns the light on the 3D building faces to the real sun. Under the horizon the placed sun lights
 * the scene from below and tints the dark theme green, so at night the theme's own light returns and
 * near the horizon the light never drops under 8°.
 */
let sunPlaced = false;
function lightBuildings(sun: {azimuth: number; altitude: number}) {
  const themes = controller.getThemeController();
  if (!themes) return;
  if (sun.altitude < -4) {
    if (sunPlaced) void themes.setSun(undefined, {transition: {duration: 800}});
    sunPlaced = false;
    return;
  }
  void themes.setSun({azimuth: sun.azimuth, altitude: Math.max(8, sun.altitude)}, {transition: {duration: sunPlaced ? 0 : 800}});
  sunPlaced = true;
}

function applyTime() {
  if (!map) return;
  const sun = sunNow();
  layer.setSun(sun.azimuth, sun.altitude);
  lightBuildings(sun);
  const look = lookAt();
  if (useBlend) controller.setThemeBlend({themes: BLEND, position: blendPosition()});
  setPaper();
  if (look !== shownLook) {
    shownLook = look;
    layer.setColors(LOOKS[look].colors);
    document.documentElement.style.setProperty('--accent', LOOKS[look].accent);
    document.documentElement.dataset.look = look;
    if (!useBlend) controller.setTheme(LOOKS[look].theme as never);
  }
  renderShare();
  chartView.update(view());
}

const chartView = chart(document.getElementById('chart')!, {
  scope: (s) => setScope(s),
  minutes: (m) => {
    minutesNow = m;
    applyTime();
  },
  date: (d) => setDate(d),
  play: () => togglePlay(),
});
const view = () => ({scope, date, minutes: minutes(), lat: center[1], lon: center[0], timeZone, sun: sunNow(), bearing: map?.getBearing() ?? 0});

// ------------------------------------------------------------------------------------------------
// The share: sidewalk length inside the visible screen, not whole tiles

const EARTH = 40075016.68557849;
/** Per five-minute slot, metres of sidewalk in view in the sun; and the totals. */
const share = {lit: new Float64Array(289), total: 0, underThirty: 0, dirty: true};

/** The visible screen as a quadrilateral in the layer's Mercator metres (u east, v south). */
function viewQuad(m: MapLibreMap): [number, number][] {
  const {clientWidth: w, clientHeight: h} = m.getContainer();
  const top = m.getPitch() > 50 ? h * 0.25 : 0;
  const ox = (origin![0] + 180) / 360;
  const oy = (1 - Math.asinh(Math.tan((origin![1] * Math.PI) / 180)) / Math.PI) / 2;
  return [
    [0, top],
    [w, top],
    [w, h],
    [0, h],
  ].map(([x, y]) => {
    const p = m.unproject([x, y]);
    return [((p.lng + 180) / 360 - ox) * EARTH, ((1 - Math.asinh(Math.tan((p.lat * Math.PI) / 180)) / Math.PI) / 2 - oy) * EARTH];
  });
}

function measureShare() {
  share.dirty = false;
  share.lit.fill(0);
  share.total = 0;
  share.underThirty = 0;
  if (!map || !origin || map.getZoom() < MIN_ZOOM) return;
  const q = viewQuad(map);
  // inside a convex quadrilateral: on the same side of all four edges
  const edges = q.map(([ax, ay], i) => {
    const [bx, by] = q[(i + 1) % 4];
    return [ax, ay, bx - ax, by - ay];
  });
  const sign = Math.sign(edges[0][2] * edges[1][3] - edges[0][3] * edges[1][2]);
  const diff = share.lit; // a difference array, summed below
  for (const key of visible) {
    const s = sidewalks.get(key);
    if (!s) continue;
    const {pieces, runs} = s;
    let o = 0;
    for (let i = 0; i < pieces.length; i += 4) {
      const u = pieces[i], v = pieces[i + 1], len = pieces[i + 2], minutes = pieces[i + 3];
      const count = runs[o++];
      let inside = true;
      for (const [ax, ay, dx, dy] of edges)
        if (Math.sign(dx * (v - ay) - dy * (u - ax)) === -sign) {
          inside = false;
          break;
        }
      if (!inside) {
        o += count * 2;
        continue;
      }
      share.total += len;
      if (minutes < 30) share.underThirty += len;
      for (let r = 0; r < count; r++) {
        diff[runs[o++]] += len;
        diff[runs[o++]] -= len;
      }
    }
  }
  for (let slot = 1; slot < 289; slot++) diff[slot] += diff[slot - 1];
}

let shareFrame = 0;
/** Measures again at the next frame (many tiles can arrive in one). */
function remeasure() {
  share.dirty = true;
  if (shareFrame) return;
  shareFrame = requestAnimationFrame(() => {
    shareFrame = 0;
    renderShare();
  });
}

const RAMP_LABELS = '<div class="ramp"></div><div class="ramp-labels" style="position:relative;display:block;height:14px">' +
  [['No sun', 0], ['30 min', 50], ['1 h', 66.7], ['2 h', 83.3], ['4 h+', 100]]
    .map(([t, at]) => `<span style="position:absolute;left:${at}%;transform:translateX(-${at}%)">${t}</span>`)
    .join('') + '</div>';

/**
 * The page shows the loader until the map has drawn and the first sidewalks are in (or, zoomed out,
 * as soon as the map has drawn); a slow network never holds it longer than a few seconds.
 */
let mapDrawn = false;
function reveal(force = false) {
  const root = document.documentElement;
  if (!root.classList.contains('loading')) return;
  if (force || (mapDrawn && (share.total > 0 || (map && map.getZoom() < MIN_ZOOM)))) root.classList.remove('loading');
}
setTimeout(() => reveal(true), 12000);

/** The headline: what share of the sidewalks in view is in the sun, or gets almost none. */
function renderShare() {
  if (share.dirty) measureShare();
  reveal();
  const say = (big: string, line: string, sub = '') => {
    bigEl.textContent = big;
    lineEl.innerHTML = line;
    subEl.innerHTML = sub;
  };
  if (!share.total)
    return say('—', map && map.getZoom() < MIN_ZOOM ? 'Zoom in to street level to see the sun on every sidewalk.' : 'Following the sun…');
  const pct = (n: number) => `${Math.round((100 * n) / share.total)}%`;
  if (scope !== 'hour') {
    const when = scope === 'day' ? `on ${Number(date.slice(8, 10))} ${monthName(date)}` : `in ${monthName(date)}`;
    return say(pct(share.underThirty), `of these sidewalks get <mark class="none">almost no sun</mark> ${when}.`, RAMP_LABELS);
  }
  if (sunNow().altitude <= 0.5) return say('0%', `of these sidewalks are <mark>in the sun</mark> at ${clock12(minutes())}.`, 'The sun is down.');
  const slot = Math.round(minutes() / 5) % 288;
  say(pct(share.lit[slot]), `of these sidewalks are <mark>in the sun</mark> at ${clock12(minutes())}.`, 'The rest, <span class="shade">in shade</span>.');
}

// ------------------------------------------------------------------------------------------------
// A sidewalk's year: click any sidewalk

let popup: Popup | undefined;
let spot: {job: number; date: string; rank: SpotRank} | undefined;

function lngLatOf(u: number, v: number): [number, number] {
  const mx = u / EARTH + (origin![0] + 180) / 360;
  const my = v / EARTH + (1 - Math.asinh(Math.tan((origin![1] * Math.PI) / 180)) / Math.PI) / 2;
  return [mx * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI];
}

type Hit = {key: string; piece: number; u: number; v: number; d: number};

/** The sidewalk piece within a dozen pixels of a point on the map, if any. */
function nearestPiece(m: MapLibreMap, lng: number, lat: number): Hit | undefined {
  if (!origin || m.getZoom() < MIN_ZOOM) return undefined;
  const ox = (origin[0] + 180) / 360;
  const oy = (1 - Math.asinh(Math.tan((origin[1] * Math.PI) / 180)) / Math.PI) / 2;
  const cu = ((lng + 180) / 360 - ox) * EARTH;
  const cv = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2 - oy) * EARTH;
  const reach = (EARTH / (512 * 2 ** m.getZoom())) * 12;
  let best: Hit | undefined;
  for (const key of visible) {
    const pieces = sidewalks.get(key)?.pieces;
    if (!pieces) continue;
    for (let i = 0; i < pieces.length; i += 4) {
      const du = pieces[i] - cu, dv = pieces[i + 1] - cv;
      if (Math.abs(du) > reach || Math.abs(dv) > reach) continue;
      const d = Math.hypot(du, dv);
      if (d < reach && (!best || d < best.d)) best = {key, piece: i / 4, u: pieces[i], v: pieces[i + 1], d};
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------
// The sidewalk under the pointer, and the one chosen: outlined on the map

const SPOT = 'sun-spot';
let hovered: Hit | undefined;
let chosen: Hit | undefined;

/** A short stretch of the sidewalk around a piece, following its joined neighbours, as longitudes and latitudes. */
function stretch(hit: Hit, m: MapLibreMap): [number, number][] {
  const seg = sidewalks.get(hit.key)?.segments;
  if (!seg) return [];
  const S = 42; // six vertices of seven floats per piece
  const count = seg.length / S;
  const reach = Math.max(9, (EARTH / (512 * 2 ** m.getZoom())) * 22);
  const a = (p: number) => [seg[p * S], seg[p * S + 1]] as [number, number];
  const b = (p: number) => [seg[p * S + 2], seg[p * S + 3]] as [number, number];
  const joined = (p: number, q: number) => b(p)[0] === a(q)[0] && b(p)[1] === a(q)[1];
  const half = (p: number) => Math.hypot(b(p)[0] - a(p)[0], b(p)[1] - a(p)[1]) / 2;
  let first = hit.piece, last = hit.piece;
  for (let run = half(first); first > 0 && joined(first - 1, first) && run < reach; first--) run += half(first - 1) * 2;
  for (let run = half(last); last < count - 1 && joined(last, last + 1) && run < reach; last++) run += half(last + 1) * 2;
  const line = [a(first)];
  for (let p = first; p <= last; p++) line.push(b(p));
  return line.map(([u, v]) => lngLatOf(u, v));
}

function drawSpot() {
  const m = map;
  const source = m?.getSource(SPOT) as {setData(d: unknown): void} | undefined;
  if (!m || !source) return;
  const features = (
    [
      [hovered && (!chosen || hovered.key !== chosen.key || hovered.piece !== chosen.piece) ? hovered : undefined, 'hover'],
      [chosen, 'chosen'],
    ] as const
  ).flatMap(([hit, kind]) => {
    if (!hit || !sidewalks.has(hit.key)) return [];
    const line = stretch(hit, m);
    const out: unknown[] = line.length > 1 ? [{type: 'Feature', properties: {kind}, geometry: {type: 'LineString', coordinates: line}}] : [];
    if (kind === 'chosen') out.push({type: 'Feature', properties: {kind: 'dot'}, geometry: {type: 'Point', coordinates: lngLatOf(hit.u, hit.v)}});
    return out;
  });
  source.setData({type: 'FeatureCollection', features});
}

/** Ink and paper for the outlines, which follow the page's. */
function paintSpot() {
  const m = map;
  if (!m?.getLayer(`${SPOT}-line`)) return;
  const dark = shownInk !== 'light';
  const ink = dark ? '#171717' : '#f4f4f6', paper = dark ? '#ffffff' : '#14151a';
  m.setPaintProperty(`${SPOT}-halo`, 'line-color', paper);
  m.setPaintProperty(`${SPOT}-line`, 'line-color', ink);
  m.setPaintProperty(`${SPOT}-dot`, 'circle-color', ink);
  m.setPaintProperty(`${SPOT}-dot`, 'circle-stroke-color', paper);
}

/** The outlines sit with the sidewalks, under the 3D buildings, which hide those behind them. */
function placeSpot(m: MapLibreMap) {
  const under = m.getLayer('tileflow-buildings-scene-3d') ? 'tileflow-buildings-scene-3d' : undefined;
  if (!m.getSource(SPOT)) m.addSource(SPOT, {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
  // an outline around the sidewalk, leaving its own colour visible inside
  const gap = ['interpolate', ['exponential', 2], ['zoom'], 13, 5, 16, 7, 18, 16] as never;
  const isLine = ['==', ['geometry-type'], 'LineString'] as never;
  const chosenOnly = (on: unknown, off: unknown) => ['case', ['==', ['get', 'kind'], 'chosen'], on, off] as never;
  const layers = [
    {id: `${SPOT}-halo`, type: 'line', source: SPOT, filter: isLine, layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': '#fff', 'line-gap-width': gap, 'line-width': chosenOnly(6, 4), 'line-opacity': chosenOnly(0.85, 0.5), 'line-blur': 1}},
    {id: `${SPOT}-line`, type: 'line', source: SPOT, filter: isLine, layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': '#171717', 'line-gap-width': gap, 'line-width': chosenOnly(2.5, 1.5), 'line-opacity': chosenOnly(1, 0.6)}},
    {id: `${SPOT}-dot`, type: 'circle', source: SPOT, filter: ['==', ['geometry-type'], 'Point'] as never, paint: {'circle-radius': 4.5, 'circle-color': '#171717', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'map'}},
  ] as const;
  let added = false;
  for (const layer of layers)
    if (!m.getLayer(layer.id)) {
      m.addLayer(layer as never, under);
      added = true;
    }
  if (added) {
    shownInk && paintSpot();
    drawSpot();
  }
}

/** The pointer turns to a hand over any sidewalk, which is outlined; checked at most once a frame. */
function hoverSpots(m: MapLibreMap) {
  let pending: {lng: number; lat: number} | undefined;
  let frame = 0;
  const check = () => {
    frame = 0;
    const hit = pending && !m.isMoving() ? nearestPiece(m, pending.lng, pending.lat) : undefined;
    m.getCanvas().style.cursor = hit ? 'pointer' : '';
    if (hit?.key === hovered?.key && hit?.piece === hovered?.piece) return;
    hovered = hit;
    drawSpot();
  };
  m.on('mousemove', (e) => {
    pending = e.lngLat;
    frame ||= requestAnimationFrame(check);
  });
  m.getCanvas().addEventListener('mouseleave', () => {
    pending = undefined;
    frame ||= requestAnimationFrame(check);
  });
}

function clickSpot(m: MapLibreMap, e: MapMouseEvent) {
  const best = nearestPiece(m, e.lngLat.lng, e.lngLat.lat);
  if (!best || !origin) {
    popup?.remove();
    return;
  }
  chosen = best;
  drawSpot();
  // how this spot's day compares with every sidewalk in view, by length
  const own = minutesAt(best.key, best.u, best.v);
  let below = 0, sunless = 0, total = 0;
  for (const key of visible) {
    const pieces = sidewalks.get(key)?.pieces;
    if (!pieces) continue;
    for (let i = 0; i < pieces.length; i += 4) {
      total += pieces[i + 2];
      if (pieces[i + 3] < own) below += pieces[i + 2];
      if (pieces[i + 3] === 0) sunless += pieces[i + 2];
    }
  }
  const [x, y] = best.key.split('/').map(Number);
  const job = ++jobId;
  spot = {job, date: date, rank: !total ? undefined : own > 0 ? {sunnierThan: Math.floor((100 * below) / total)} : {sunless: Math.round((100 * sunless) / total)}};
  if (!popup) {
    popup = new Popup({maxWidth: '340px', className: 'spot-popup', focusAfterOpen: false, offset: 22});
    popup.on('close', () => {
      chosen = undefined;
      drawSpot();
    });
  }
  popup.setLngLat(lngLatOf(best.u, best.v)).setHTML(spotLoading()).addTo(m);
  queue.push({kind: 'point', job, x, y, origin, u: best.u, v: best.v, date: date, timeZone, trees: TREES, priority: -1});
  pump();
}

function minutesAt(key: string, u: number, v: number) {
  const pieces = sidewalks.get(key)!.pieces;
  for (let i = 0; i < pieces.length; i += 4) if (pieces[i] === u && pieces[i + 1] === v) return pieces[i + 3];
  return 0;
}

function showSpot(r: PointResult) {
  if (!popup || !spot || r.job !== spot.job) return;
  popup.setHTML(spotCard(r, {date: spot.date, now: minutes(), rank: spot.rank}));
  const root = popup.getElement();
  if (root) bindSpot(root);
}

// Start on the sidewalks while the map is still loading: the first view is already known
function warmStart() {
  const v = params.get('view')?.split(',').map(Number);
  const [lng, lat, zoom] = v && v.length >= 3 ? v : [-74.0065, 40.7072, 13.7];
  if (zoom < MIN_ZOOM) return;
  center = [lng, lat];
  timeZone = tzlookup(lat, lng);
  origin = [lng, lat];
  const n = 2 ** Z;
  const cx = ((lng + 180) / 360) * n;
  const cy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const reach = Math.hypot(innerWidth, innerHeight) / 2 / (512 * 2 ** (zoom - Z)) + 0.5;
  const near: {x: number; y: number; d: number}[] = [];
  for (let x = Math.floor(cx - reach); x <= Math.floor(cx + reach); x++)
    for (let y = Math.floor(cy - reach); y <= Math.floor(cy + reach); y++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= reach + 0.71) near.push({x, y, d});
    }
  near.sort((a, b) => a.d - b.d);
  for (const t of near.slice(0, MAX_TILES)) {
    enqueue({kind: 'buildings', x: t.x, y: t.y, origin, priority: t.d});
    enqueue({kind: 'sidewalks', x: t.x, y: t.y, origin, ...computeFor(), timeZone, gpu: !params.has('cpu'), trees: TREES, priority: t.d});
  }
  pump();
}
warmStart();

controller.ready.then((m) => {
  if (!m) return;
  map = m;
  (stats as never as Record<string, number>).readyAt = Math.round(performance.now());
  if (params.has('debug')) Object.assign(window, {sunMap: m, sunLayer: layer, sunController: controller, sunStats: stats, sunSidewalks: sidewalks, sunLngLat: lngLatOf});
  const v = params.get('view')?.split(',').map(Number);
  if (v && v.length >= 3) m.jumpTo({center: [v[0], v[1]], zoom: v[2], pitch: v[3] ?? 0, bearing: v[4] ?? m.getBearing()});
  const c = m.getCenter();
  center = [c.lng, c.lat];
  timeZone = tzlookup(c.lat, c.lng);

  // the layer sits right under the map's 3D buildings, which then cover roofs and walls
  const place = () => {
    if (!m.getLayer(layer.id)) {
      m.addLayer(layer, m.getLayer('tileflow-buildings-scene-3d') ? 'tileflow-buildings-scene-3d' : undefined);
      for (const [key, data] of walls) layer.setWalls(key, data);
      for (const [key, data] of sidewalks) layer.setSidewalks(key, data.segments);
      // the 3D buildings draw again only after the camera moves once a layer is added
      m.once('idle', () => m.jumpTo({bearing: m.getBearing() + 0.001}));
    }
    // the faint copy over the buildings: added once, under the first labels above the 3D scene
    if (!params.has('nothrough') && !m.getLayer(layer.through.id) && m.getLayer('tileflow-buildings-scene-3d')) {
      const order = (m as unknown as {style: {_order: string[]}}).style._order;
      const after = order.slice(order.indexOf('tileflow-buildings-scene-3d') + 1);
      m.addLayer(layer.through, after.find((id) => m.getLayer(id)?.type === 'symbol'));
    }
    if (m.getLayer(layer.id) && m.getLayer('tileflow-buildings-scene-3d')) {
      // below the 3D scene is enough: other layers (the SDK's sky haze) also sit right under it,
      // and insisting on the exact slot makes the two move each other on every style change
      const order = (m as unknown as {style: {_order: string[]}}).style._order;
      if (order.indexOf(layer.id) > order.indexOf('tileflow-buildings-scene-3d')) m.moveLayer(layer.id, 'tileflow-buildings-scene-3d');
    }
  };
  place();
  m.on('styledata', place);
  placeSpot(m);
  m.on('styledata', () => placeSpot(m));
  hoverSpots(m);
  m.addControl(viewControl(m), 'top-right');

  applyTime();
  m.on('click', (e) => clickSpot(m, e));
  follow(m);
  emphasise(m);
  // The SDK eases the field of view between zoom 13 and 15, and each change ends a "move": during
  // a flight moveend fires every frame. Work starts once the camera has really stopped.
  let settle = 0;
  m.on('moveend', () => {
    clearTimeout(settle);
    settle = window.setTimeout(() => {
      if (m.isMoving()) return;
      follow(m);
      emphasise(m);
    }, 120);
  });
  // keep up while the map is being dragged, so new streets fill in under the finger, not after
  let lastFollow = 0;
  m.on('move', () => {
    // only a drag fills in as it goes; a flight passes over places nobody stops at: wait for moveend
    if (!m.dragPan.isActive()) return;
    const now = performance.now();
    if (now - lastFollow < 250) return;
    lastFollow = now;
    follow(m);
  });

  layer.setMode(scope === 'hour' ? 'now' : 'day');
  m.on('rotate', () => chartView.update(view()));
  m.once('idle', () => {
    mapDrawn = true;
    reveal();
  });
});

// ------------------------------------------------------------------------------------------------
// 2D or 3D, as in the gallery: the buildings stand up or lie flat, and the camera tilts with them

let threeD = params.get('buildings3d') !== 'off';
function viewControl(m: MapLibreMap) {
  const box = document.createElement('div');
  box.className = 'maplibregl-ctrl maplibregl-ctrl-group view-control';
  const button = document.createElement('button');
  button.type = 'button';
  let tilt = m.getPitch() > 0 ? m.getPitch() : 50;
  const show = () => {
    button.textContent = threeD ? '2D' : '3D';
    button.title = button.ariaLabel = threeD ? 'Switch to 2D' : 'Switch to 3D';
  };
  button.addEventListener('click', () => {
    if (threeD && m.getPitch() > 0) tilt = m.getPitch();
    threeD = !threeD;
    controller.update({viewMode: threeD ? '3d' : '2d'});
    m.easeTo({pitch: threeD ? Math.min(tilt, m.getMaxPitch()) : 0, duration: 500});
    const url = new URL(location.href);
    url.searchParams.set('buildings3d', threeD ? 'on' : 'off');
    history.replaceState(history.state, '', url);
    show();
  });
  show();
  box.append(button);
  return {onAdd: () => box, onRemove: () => box.remove()};
}

// ------------------------------------------------------------------------------------------------
// Choosing the moment

/** Sidewalks computed for another day (or month) are dropped and computed again. */
function recompute() {
  sidewalks.clear();
  hovered = undefined;
  drawSpot();
  layer.clearSidewalks();
  queue = queue.filter((q) => q.kind === 'buildings');
  if (map) follow(map);
}

function setDate(d: string) {
  if (d === date) return;
  const before = forKey();
  date = d;
  if (forKey() !== before) recompute();
  applyTime();
}

function setScope(s: Scope) {
  if (s === scope) return;
  stopPlay();
  const before = forKey();
  scope = s;
  layer.setMode(s === 'hour' ? 'now' : 'day');
  if (forKey() !== before) recompute();
  remeasure();
  applyTime();
}

const playButton = document.getElementById('play')!;
let stepping = 0;
function stopPlay() {
  if (playing) cancelAnimationFrame(playing);
  if (stepping) clearInterval(stepping);
  playing = stepping = 0;
  playButton.classList.remove('on');
  playButton.setAttribute('aria-label', 'Play');
}

/** At the hour, the day runs in about twenty seconds; by day or month, it steps once each is computed. */
function togglePlay() {
  if (playing || stepping) return stopPlay();
  playButton.classList.add('on');
  playButton.setAttribute('aria-label', 'Pause');
  if (scope !== 'hour') {
    let last = performance.now();
    stepping = window.setInterval(() => {
      if (queue.length + inFlight.size > 0 || performance.now() - last < 1400) return;
      last = performance.now();
      const day = Number(date.slice(8, 10));
      if (scope === 'day') setDate(withDay(date, day >= Number(new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).getUTCDate()) ? 1 : day + 1));
      else setDate(withMonth(date, Number(date.slice(5, 7)) % 12));
    }, 200);
    return;
  }
  let rise = 0, set = 1440;
  for (let t = 0; t < 1440; t += 5) {
    const alt = solarPosition(localInstant(date, t, timeZone), center[1], center[0]).altitude;
    if (alt > 0.5 && !rise) rise = t;
    if (alt > 0.5) set = t;
  }
  const start = Math.max(0, rise - 60), end = Math.min(1435, set + 60);
  let t = minutes() >= start && minutes() < end ? minutes() : start;
  let last = performance.now();
  const tick = (now: number) => {
    t += ((now - last) / 1000) * ((end - start) / 20);
    last = now;
    if (t >= end) return stopPlay();
    minutesNow = Math.round(t / 5) * 5;
    const sun = solarPosition(localInstant(date, t, timeZone), center[1], center[0]);
    layer.setSun(sun.azimuth, sun.altitude);
    lightBuildings(sun);
    if (useBlend) controller.setThemeBlend({themes: BLEND, position: blendPosition(sun.altitude, t)});
    setPaper(blendPosition(sun.altitude, t));
    if (lookAt() !== shownLook) applyTime();
    renderShare();
    chartView.update(view());
    playing = requestAnimationFrame(tick);
  };
  playing = requestAnimationFrame(tick);
}
