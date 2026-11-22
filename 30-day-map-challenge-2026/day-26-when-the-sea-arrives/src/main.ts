import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {createTileflowMap} from '@tileflow/dom';
import {autocomplete, resolveSuggestion} from '@tileflow/search';
import type {Map as MapLibreMap} from 'maplibre-gl';
import {FloodLayer} from './flood-layer';
import {CAP, OCEAN, type Counts, type Raster, type Reply, type Request, type View} from './flood-worker';
import {mercator} from './geo';
import {block, FIRST_YEAR, LAST_YEAR, loadSeaLevels, MEDIAN, riseAt, SCENARIOS, type SeaLevels, yearIndex, yearReaching} from './sea-level';

const BASE = import.meta.env.BASE_URL;
const DATA_URL = `${BASE}data/sea-level.bin`;
const POPULATION_URL = `${BASE}data/population.pmtiles`;
const COAST_URL = `${BASE}data/coastal-terrain.pmtiles`;
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setStatus = (t: string) => ($('status').textContent = t);

// ------------------------------------------------------------------------------------------------
// What is shown

let scenario = Number(params.get('scenario') ?? 1);
let quantile = MEDIAN;
let year = FIRST_YEAR;
const sharedYear = params.has('year') ? Number(params.get('year')) : undefined;
let levels: SeaLevels | undefined;
let raster: Raster | undefined;

const field = (s = scenario, q = quantile) => block(levels!, s, q);

// ------------------------------------------------------------------------------------------------
// The worker builds the ground under the view and counts what floods

const worker = new Worker(new URL('./flood-worker.ts', import.meta.url), {type: 'module'});
let nextId = 0;
const waiting = new Map<number, (r: Reply) => void>();
worker.onmessage = (e: MessageEvent<Reply>) => {
  const done = waiting.get(e.data.id);
  waiting.delete(e.data.id);
  if (e.data.type === 'error') console.warn(e.data.error);
  done?.(e.data);
};
type Ask = Request extends infer R ? (R extends {id: number} ? Omit<R, 'id'> : never) : never;
function ask(req: Ask): Promise<Reply> {
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker.postMessage({...req, id});
  });
}

function viewPolygon(m: MapLibreMap, margin: number): Array<[number, number]> {
  const {clientWidth: w, clientHeight: h} = m.getContainer();
  // above the horizon unproject() runs away: steep views keep a small margin at the top edge
  const top = -h * Math.min(margin, m.getPitch() > 50 ? 0.02 : 0.1);
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
const viewOf = (m: MapLibreMap): View => ({poly: viewPolygon(m, 0.25), visible: viewPolygon(m, 0), zoom: m.getZoom()});

/** Whether the raster on screen still serves this camera. */
function stale(m: MapLibreMap) {
  if (!raster || !built) return true;
  if (Math.abs(m.getZoom() - built.zoom) > 0.7) return true;
  const [u0, v0] = raster.origin;
  const u1 = u0 + raster.w * raster.step;
  const v1 = v0 + raster.h * raster.step;
  return !viewPolygon(m, 0.02).every(([u, v]) => u >= u0 && u <= u1 && v >= v0 && v <= v1);
}

const layer = new FloodLayer();
let mapRef: MapLibreMap | undefined;
let built: {zoom: number} | undefined;
let building = false;
let buildAgain = false;
async function rebuild() {
  const m = mapRef;
  if (!m) return;
  if (building) return void (buildAgain = true);
  building = true;
  try {
    const view = viewOf(m);
    if (!raster) setStatus('Reading the ground…');
    const reply = await ask({type: 'build', view, dataUrl: DATA_URL, populationUrl: POPULATION_URL, coastUrl: COAST_URL});
    if (reply.type !== 'build') return;
    raster = reply.raster;
    built = {zoom: view.zoom};
    layer.setRaster(raster);
    setStatus('');
    console.info('when-the-sea-arrives: raster', reply.ms);
    recount(true);
  } finally {
    building = false;
    if (buildAgain) {
      buildAgain = false;
      if (stale(m)) rebuild();
    }
  }
}

let counting = false;
let countAgain = false;
async function recount(moved = false) {
  const m = mapRef;
  if (!m || !raster) return;
  if (counting) return void (countAgain = true);
  counting = true;
  try {
    const reply = await ask({type: 'count', scenario, quantile, year, visible: moved ? viewPolygon(m, 0) : undefined});
    if (reply.type === 'count') showCounts(reply.counts);
  } finally {
    counting = false;
    if (countAgain) {
      countAgain = false;
      recount(true);
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Map

const PLACES: Array<[string, number, number, number]> = [
  ['Nile Delta', 31.05, 30.95, 8.2],
  ['Netherlands', 4.75, 52.1, 8.1],
  ['Venice', 12.32, 45.4, 10.4],
  ['Bangkok', 100.55, 13.62, 9.2],
  ['Shanghai', 121.55, 31.2, 9],
  ['Mekong Delta', 105.9, 9.9, 7.9],
  ['Ganges Delta', 89.9, 22.7, 7.6],
  ['Miami', -80.25, 25.82, 10],
  ['New Orleans', -90.05, 29.93, 9.4],
  ['Jakarta', 106.85, -6.15, 10.2],
];
const OPENING = (() => {
  const v = params.get('view')?.split(',').map(Number);
  const [, lng, lat, zoom] = PLACES[0];
  return {center: [v?.[0] ?? lng, v?.[1] ?? lat] as [number, number], zoom: v?.[2] ?? zoom, pitch: v?.[3] ?? 0, bearing: v?.[4] ?? 0};
})();

const controller = createTileflowMap($('map'), {
  // the managed Map (`tileflow deploy`): its hosted style carries the Map ID Terrain needs
  source: {map: 'hexagonize', manifestUrl: `${BASE}map/manifest.json`},
  theme: 'light',
  navigationControl: true,
  viewMode: '3d',
  onError: ({code, error}) => console.warn(code, error),
});

controller.ready.then(async (m) => {
  if (!m) return;
  mapRef = m;
  Object.assign(window, {seaMap: m, seaLayer: layer});
  m.jumpTo(OPENING);
  // Terrain stops adding detail past zoom 12; continents are too coarse for a flood of metres
  m.setMaxZoom(13);
  m.setMinZoom(3);
  m.setMaxPitch(60);
  const place = () => {
    if (m.getTerrain()) m.setTerrain(null);
    if (m.getProjection()?.type !== 'mercator') m.setProjection({type: 'mercator'});
    if (m.isStyleLoaded() && !m.getLayer(layer.id)) m.addLayer(layer, m.getStyle().layers.find((l) => l.type === 'symbol')?.id);
  };
  place();
  m.on('styledata', place);
  m.on('move', () => {
    if (stale(m)) rebuild();
  });
  m.on('moveend', () => {
    share();
    if (stale(m)) rebuild();
    else recount(true);
    hereChanged();
  });
  m.on('mousemove', (e) => probe(e.point.x, e.point.y, e.lngLat.lng, e.lngLat.lat));
  m.on('mouseout', () => $('probe').classList.remove('on'));
  m.on('click', (e) => probe(e.point.x, e.point.y, e.lngLat.lng, e.lngLat.lat, true));
  await ready;
  rebuild();
  hereChanged();
  // the opening: the century passes (a shared link opens on its own year instead)
  if (sharedYear !== undefined) setYear(sharedYear);
  else if (params.get('auto') !== '0') setTimeout(() => playTo(2100, 7), 900);
});

const ready = loadSeaLevels(DATA_URL).then((l) => {
  levels = l;
  layer.setRise(field());
});

// ------------------------------------------------------------------------------------------------
// Time and scenario

const range = $<HTMLInputElement>('year-range');
range.min = String(FIRST_YEAR);
range.max = String(LAST_YEAR);
let animation: {from: number; to: number; start: number; dur: number} | undefined;
function setYear(y: number) {
  year = Math.max(FIRST_YEAR, Math.min(LAST_YEAR, y));
  layer.setYear(yearIndex(year));
  range.value = String(Math.round(year));
  range.style.setProperty('--fill', `${((year - FIRST_YEAR) / (LAST_YEAR - FIRST_YEAR)) * 100}%`);
  $('year').textContent = String(Math.round(year));
  if (!animation) share();
  hereChanged();
  recount();
}
function playTo(to: number, seconds: number) {
  animation = {from: year, to, start: performance.now(), dur: seconds * 1000};
  $('play').setAttribute('aria-pressed', 'true');
  requestAnimationFrame(step);
}
function stop() {
  animation = undefined;
  share();
  $('play').setAttribute('aria-pressed', 'false');
}
function step(now: number) {
  if (!animation) return;
  const t = Math.min(1, (now - animation.start) / animation.dur);
  const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  setYear(animation.from + (animation.to - animation.from) * e);
  if (t < 1) requestAnimationFrame(step);
  else stop();
}
range.addEventListener('input', () => {
  stop();
  setYear(Number(range.value));
});
$('play').addEventListener('click', () => {
  if (animation) return stop();
  if (year >= LAST_YEAR - 0.5) setYear(FIRST_YEAR);
  playTo(LAST_YEAR, ((LAST_YEAR - year) / (LAST_YEAR - FIRST_YEAR)) * 11);
});
{
  const ticks = $('ticks');
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y += 10) {
    const t = document.createElement('span');
    t.textContent = y % 50 === 0 ? String(y) : '';
    t.style.left = `${((y - FIRST_YEAR) / (LAST_YEAR - FIRST_YEAR)) * 100}%`;
    ticks.append(t);
  }
}

const scenarioButtons = SCENARIOS.map((s, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.innerHTML = `${s.label}<small>${s.id.toUpperCase().replace(/(\d)(\d)(\d)$/, '$1-$2.$3')}</small>`;
  b.title = s.long;
  b.addEventListener('click', () => setScenario(i));
  $('scenario').append(b);
  return b;
});
function setScenario(i: number) {
  scenario = i;
  share();
  scenarioButtons.forEach((b, j) => b.setAttribute('aria-checked', String(i === j)));
  if (levels) layer.setRise(field());
  hereChanged();
  recount();
}
setScenario(scenario);
const quantileButtons = [...$('quantile').querySelectorAll<HTMLButtonElement>('button')];
function setQuantile(q: number) {
  quantile = q;
  quantileButtons.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.q) === q)));
  if (levels) layer.setRise(field());
  hereChanged();
  recount();
}
quantileButtons.forEach((b) => b.addEventListener('click', () => setQuantile(Number(b.dataset.q))));
setQuantile(MEDIAN);
setYear(FIRST_YEAR);

/** The view, year and scenario in the address, so a link opens the same map. */
function share() {
  const m = mapRef;
  if (!m) return;
  const c = m.getCenter();
  const q = new URLSearchParams();
  q.set('view', [c.lng.toFixed(3), c.lat.toFixed(3), m.getZoom().toFixed(1)].join(','));
  q.set('year', String(Math.round(year)));
  q.set('scenario', String(scenario));
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

// ------------------------------------------------------------------------------------------------
// Figures

const metres = (m: number) => `${m < 0 ? '−' : '+'}${Math.abs(m).toFixed(2)} m`;
const people = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million` : n >= 1e4 ? `${Math.round(n / 1e3).toLocaleString('en')},000` : n >= 50 ? (Math.round(n / 10) * 10).toLocaleString('en') : n > 0 ? 'a few' : 'none';
const km2 = (a: number) => (a >= 100 ? `${Math.round(a).toLocaleString('en')} km²` : a >= 1 ? `${a.toFixed(1)} km²` : a > 0 ? '< 1 km²' : '0 km²');

/** The rise at the centre of the view, with the IPCC's likely range. */
function hereChanged() {
  const m = mapRef;
  if (!m || !levels) return;
  const c = m.getCenter();
  const mid = riseAt(field(scenario, MEDIAN), c.lng, c.lat, year);
  const lo = riseAt(field(scenario, 0), c.lng, c.lat, year);
  const hi = riseAt(field(scenario, 2), c.lng, c.lat, year);
  $('here-year').textContent = String(Math.round(year));
  $('here').textContent = metres(mid);
  $('here-range').textContent = `likely ${lo.toFixed(2)} to ${hi.toFixed(2)} m`;
}

function showCounts(c: Counts) {
  $('area').textContent = km2(c.area);
  $('people').textContent = people(c.people);
  const d = $('defended');
  d.hidden = c.defended < 1;
  $('defended-people').textContent = people(c.defendedPeople);
  $('defended-area').textContent = km2(c.defended);
}

// ------------------------------------------------------------------------------------------------
// Inspector: when the sea reaches the ground under the pointer

const probeEl = $('probe');
const when = (y: number | null) => (y === null ? `after ${LAST_YEAR}` : y <= FIRST_YEAR + 0.5 ? 'already' : `around ${Math.round(y / 5) * 5}`);
function probe(x: number, y: number, lng: number, lat: number, pin = false) {
  const r = raster;
  if (!r || !levels) return;
  const [u, v] = mercator(lng, lat);
  const px = Math.floor((u - r.origin[0]) / r.step);
  const py = Math.floor((v - r.origin[1]) / r.step);
  if (px < 0 || py < 0 || px >= r.w || py >= r.h) return probeEl.classList.remove('on');
  const i = py * r.w + px;
  const elev = r.elev[i];
  const spill = r.spill[i];
  const lines: string[] = [];
  if (spill === OCEAN) lines.push('<b>The sea today</b>');
  else if (spill >= CAP) {
    lines.push(`<b>${Math.round(elev).toLocaleString('en')} m</b> above the sea`);
    lines.push(`<span class="muted">Out of reach of these projections</span>`);
  } else {
    lines.push(`<b>${elev.toFixed(1)} m</b> above today's sea`);
    if (spill > elev + 0.05) lines.push(`<span class="muted">Higher ground in between: the sea must reach ${spill.toFixed(1)} m first</span>`);
    const rows = SCENARIOS.map((s, k) => {
      const mid = yearReaching(field(k, MEDIAN), lng, lat, spill);
      const early = yearReaching(field(k, 2), lng, lat, spill);
      const late = yearReaching(field(k, 0), lng, lat, spill);
      const likely = mid !== null && (early !== null || late !== null) ? `<small>likely ${early ? Math.round(early) : '…'}–${late ? Math.round(late) : `after ${LAST_YEAR}`}</small>` : '';
      return `<tr${k === scenario ? ' class="on"' : ''}><th>${s.label}</th><td>${when(mid)} ${likely}</td></tr>`;
    });
    const defended = riseAt(field(scenario, quantile), lng, lat, FIRST_YEAR) > spill;
    lines.push(defended ? '<span class="defended-note">Already below the sea: kept dry by dikes and pumps</span>' : `The sea reaches it<table>${rows.join('')}</table>`);
  }
  probeEl.innerHTML = lines.join('<br>');
  probeEl.style.transform = `translate(${Math.min(x + 16, innerWidth - probeEl.offsetWidth - 12)}px, ${Math.max(12, y - probeEl.offsetHeight - 14)}px)`;
  probeEl.classList.add('on');
  probeEl.classList.toggle('pinned', pin);
}

// ------------------------------------------------------------------------------------------------
// Places and search

for (const [name, lng, lat, zoom] of PLACES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = name;
  b.addEventListener('click', () => mapRef?.flyTo({center: [lng, lat], zoom, pitch: 0, bearing: 0, duration: 2600}));
  $('places').append(b);
}

const SEARCH_KEY = import.meta.env.VITE_TILEFLOW_SEARCH_KEY as string | undefined;
if (SEARCH_KEY) {
  const form = $<HTMLFormElement>('search');
  const input = form.querySelector('input')!;
  const list = $('results');
  form.hidden = false;
  let timer = 0;
  let abort: AbortController | undefined;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const query = input.value.trim();
      abort?.abort();
      list.replaceChildren();
      if (query.length < 3) return;
      abort = new AbortController();
      const c = mapRef?.getCenter();
      try {
        const page = await autocomplete({query, language: 'en', limit: 6, ...(c ? {proximity: [c.lng, c.lat] as [number, number]} : {})}, {apiKey: SEARCH_KEY, signal: abort.signal});
        for (const s of page.suggestions) {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.type = 'button';
          b.innerHTML = `<b></b><small></small>`;
          b.querySelector('b')!.textContent = s.label;
          b.querySelector('small')!.textContent = s.addressLabel ?? '';
          b.addEventListener('click', async () => {
            list.replaceChildren();
            input.value = s.label;
            const {result} = await resolveSuggestion({token: s.token}, {apiKey: SEARCH_KEY});
            mapRef?.flyTo({center: result.position, zoom: result.kind === 'address' || result.kind === 'street' ? 13 : 11, pitch: 0, bearing: 0, duration: 2600});
          });
          li.append(b);
          list.append(li);
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') console.warn(e);
      }
    }, 300);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    list.querySelector('button')?.click();
  });
}

// ------------------------------------------------------------------------------------------------
// About the data

const dialog = $<HTMLDialogElement>('about-dialog');
$('about').addEventListener('click', () => {
  dialog.showModal();
  dialog.querySelector('h2')!.focus();
  dialog.scrollTop = 0;
});
dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
