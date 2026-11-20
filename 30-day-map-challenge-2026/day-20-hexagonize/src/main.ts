import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {createTileflowMap} from '@tileflow/dom';
import type {Map as MapLibreMap} from 'maplibre-gl';
import {idealLevel, mercator} from './grid';
import {css, GAINED, landColor, LOST, seaColor} from './colors';
import {HexLayer} from './hex-layer';
import type {CellInfo, Mode, SceneReply, SceneRequest, Stats, View} from './scene-worker';

const params = new URLSearchParams(location.search);
/** Milestones of the opening, for profiling (`window.hexTimes`, milliseconds since navigation). */
const times: Record<string, number> = {};
const mark = (name: string) => (times[name] ??= Math.round(performance.now()));
Object.assign(window, {hexTimes: times});
/** Distance between cell centres at the middle of the screen, in CSS pixels. */
const CELL_PX = Number(params.get('cell') ?? 6);
/** How far (in levels, three per halving) the zoom may drift before the grid changes level. */
const HYSTERESIS = 0.6;
/** Cells are prepared this far beyond each side of the screen (fraction of its size). */
const MARGIN = 0.15;
const MAX_CELLS = Number(params.get('max') ?? 300000);
const AUTO = params.get('auto') !== '0';
const mode: Mode = 'elevation';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status');
const setStatus = (t: string) => (statusEl.textContent = t);

// ------------------------------------------------------------------------------------------------
// The scene is built off the main thread; this thread only hands its arrays to the GPU

const sceneWorker = new Worker(new URL('./scene-worker.ts', import.meta.url), {type: 'module'});
let requestId = 0;
const replies = new Map<number, (r: SceneReply) => void>();
sceneWorker.onmessage = (e: MessageEvent<SceneReply>) => {
  const done = replies.get(e.data.id);
  replies.delete(e.data.id);
  done?.(e.data);
};
type Ask =
  | {type: 'scene'; view: View; mode: Mode}
  | {type: 'colors'; mode: Mode}
  | {type: 'stats'; level: number}
  | {type: 'cell'; scene: number; index: number};
function askScene(req: Ask) {
  const id = ++requestId;
  return new Promise<SceneReply>((resolve) => {
    replies.set(id, resolve);
    sceneWorker.postMessage({...req, id} as SceneRequest);
  });
}

/** The ground the camera sees, as a Mercator polygon, grown by a margin so a pan finds cells ready. */
function viewPolygon(m: MapLibreMap, margin: number): Array<[number, number]> {
  const {clientWidth: w, clientHeight: h} = m.getContainer();
  // above the horizon unproject() runs away: steep views keep a smaller margin at the top edge
  const top = -h * Math.min(margin, m.getPitch() > 58 ? 0.03 : 0.1);
  return [
    [-w * margin, top],
    [w * (1 + margin), top],
    [w * (1 + margin), h * (1 + margin)],
    [-w * margin, h * (1 + margin)],
  ].map(([x, y]) => {
    const ll = m.unproject([x, y]);
    return mercator(ll.lng, Math.max(-85, Math.min(85, ll.lat)));
  });
}

/** The opening camera, as in tileflow.config.ts (`?view=lng,lat,zoom,pitch,bearing` overrides it). */
const OPENING = (() => {
  const v = params.get('view')?.split(',').map(Number);
  return {center: [v?.[0] ?? -16.62, v?.[1] ?? 28.27] as [number, number], zoom: v?.[2] ?? 8.1, pitch: v?.[3] ?? 52, bearing: v?.[4] ?? -18};
})();

/**
 * The view of a camera that does not exist yet: a pinhole camera like MapLibre's (36.87° vertical
 * field of view), so the opening cells are sampled while the map is still loading.
 */
function plannedView(w: number, h: number): View {
  const {center, zoom, pitch, bearing} = OPENING;
  const [cu, cv] = mercator(...center);
  const p = (pitch * Math.PI) / 180;
  const b = (bearing * Math.PI) / 180;
  const D = (0.5 * h) / Math.tan((36.87 * Math.PI) / 360);
  const unit = 1 / (512 * 2 ** zoom);
  const F = [Math.sin(b), -Math.cos(b)];
  const R = [Math.cos(b), Math.sin(b)];
  const ground = (x: number, y: number): [number, number] => {
    const down = D * Math.cos(p) + y * Math.sin(p);
    const t = (D * Math.cos(p)) / Math.max(down, D * 0.05);
    const along = -D * Math.sin(p) + t * (D * Math.sin(p) - y * Math.cos(p));
    const side = t * x;
    return [cu + (F[0] * along + R[0] * side) * unit, cv + (F[1] * along + R[1] * side) * unit];
  };
  const rect = (margin: number) => {
    const top = -h * Math.min(margin, 0.1);
    return [
      ground(-w * (0.5 + margin), top - h / 2),
      ground(w * (0.5 + margin), top - h / 2),
      ground(w * (0.5 + margin), h * (0.5 + margin)),
      ground(-w * (0.5 + margin), h * (0.5 + margin)),
    ];
  };
  return {poly: rect(MARGIN), visible: rect(0), center: [cu, cv], zoom, bearing, cellPx: CELL_PX, maxCells: MAX_CELLS, level: Math.round(idealLevel(zoom, CELL_PX)), heading: 1};
}

/** The level to show at this zoom: the one shown stays while the zoom is near it. */
function wantedLevel(zoom: number) {
  const ideal = idealLevel(zoom, CELL_PX);
  return shown && Math.abs(ideal - shown.wanted) < HYSTERESIS ? shown.wanted : Math.round(ideal);
}

function viewOf(m: MapLibreMap): View {
  const c = m.getCenter();
  return {
    poly: viewPolygon(m, MARGIN),
    visible: viewPolygon(m, 0),
    center: mercator(c.lng, c.lat),
    zoom: m.getZoom(),
    bearing: m.getBearing(),
    cellPx: CELL_PX,
    maxCells: MAX_CELLS,
    level: wantedLevel(m.getZoom()),
    heading,
  };
}

function inside(poly: Array<[number, number]>, [u, v]: [number, number]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, vi] = poly[i];
    const [uj, vj] = poly[j];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) hit = !hit;
  }
  return hit;
}

/**
 * Whether the scene on screen still serves this camera: same level, the screen inside the ground it
 * covers, and its cells sorted for roughly this heading. Otherwise the worker builds a new one.
 */
function stale(m: MapLibreMap) {
  if (!shown) return true;
  if (wantedLevel(m.getZoom()) !== shown.wanted) return true;
  const turn = Math.abs(((m.getBearing() - shown.bearing + 540) % 360) - 180);
  if (turn > 40) return true;
  return !viewPolygon(m, 0.02).every((p) => inside(shown!.poly, p));
}

// ------------------------------------------------------------------------------------------------
// Map

const controller = createTileflowMap($('map'), {
  // the manifest of the managed Map (`tileflow deploy`): Terrain and Bathymetry need its Map ID
  source: {map: 'hexagonize', manifestUrl: `${import.meta.env.BASE_URL}map/manifest.json`},
  theme: 'light',
  navigationControl: true,
  viewMode: '3d',
  onError: ({code, error}) => console.warn(code, error),
});

// sampling starts with the page, in parallel with the map's own loading
const prefetch = AUTO
  ? askScene({type: 'scene', view: plannedView(window.innerWidth, window.innerHeight), mode}).then(() => mark('sampled'))
  : Promise.resolve();

const layer = new HexLayer();
if (params.get('cull') === 'off') layer.cull = false;
else if (params.get('cull') === 'ccw') layer.cull = 'ccw';
let mapRef: MapLibreMap | undefined;
let hexed = false;
/** The opening has finished; later builds follow the camera without animation. */
let ready = false;

const KEEP = /label-water-(ocean|other)|label-place-|landform-volcano/;
/** Once the hexagons cover everything, the map underneath stops drawing. */
const hiddenLayers = new Map<string, unknown>();
function showBasemap(show: boolean) {
  const m = mapRef;
  if (!m) return;
  if (show) {
    for (const [id, was] of hiddenLayers) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', (was as 'visible') ?? 'visible');
    hiddenLayers.clear();
    return;
  }
  for (const l of m.getStyle().layers) {
    // place, country and sea names (and volcanoes) stay, drawn over the hexagons
    if (l.id === layer.id || (l.type === 'symbol' && KEEP.test(l.id)) || hiddenLayers.has(l.id)) continue;
    hiddenLayers.set(l.id, m.getLayoutProperty(l.id, 'visibility'));
    m.setLayoutProperty(l.id, 'visibility', 'none');
  }
}

/** What the scene on screen covers. */
let shown: {wanted: number; level: number; poly: Array<[number, number]>; bearing: number} | undefined;
/** Which way the zoom last went, for sampling the next level ahead. */
let heading = 1;
let latestScene = 0;
async function build(intro = false) {
  const m = mapRef;
  if (!m || !hexed) return;
  const t0 = performance.now();
  const id = requestId + 1;
  latestScene = id;
  if (intro) setStatus('Sampling hexagons…');
  const view = viewOf(m);
  const reply = await askScene({type: 'scene', view, mode});
  if (reply.count < 0 || reply.id !== latestScene || !hexed) return;
  const how = intro ? 'intro' : shown && shown.level !== reply.level ? 'swap' : 'replace';
  shown = {wanted: reply.wanted, level: reply.level, poly: view.poly, bearing: view.bearing};
  setStatus('');
  const t1 = performance.now();
  layer.setScene(
    {
      count: reply.count,
      origin: reply.origin,
      zscale: reply.zscale,
      radius: reply.radius,
      base: reply.base,
      reliefZoom: reply.reliefZoom,
      landScale: reply.landScale,
      seaScale: reply.seaScale,
      landStep: reply.landStep,
      centers: reply.centers!,
      elev: reply.elev!,
      low: reply.low!,
      spill: reply.spill!,
      key: reply.id,
      colors: reply.colors,
      info: reply.info!,
    },
    how,
  );
  if (intro) mark('introStart');
  updateStats();
  const {region, sample, build: b, sampled} = reply.timing;
  console.info(
    `hexagonize: ${how} ${reply.count} cells (level ${reply.level}) — region ${region} ms, sampled ${sampled} in ${sample} ms, built in ${b} ms, round trip ${Math.round(t1 - t0)} ms`,
  );
}

function setHexed(on: boolean) {
  if (on === hexed) return;
  hexed = on;
  $('hexify').setAttribute('aria-checked', String(on));
  if (on) {
    ready = false;
    layer.fadeVeil(1, 0, 1.4);
    build(true).then(() => {
      // the opening lasts about four seconds; then the map underneath can stop drawing
      setTimeout(() => {
        if (!hexed) return;
        ready = true;
        mark('introEnd');
        showBasemap(false);
      }, 4200);
    });
  } else {
    latestScene = -1;
    shown = undefined;
    ready = false;
    showBasemap(true);
    layer.leave();
  }
}

// ------------------------------------------------------------------------------------------------
// UI

$('hexify').addEventListener('click', () => setHexed(!hexed));

// ------------------------------------------------------------------------------------------------
// Sea level: a tide gauge, finer near today's coast. It is coloured as the relief, so it is also
// the legend: land colours above zero, the sea's below.

let seaLevel = 0;
const LEVELS = [-6000, -3000, -1500, -600, -250, -120, -50, 0, 20, 70, 150, 400, 1000, 2500, 4500];
const PRESETS: Array<[number, string, string]> = [
  [70, 'No ice', 'If all the ice on land melted'],
  [0, 'Today', 'Today\'s coast'],
  [-120, 'Ice Age', 'About 20,000 years ago'],
  [-3000, 'Drained', 'The ocean drained to 3,000 m'],
];
const TICKS = [4500, 1000, 400, -600, -1500, -6000];
const LAST = LEVELS.length - 1;
const nice = (m: number) => (Math.abs(m) < 100 ? Math.round(m) : Math.abs(m) < 1000 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50);
const levelAt = (x: number) => {
  const i = Math.max(0, Math.min(LAST - 1, Math.floor(x)));
  return nice(LEVELS[i] + (LEVELS[i + 1] - LEVELS[i]) * (Math.min(LAST, Math.max(0, x)) - i));
};
const indexOf = (level: number) => {
  for (let i = 0; i < LAST; i++) if (level <= LEVELS[i + 1]) return i + (level - LEVELS[i]) / (LEVELS[i + 1] - LEVELS[i]);
  return LAST;
};
const signed = (m: number) => (m > 0 ? '+' : m < 0 ? '−' : '') + Math.abs(m).toLocaleString('en') + ' m';
const fraction = (level: number) => indexOf(level) / LAST;

const track = $('gauge-track');
{
  const stops: string[] = [];
  for (let k = 0; k <= 60; k++) {
    const e = levelAt((k / 60) * LAST);
    const c = e < 0 ? seaColor(-e) : landColor(e);
    stops.push(`${css(c)} ${((k / 60) * 100).toFixed(1)}%`);
  }
  track.style.background = `linear-gradient(to top, ${stops.join(', ')})`;
  const ticks = $('gauge-ticks');
  for (const t of TICKS) {
    const el = document.createElement('span');
    el.textContent = signed(t);
    el.style.bottom = `${fraction(t) * 100}%`;
    ticks.append(el);
  }
  for (const [level, label, title] of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.sea = String(level);
    b.title = title;
    b.innerHTML = `${label}<small>${signed(level)}</small>`;
    b.style.bottom = `${fraction(level) * 100}%`;
    b.addEventListener('click', () => setSea(level, 2.2));
    ticks.append(b);
  }
}
function showSea(level: number) {
  const f = fraction(level) * 100;
  $('gauge-handle').style.bottom = `${f}%`;
  $('gauge-water').style.height = `${f}%`;
  $('sea-value').textContent = signed(level);
  track.setAttribute('aria-valuenow', String(level));
  track.setAttribute('aria-valuetext', signed(level));
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-sea]')) b.setAttribute('aria-pressed', String(Number(b.dataset.sea) === level));
  $('changes').hidden = level === 0;
}
function setSea(level: number, dur: number) {
  if (!hexed) setHexed(true);
  seaLevel = level;
  layer.setSeaLevel(level, dur);
  showSea(level);
  updateStats();
}
/** Dragging snaps to the named levels when close to them. */
function levelFromPointer(clientY: number) {
  const r = track.getBoundingClientRect();
  const x = ((r.bottom - clientY) / r.height) * LAST;
  for (const [level] of PRESETS) if (Math.abs(indexOf(level) - x) < 0.18) return level;
  return levelAt(x);
}
track.addEventListener('pointerdown', (e) => {
  track.setPointerCapture(e.pointerId);
  setSea(levelFromPointer(e.clientY), 0.3);
});
track.addEventListener('pointermove', (e) => {
  if (track.hasPointerCapture(e.pointerId)) {
    const level = levelFromPointer(e.clientY);
    if (level !== seaLevel) setSea(level, 0.25);
  }
});
track.addEventListener('keydown', (e) => {
  const step = {ArrowUp: 0.25, ArrowRight: 0.25, ArrowDown: -0.25, ArrowLeft: -0.25, PageUp: 1, PageDown: -1}[e.key];
  if (e.key === 'Home') setSea(0, 1.2);
  else if (step) setSea(levelAt(indexOf(seaLevel) + step), 0.3);
  else return;
  e.preventDefault();
});
for (const el of [$('changes').querySelector<HTMLElement>('.lost')!, $('changes').querySelector<HTMLElement>('.gained')!])
  el.style.background = css(el.classList.contains('lost') ? LOST : GAINED);
showSea(0);

controller.ready.then((m) => {
  if (!m) return;
  mark('mapReady');
  mapRef = m;
  Object.assign(window, {hexMap: m, hexLayer: layer});
  m.jumpTo(OPENING);
  // past zoom 12 the relief data has no more detail, and the cells would only magnify it;
  // steeper than 65° the horizon brings in more ground than the cells can cover
  m.setMaxZoom(12);
  m.setMinZoom(2.5);
  m.setMaxPitch(65);
  // the hexagons are the relief: a flat Mercator ground keeps them registered with the map
  const flatten = () => {
    if (m.getTerrain()) m.setTerrain(null);
    if (m.getProjection()?.type !== 'mercator') m.setProjection({type: 'mercator'});
    if (m.isStyleLoaded() && !m.getLayer(layer.id)) m.addLayer(layer, m.getStyle().layers.find((l) => l.type === 'symbol')?.id);
  };
  flatten();
  m.on('styledata', flatten);

  // while the camera moves, cells keep coming in behind the margin; one build at a time
  let inflight = false;
  let again = false;
  let lastZoom = m.getZoom();
  const refresh = async () => {
    if (!hexed || !ready) return;
    const z = m.getZoom();
    if (Math.abs(z - lastZoom) > 0.01) heading = Math.sign(z - lastZoom);
    lastZoom = z;
    if (inflight) return void (again = true);
    if (!stale(m)) return;
    inflight = true;
    try {
      await build();
    } finally {
      inflight = false;
      if (again) {
        again = false;
        refresh();
      }
    }
  };
  m.on('move', refresh);
  m.on('moveend', refresh);

  if (AUTO) {
    const loaded = new Promise<void>((r) => {
      if (m.isStyleLoaded()) return r();
      m.once('load', () => r());
      m.once('idle', () => r());
    });
    loaded.then(() => mark('styleLoaded'));
    const poll = setInterval(() => m.isStyleLoaded() && (mark('styleUsable'), clearInterval(poll)), 25);
    m.once('render', () => mark('firstRender'));
    m.once('idle', () => mark('mapIdle'));
    // the plain map shows for a moment once it has loaded, then turns into hexagons
    Promise.all([loaded, prefetch]).then(() => {
      flatten();
      setTimeout(() => setHexed(true), 700);
    });
  }
});

// ------------------------------------------------------------------------------------------------
// What the sea level changes in view, counted over the cells

const km2 = (a: number) => (a >= 1e6 ? `${(a / 1e6).toFixed(2)} M km²` : a >= 1e4 ? `${Math.round(a / 1e3).toLocaleString('en')}k km²` : `${Math.round(a).toLocaleString('en')} km²`);
let statsBusy = false;
let statsAgain = false;
async function updateStats() {
  if (!hexed) return;
  if (statsBusy) return void (statsAgain = true);
  statsBusy = true;
  try {
    const {stats} = await askScene({type: 'stats', level: seaLevel});
    if (stats) showStats(stats);
  } finally {
    statsBusy = false;
    if (statsAgain) {
      statsAgain = false;
      updateStats();
    }
  }
}
function showStats(st: Stats) {
  const el = $('stats');
  const islands = st.islands === 1 ? '1 island' : `${st.islands.toLocaleString('en')} islands`;
  if (st.level === 0) {
    el.innerHTML = `In view<br><b>${km2(st.land)}</b> land<br><b>${islands}</b>`;
    return;
  }
  const pct = st.landToday ? ((st.land - st.landToday) / st.landToday) * 100 : 0;
  const dIslands = st.islands - st.islandsToday;
  const sign = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '±');
  el.innerHTML = `In view<br><b>${km2(st.land)}</b> land <span class="${pct < 0 ? 'down' : 'up'}">${sign(pct)}${Math.abs(pct).toFixed(1)} %</span><br><b>${islands}</b>${dIslands ? ` <span class="${dIslands < 0 ? 'down' : 'up'}">${sign(dIslands)}${Math.abs(dIslands)}</span>` : ''} <span class="vs">vs today</span>`;
}

// ------------------------------------------------------------------------------------------------
// Inspector: what the cell under the pointer is, and when the sea takes or gives it

const probe = $('probe');
let probing = false;
let pointer: {x: number; y: number} | undefined;
const metres = (m: number) => `${Math.round(Math.abs(m)).toLocaleString('en')} m`;
function describe(c: CellInfo) {
  const sea = c.kind === 1;
  const lines: string[] = [];
  const what = sea ? 'Sea floor' : c.kind === 2 ? 'Lake' : c.kind === 3 ? 'River' : 'Land';
  lines.push(`<b>${sea ? `${metres(c.elev)} deep` : `${metres(c.elev)} high`}</b> · ${what}`);
  const isolated = sea && c.elev < c.spill;
  const wet = sea ? seaLevel > c.spill || isolated : seaLevel > Math.max(c.spill, 0);
  if (sea) {
    if (isolated && c.spill <= 0) lines.push(`Cut off from the ocean when the sea drops below ${signedM(c.spill)}: it stays a lake`);
    else lines.push(`Dry land when the sea drops to ${signedM(c.spill)}`);
  } else {
    const at = Math.max(c.spill, 0);
    lines.push(`Under water when the sea rises to ${signedM(Math.max(1, Math.ceil(at)))}`);
  }
  lines.push(`<span class="now">${wet ? 'Under water' : 'Dry'} at ${signedM(seaLevel)} · ${c.lat.toFixed(2)}°, ${c.lng.toFixed(2)}°</span>`);
  return lines.join('<br>');
}
const signedM = (m: number) => (m > 0 ? '+' : m < 0 ? '−' : '') + metres(m);
async function inspect() {
  if (!pointer || !ready || !hexed || probing) return;
  probing = true;
  const {x, y} = pointer;
  try {
    const hit = await layer.pickAt(x, y);
    const reply = hit && (await askScene({type: 'cell', scene: hit.scene, index: hit.index}));
    if (!reply?.cell || !pointer) return void probe.classList.remove('on');
    probe.innerHTML = describe(reply.cell);
    probe.style.transform = `translate(${Math.min(pointer.x + 16, innerWidth - probe.offsetWidth - 12)}px, ${Math.max(12, pointer.y - probe.offsetHeight - 14)}px)`;
    probe.classList.add('on');
  } finally {
    probing = false;
    if (pointer && (pointer.x !== x || pointer.y !== y)) requestAnimationFrame(inspect);
  }
}
$('map').addEventListener('pointermove', (e) => {
  if (e.buttons) return void (pointer = undefined, probe.classList.remove('on'));
  pointer = {x: e.clientX, y: e.clientY};
  requestAnimationFrame(inspect);
});
$('map').addEventListener('pointerleave', () => {
  pointer = undefined;
  probe.classList.remove('on');
});
