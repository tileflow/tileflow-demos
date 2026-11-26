import * as maplibregl from 'maplibre-gl';
import {createWorldMap} from './world-map';
import PeakSearch from './peak-search';
import MapProbes from './map-probes';
import DiscoveryMap from './discovery-map';
import ObserverPlacement from './observer-placement';
import Observer3D from './observer-3d';
import DiscoveryPanel from './discovery-panel';
import LiveAim from './live-aim';
import FieldGuide from './field-guide';
import TerrainProfile from './discovery-profile';

import 'maplibre-gl/dist/maplibre-gl.css';
import './map-probes.css';
import './style.css';
import './discovery-panel.css';
import './discovery-profile.css';
import './live-aim.css';
import './observer-marker.css';
import './observer-view.css';
import './placement-preview.css';

const el = (id) => document.getElementById(id);
document.documentElement.dataset.layout =
  new URLSearchParams(window.location.search).get('layout') === 'profile' ? 'profile' : 'compact';
const f = (v, d = 1) =>
  Number.isFinite(v)
    ? v.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d})
    : '—';
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const valid = (p) =>
  p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 85.0511288 && Number.isFinite(p.lon);
const coordinate = (p) =>
  f(Math.abs(p.lat), 4) +
  '° ' +
  (p.lat < 0 ? 'S' : 'N') +
  ' · ' +
  f(Math.abs(wrap(p.lon)), 4) +
  '° ' +
  (wrap(p.lon) < 0 ? 'W' : 'E');
const S = {
  id: 0,
  rev: 0,
  point: null,
  ready: false,
  failed: false,
  analysis: null,
  skyOpen: false,
  horizon: null,
  azimuth: 0,
  heading: 333,
  aimElevation: 0,
};
let prefer3D = true,
  lastPerspective = null;
let discovery,
  profilePanel,
  discoveryMap,
  candidates = new Map(),
  clockStart = 0,
  aim,
  liveVersion = 0,
  liveFrame = 0,
  liveJob = null;
let searchPreview = null,
  searchMarker = null,
  activeAimPeak = null;
const view = () => ({mode: el('representation').value, showHidden: el('show-hidden').checked});
const opacity = () => el('opacity').valueAsNumber;
const geometry = () => ({
  targetHeight: el('target-height').valueAsNumber,
  curvature: Number(el('curvature').value),
  sectorBearing: el('sector-bearing').valueAsNumber,
  sectorWidth: Number(el('sector-width').value),
});
const SCENE_PITCH = 48,
  SCENE_BEARING = 68;
let observerModel,
  placement,
  field,
  probes,
  closeupCamera = null,
  atlas,
  map,
  styleReady = false,
  pendingParts = null,
  rasterCount = 0;
// GeoJSON sources can update after the pointer is released. Keep the old map overlays
// out of the render pass until the replacement rings have reached the map worker.
let placementState = 'idle', pendingDropRings = null, analysisLayersHidden = false;
const observerSources = new Set([
  'field-distances', 'field-direction', 'discovered-summits', 'summit-highlight',
  'terrain-trace', 'analysis-sector',
]);
function syncPlacementLayers() {
  const hidden = placementState !== 'idle' || pendingDropRings !== null;
  if (hidden === analysisLayersHidden || !styleReady) return;
  analysisLayersHidden = hidden;
  for (const id of map.getLayersOrder()) {
    if (id.startsWith('visibility-') || observerSources.has(map.getLayer(id)?.source)) {
      map.setLayoutProperty(id, 'visibility', hidden ? 'none' : 'visible');
    }
  }
}

const heightsByPoint = new Map(),
  readings = new Map();
const madeira = {lat: 32.7355, lon: -16.9289},
  R = 6371008.8,
  rad = Math.PI / 180;
const isMadeira = (p) =>
  Math.abs(p.lat - madeira.lat) < 1e-8 && Math.abs(p.lon - madeira.lon) < 1e-8;
const job = new Worker(new URL('./analysis.worker.js', import.meta.url), {type: 'module'});
const eye = () => el('eye').valueAsNumber;
const radius = () => Number(el('radius').value);
function zoomForRadius(r, lat) {
  const diameter = Math.min(innerWidth * 0.83, innerHeight * 1.36);
  return Math.log2((((2 * Math.PI * R * Math.cos(lat * rad)) / 512) * diameter) / (2 * r));
}
function clearRaster() {
  pendingParts = null;
  if (!styleReady) return;
  for (let i = 0; i < rasterCount; i++) {
    const id = 'visibility-' + i;
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  rasterCount = 0;
}
function setRaster(parts) {
  if (!styleReady) {
    pendingParts = parts;
    return;
  }
  clearRaster();
  for (const [i, p] of parts.entries()) {
    const canvas = document.createElement('canvas');
    canvas.width = p.w;
    canvas.height = p.h;
    canvas.getContext('2d').putImageData(new ImageData(p.rgba, p.w, p.h), 0, 0);
    const id = 'visibility-' + i;
    map.addSource(id, {type: 'canvas', canvas, coordinates: p.coords, animate: false});
    map.addLayer(
      {
        id,
        type: 'raster',
        source: id,
        layout: {visibility: analysisLayersHidden ? 'none' : 'visible'},
        paint: {
          'raster-resampling': 'nearest',
          'raster-fade-duration': 0,
          'raster-opacity': opacity(),
        },
      },
      FieldGuide.firstLayer,
    );
    rasterCount++;
  }
}
function closeSky() {
  discovery?.closeSky();
  S.skyOpen = false;
}
function sameView(v) {
  return v?.mode === view().mode && v.showHidden === view().showHidden;
}
function updateLegend() {
  const mode = view().mode === 'height',
    key = el('height-key'),
    ordinary = el('guide').querySelector('.patch-key');
  ordinary.hidden = mode;
  key.hidden = !mode;
  ordinary.querySelector('.blocked').parentElement.hidden = !view().showHidden;
  if (mode && !key.hasChildNodes()) {
    const caption = document.createElement('strong');
    caption.textContent = 'Additional observer height';
    const bands = document.createElement('div');
    bands.className = 'classes';
    key.append(caption, bands);
    for (const [label, color] of [
      ['0 m', '#159b86'],
      ['≤10', '#cfe6a6'],
      ['≤30', '#f1d578'],
      ['≤100', '#dd934a'],
      ['≤200', '#b85e4b'],
      ['>200 m', '#79465a'],
      ['No data', '#81796e'],
    ]) {
      const band = document.createElement('span'),
        chip = document.createElement('i');
      chip.style.background = color;
      band.append(chip, label);
      bands.append(band);
    }
  }
}
function scheduleLiveProfile() {
  if (!S.analysis || !aim?.current() || liveFrame || liveJob) return;
  liveFrame = requestAnimationFrame(() => {
    liveFrame = 0;
    const point = aim.current();
    if (!point || !S.analysis || liveJob) return;
    liveJob = {version: liveVersion, point, id: S.id, rev: S.rev};
    job.postMessage({
      type: 'profile',
      id: S.id,
      rev: S.rev,
      probeId: liveVersion,
      lat: point.lat,
      lon: point.lon,
    });
  });
}
function invalidateLiveProfile() {
  liveVersion++;
  profilePanel?.eyeView.validateSightline(null);
  liveJob = null;
  if (liveFrame) cancelAnimationFrame(liveFrame);
  liveFrame = 0;
}
function aimHeading() {
  const p = aim?.current();
  if (!p || !S.point) return;
  const distance = distanceToPoint(p);
  setHeading(distance > 0.05 ? headingTo(p) : S.heading, distance > 0.05, distance);
}
function aimChanged(p) {
  profilePanel?.eyeView.validateSightline(null);
  const selected = p.peakId ?? null;
  if (discovery && discovery.getSelectedId() !== selected) discovery.select(selected);
  if (selected || activeAimPeak !== null) {
    discoveryMap?.highlight(selected ? candidates.get(selected) : null);
    activeAimPeak = selected;
  }
  liveVersion++;
  aimHeading();
  scheduleLiveProfile();
}
function choosePeak(p) {
  if (!p || !S.point) return;
  if (placement?.isActive()) {
    placement.consumeMapPick(p);
    return;
  }
  const fromPanel = !!document.activeElement?.closest('.discovery-sheet, #observer-actions');
  discovery.closePanels();
  setObserverTools(false);
  if (fromPanel) el('more-toggle').focus({preventScroll: true});
  probes?.close();
  aim.set({...p, peakId: p.id}, {fixed: true, source: 'peak'});
}
function initialAim(point) {
  const g = geometry(),
    bearing = g.sectorWidth === 360 ? S.heading : g.sectorBearing;
  const mpp = (2 * Math.PI * R * Math.cos(point.lat * rad)) / (512 * 2 ** map.getZoom());
  const distance = Math.max(
    1,
    Math.min(2000, radius() * 0.25, Math.min(innerWidth, innerHeight) * 0.22 * mpp),
  );
  const origin = map.project([point.lon, point.lat]);
  let first;
  // At an oblique pitch a distant target can project directly onto the hiker.
  // Start with two separately reachable handles, including when placed near a screen edge.
  for (const angle of [0, 42, -42, 90, -90, 155, -155]) {
    if (Math.abs(angle) > g.sectorWidth / 2) continue;
    const azimuth = (bearing + angle) * rad,
      lat = point.lat * rad;
    for (const metres of [distance, Math.min(radius() * 0.7, distance * 2.4)]) {
      const arc = metres / R;
      const targetLat = Math.asin(
        Math.sin(lat) * Math.cos(arc) + Math.cos(lat) * Math.sin(arc) * Math.cos(azimuth),
      );
      const targetLon =
        point.lon +
        Math.atan2(
          Math.sin(azimuth) * Math.sin(arc) * Math.cos(lat),
          Math.cos(arc) - Math.sin(lat) * Math.sin(targetLat),
        ) /
          rad;
      const target = {lat: targetLat / rad, lon: wrap(targetLon)};
      if (!first) first = target;
      if (!valid(target)) continue;
      const xy = map.project([target.lon, target.lat]);
      if (
        xy.x < 24 ||
        xy.x > innerWidth - 24 ||
        xy.y < 24 ||
        xy.y > innerHeight - 24 ||
        Math.hypot(xy.x - origin.x, xy.y - (origin.y - 18)) < 50
      )
        continue;
      if (document.elementFromPoint(xy.x, xy.y) === map.getCanvas()) return target;
    }
  }
  return valid(first) ? first : {lat: point.lat, lon: point.lon};
}
function saveAim(p) {
  if (!S.point || !p) return;
  aim.setFixed(true);
  probes.add(p);
}
function beginDiscovery(point) {
  S.aimElevation = 0;
  if (!point) profilePanel?.eyeView.clear();
  invalidateLiveProfile();
  aim?.clear();
  profilePanel?.clear();
  activeAimPeak = null;
  candidates.clear();
  discoveryMap?.peaks([]);
  discoveryMap?.highlight(null);
  discovery?.setObserver(point);
  S.catalog = null;
  el('catalog-detail')?.remove();
}
function applyRepresentation() {
  updateLegend();
  for (const [id, r] of readings) probes?.update(id, {...r, heightMode: view().mode === 'height'});
  if (S.analysis) {
    liveVersion++;
    scheduleLiveProfile();
  }
  if (S.analysis) job.postMessage({type: 'view', id: S.id, rev: S.rev, view: view()});
}
el('representation').onchange = el('show-hidden').onchange = applyRepresentation;
el('opacity').oninput = () => {
  for (let i = 0; i < rasterCount; i++)
    map.setPaintProperty('visibility-' + i, 'raster-opacity', opacity());
};
el('export-analysis').onclick = () => {
  if (S.analysis) job.postMessage({type: 'export', id: S.id, rev: S.rev, target: aim?.current()});
};
function downloadScenario(d) {
  const pack = (array) => {
    let bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
      chunks = [];
    for (let i = 0; i < bytes.length; i += 16383)
      chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 16383))));
    return {
      encoding: 'base64',
      dtype: array instanceof Float32Array ? 'Float32 (little endian)' : 'Uint8',
      data: chunks.join(''),
    };
  };
  const out = {
    ...d,
    heights: pack(d.heights),
    nearHeights: d.nearHeights ? pack(d.nearHeights) : null,
    mask: pack(d.mask),
    threshold: pack(d.threshold),
    validity: pack(d.validity),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(out)], {type: 'application/json'}));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tileflow-scenario-' + S.id + '-' + S.rev + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function updateTip() {
  el('tip').textContent = matchMedia('(hover: hover) and (pointer: fine)').matches
    ? 'Move the pointer to explore. Click to lock the view.'
    : 'Drag the target or tap a place to inspect it.';
  el('tip').hidden = S.skyOpen;
}
function distanceToPoint(p) {
  const a = S.point.lat * rad,
    b = p.lat * rad,
    dy = (p.lat - S.point.lat) * rad,
    dx = wrap(p.lon - S.point.lon) * rad;
  const h = Math.sin(dy / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(dx / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}
function observerPose() {
  observerModel?.setPose(S.point, S.analysis?.ground ?? null, S.heading);
  atlas?.setObserverBearing(S.heading);
  profilePanel?.eyeView.look(S.heading, S.skyOpen ? 0 : S.aimElevation);
}
function setHeading(deg, show = true, distance) {
  if (!Number.isFinite(deg) || !S.point) return;
  const value = ((deg % 360) + 360) % 360;
  if (Math.abs(S.heading - value) >= 0.15) {
    S.heading = value;
    observerPose();
  }
  field?.setHeading(value, show, distance);
}
function headingTo(p) {
  const a = S.point.lat * rad,
    b = p.lat * rad,
    dl = wrap(p.lon - S.point.lon) * rad;
  return (
    Math.atan2(
      Math.sin(dl) * Math.cos(b),
      Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dl),
    ) / rad
  );
}
function onPick(chosen, ground = chosen) {
  if (placement?.consumeMapPick(ground) || !valid(ground) || !S.point || !aim) return;
  dismissSearchPreview();
  probes?.close();
  const id = discoveryMap?.pick(map.project([ground.lon, ground.lat])),
    peak = candidates.get(id);
  if (peak) {
    choosePeak(peak);
    return;
  }
  const latDelta = (chosen.lat - ground.lat) * rad,
    lonDelta = wrap(chosen.lon - ground.lon) * rad * Math.cos(ground.lat * rad);
  const name = chosen.name && R * Math.hypot(latDelta, lonDelta) <= 50 ? chosen.name : '';
  aim.tap({...ground, name});
}
function inspectMove(e) {
  if (
    !S.point ||
    !aim ||
    aim.isFixed() ||
    aim.isDragging() ||
    S.skyOpen ||
    searchPreview ||
    placement?.isActive() ||
    map.isMoving() ||
    e.originalEvent?.buttons ||
    e.originalEvent?.sourceCapabilities?.firesTouchEvents ||
    !matchMedia('(hover: hover) and (pointer: fine)').matches
  )
    return;
  if (atlas.isGround(e.point, e.lngLat)) aim.hover({lat: e.lngLat.lat, lon: wrap(e.lngLat.lng)});
}
function storeReading(probe, result) {
  const cache = heightsByPoint.get(probe.id);
  if (
    !Number.isFinite(result.elevation) &&
    cache?.lat === probe.lat &&
    cache?.lon === probe.lon &&
    Number.isFinite(cache.elevation)
  ) {
    result = {...result, elevation: cache.elevation};
  }
  readings.set(probe.id, result);
  probes.update(probe.id, {...result, heightMode: view().mode === 'height'});
  if (
    probes.active()?.id === probe.id &&
    result.elevation == null &&
    (result.status === 'unplaced' || result.status === 2 || S.failed) &&
    !cache
  ) {
    heightsByPoint.set(probe.id, {lat: probe.lat, lon: probe.lon, elevation: null});
    job.postMessage({type: 'probe-height', probeId: probe.id, lat: probe.lat, lon: probe.lon});
  }
}
function readProbe(p) {
  if (!S.point) {
    storeReading(p, {status: 'unplaced', elevation: null});
    return;
  }
  const distance = distanceToPoint(p),
    bearing = distance > 0.01 ? (headingTo(p) + 360) % 360 : null;
  if (!S.analysis) {
    storeReading(p, {
      status: distance > radius() ? 2 : S.failed ? 3 : 'pending',
      distance,
      bearing,
      elevation: null,
    });
    return;
  }
  job.postMessage({type: 'probe', id: S.id, rev: S.rev, probeId: p.id, lat: p.lat, lon: p.lon});
}
function refreshProbes() {
  if (!probes) return;
  for (const id of readings.keys())
    if (!probes.get(id)) {
      readings.delete(id);
      heightsByPoint.delete(id);
    }
  probes.invalidate(false);
  for (const p of probes.values()) readProbe(p);
}
function openProbe(p) {
  if (placement?.consumeMapPick(p)) {
    probes.close();
    return;
  }
  if (S.point) aim.set(p, {fixed: true, source: 'saved'});
  readProbe(p);
}
function status(message) {
  const summary = el('summary');
  summary.hidden = !message;
  summary.textContent = message;
}
function setObserverTools(expanded) {
  el('observer-actions').hidden = !expanded;
  el('more-toggle').setAttribute('aria-expanded', String(expanded));
  if (!expanded) {
    el('settings').hidden = true;
    el('settings-toggle').setAttribute('aria-expanded', 'false');
  }
}
function reset() {
  placement?.cancel();
  dismissSearchPreview();
  closeupCamera = null;
  beginDiscovery(null);
  S.id++;
  S.ready = false;
  S.failed = false;
  S.point = null;
  S.analysis = null;
  S.horizon = null;
  job.postMessage({type: 'cancel', id: S.id});
  closeSky();
  clearRaster();
  field?.clear();
  discoveryMap?.sector(null);
  atlas?.setMarker(null);
  observerPose();
  placement?.sync();
  refreshProbes();
  el('card').hidden = true;
  el('hint').hidden = false;
  el('sky-toggle').disabled = true;
  el('retry').hidden = true;
  setObserverTools(false);
}
function pick(p, zoom = true) {
  if (!valid(p)) return;
  placement?.cancel();
  dismissSearchPreview();
  closeupCamera = null;
  hideSearch();
  el('query').value = '';
  el('query').blur();
  if (isMadeira(p)) p = {...p, ...madeira, name: 'Pico do Arieiro', region: 'Madeira'};
  else p = {...p, lon: wrap(p.lon)};
  beginDiscovery(p);
  closeSky();
  clearRaster();
  probes?.close();
  S.horizon = null;
  el('guide').hidden = true;
  S.id++;
  S.rev = 0;
  S.point = p;
  S.ready = false;
  S.failed = false;
  S.analysis = null;
  setObserverTools(false);
  el('observer-stats').replaceChildren();
  el('card').hidden = false;
  el('hint').hidden = true;
  el('retry').hidden = true;
  el('sky-toggle').disabled = true;
  el('place').textContent = p.source === 'Coordinates' ? 'Observer' : p.name || 'Observer';
  el('location').textContent = p.region || coordinate(p);
  el('detail').textContent = coordinate(p);
  status('Loading terrain…');
  atlas.setMarker(p);
  placement?.connectMarker(atlas.observerElement());
  profilePanel?.eyeView.setObserver(p, radius(), eye());
  observerPose();
  syncCloseup();
  const ringsReady = field?.setObserver(p, radius());
  field?.setHeading(S.heading, false);
  placement?.sync();
  refreshProbes();
  if (zoom) {
    const z = zoomForRadius(radius(), p.lat);
    const current = map.getZoom(),
      zoomLevel = zoom === 'search' ? z : Math.max(current, z);
    const pitch = prefer3D ? (map.getPitch() > 12 ? map.getPitch() : SCENE_PITCH) : 0;
    const bearing = prefer3D ? (map.getPitch() > 12 ? map.getBearing() : SCENE_BEARING) : 0;
    map.stop();
    map.jumpTo({
      center: [p.lon, p.lat],
      zoom: Math.min(16, zoomLevel + (pitch > 0 && current < 5 ? 0.32 : 0)),
      pitch,
      bearing,
    });
  }
  const initial = initialAim(p);
  aim.set(initial, {fixed: false, source: 'initial'});
  job.postMessage({type: 'load', id: S.id, lat: p.lat, lon: p.lon, cachedMadeira: isMadeira(p),
    terrainIdentity: atlas.terrainIdentity()});
  return ringsReady;
}
let sliderTimer = null,
  committedSettings = null;
function syncEyeControl() {
  const control = el('height-slider'),
    h = eye();
  if (!Number.isFinite(h)) return;
  control.max = Math.max(200, Math.ceil(h / 100) * 100);
  control.value = h;
  control.setAttribute('aria-valuetext', f(h, 1) + ' meters');
}
el('height-slider').oninput = () => {
  el('eye').value = el('height-slider').value;
  syncEyeControl();
  if (!sliderTimer)
    sliderTimer = setTimeout(() => {
      sliderTimer = null;
      compute();
    }, 70);
};
el('height-slider').onchange = () => {
  clearTimeout(sliderTimer);
  sliderTimer = null;
  compute();
};
function compute() {
  if (
    !S.point ||
    ['eye', 'target-height', 'sector-bearing'].some(
      (id) => !el(id).checkValidity() || !Number.isFinite(el(id).valueAsNumber),
    )
  )
    return;
  field?.setObserver(S.point, radius());
  discoveryMap?.sector(S.point, radius(), geometry());
  profilePanel?.eyeView.setObserver(S.point, radius(), eye());
  if (!S.ready) return;
  syncEyeControl();
  const key = JSON.stringify([S.id, eye(), radius(), geometry()]);
  if (key === committedSettings && !S.failed) return;
  committedSettings = key;
  const previous = S.analysis;
  invalidateLiveProfile();
  S.rev++;
  S.analysis = null;
  S.failed = false;
  S.horizon = null;
  refreshProbes();
  clockStart = performance.now();
  discovery?.setHorizon(null);
  discovery?.setPeaks({loading: true});
  candidates.clear();
  discoveryMap?.peaks([]);
  discoveryMap?.highlight(null);
  if (previous && aim?.current()) profilePanel.pending(aim.current(), 'Updating profile…');
  el('observer-stats').replaceChildren();
  el('guide').hidden = true;
  el('sky-toggle').disabled = true;
  if (previous && rasterCount) status('Updating. The previous result is still on the map.');
  else {
    clearRaster();
    status('Calculating visibility…');
  }
  job.postMessage({
    type: 'compute',
    id: S.id,
    rev: S.rev,
    eye: eye(),
    radius: radius(),
    view: view(),
    ...geometry(),
  });
}

function stats(d) {
  const s = d.stats;
  const row = document.createElement('div');
  row.className = 'stat';
  const key = document.createElement('i'),
    num = document.createElement('strong'),
    label = document.createElement('span');
  num.textContent = f(s.visibleArea / 1e6, 2) + ' km²';
  label.textContent = 'visible · ' + f(s.visiblePercent, 1) + '%';
  row.append(key, num, label);
  status('');
  const statsPanel = el('observer-stats');
  statsPanel.replaceChildren(row);
  el('guide').hidden = false;
  el('unknown-key').hidden = s.unknownArea === 0;
  updateTip();
  updateLegend();
  const far = document.createElement('p');
  far.className = 'small';
  far.textContent = Number.isFinite(s.farthestVisible)
    ? 'Farthest visible point within radius · ' + f(s.farthestVisible / 1000, 1) + ' km'
    : 'No terrain could be evaluated';
  statsPanel.append(far);
  if (s.coverageFraction < 1) {
    const cov = document.createElement('p');
    cov.className = 'small';
    cov.textContent = 'Terrain coverage · ' + f(100 * s.coverageFraction, 1) + '%';
    statsPanel.append(cov);
  }
  const detail = [
    coordinate(S.point),
    'Terrain elevation: ' + f(d.ground, 0) + ' m',
    'Farthest visible cell: ' +
      f(s.farthestVisible / 1000, 2) +
      ' km' +
      (s.edgeVisible ? ' (at the edge of the analysis)' : ''),
  ];
  if (s.unknownArea > 0) detail.push(f(s.unknownArea / 1e6, 2) + ' km² without data');
  if (d.incomplete) detail.push('Partial coverage');
  const a = d.scenario,
    m = d.metrics;
  detail.push(
    'Area evaluated: ' +
      f(s.knownArea / 1e6, 2) +
      ' of ' +
      f(s.analyzedArea / 1e6, 2) +
      ' km², including water. The visible percentage is based on the area evaluated.',
  );
  detail.push(
    'Tileflow Terrain · Mapterhorn · ' +
      a.release +
      ' · z' +
      a.terrainZoom +
      ' · source pixel size ≈ ' +
      f(a.sourcePixelSizeM, 0) +
      ' m · 50 m overview grid.',
  );
  if (a.nearGrid?.halfExtentM) detail.push(
    'Foreground surveyed every ' + f(a.nearGrid.spacingM, 0) + ' m within a '
    + f(a.nearGrid.halfExtentM * 2, 0) + ' m square around the observer.',
  );
  if (a.nativeGrid?.zoom != null) detail.push(
    'Profiles and peak checks sample source terrain at zoom ' + a.nativeGrid.zoom + '.',
  );
  detail.push(
    'Target height: ' +
      f(a.targetHeightM, 1) +
      ' m · Earth radius: 6,371 km · curvature coefficient: ' +
      f(a.curvature, 3) +
      ' · refraction: ' +
      f(a.refraction, 3) +
      '. Depending on the region, the surface model may include vegetation and buildings.',
  );
  detail.push(
    'Local computation · ' +
      f(m.cells, 0) +
      ' cells · terrain loading and gridding: ' +
      f(m.terrainMs, 0) +
      ' ms · height thresholds: ' +
      (m.cachedHeights ? 'cached' : f(m.heightsMs, 0) + ' ms') +
      ' · classification: ' +
      f(m.classifyMs, 1) +
      ' ms · time to display: ' +
      f(performance.now() - clockStart, 0) +
      ' ms.',
  );
  if (m.gridMs != null)
    detail.push(
      'Downloaded tiles: ' +
        f(m.tileBytes / 1024, 0) +
        ' KiB · total decoding time: ' +
        f(m.tileDecodeMs, 0) +
        ' ms · grid preparation: ' +
        f(m.gridMs, 0) +
        ' ms.',
    );
  detail.push(
    'Scenario ' + a.generationId + ' · ' + a.algorithm + ' · descriptor ' + a.descriptorSha256,
  );
  el('detail').textContent = detail.join('\n');
  el('location').textContent =
    (S.point.region || coordinate(S.point)) +
    ' · Observer at ' +
    f(eye(), Number.isInteger(eye()) ? 0 : 1) +
    ' m · ' +
    a.sectorDeg.width +
    '° · ' +
    f(radius() / 1000, 0) +
    ' km';
}

function fail(msg) {
  S.ready = false;
  S.analysis = null;
  S.failed = true;
  invalidateLiveProfile();
  profilePanel?.clear();
  el('observer-stats').replaceChildren();
  discovery?.setPeaks({unavailable: true, partial: true});
  closeSky();
  clearRaster();
  refreshProbes();
  el('guide').hidden = true;
  el('sky-toggle').disabled = true;
  el('retry').hidden = false;
  let reason = msg || 'The terrain could not be loaded.';
  if (/failed to fetch|load failed|networkerror/i.test(reason))
    reason = 'Could not connect to Tileflow Terrain. Check your connection and try again.';
  status(reason);
}
job.onmessage = ({data: d}) => {
  if (d.type === 'probe-height') {
    const p = probes?.get(d.probeId);
    if (p && p.lat === d.lat && p.lon === d.lon) {
      heightsByPoint.set(p.id, {lat: p.lat, lon: p.lon, elevation: d.elevation});
      const reading = readings.get(p.id);
      if (reading && reading.elevation == null)
        storeReading(p, {...reading, elevation: d.elevation});
    } else heightsByPoint.delete(d.probeId);
    return;
  }
  if (d.id !== S.id || !S.point) return;
  if (d.type === 'ready') {
    S.ready = true;
    compute();
  } else if (d.type === 'progress' && !S.ready)
    status('Loading terrain · ' + d.done + '/' + d.total + ' tiles');
  else if (d.type === 'analysis' && d.rev === S.rev) {
    S.analysis = d;
    observerPose();
    if (sameView(d.view)) setRaster(d.parts);
    else applyRepresentation();
    stats(d);
    el('sky-toggle').disabled = false;
    scheduleLiveProfile();
    refreshProbes();
    if (S.skyOpen) requestHorizon();
  } else if (d.type === 'probe' && d.rev === S.rev) {
    const p = probes?.get(d.probeId);
    if (p) storeReading(p, d);
  } else if (d.type === 'horizon' && d.rev === S.rev) {
    S.horizon = d;
    discovery?.setHorizon(d);
  } else if (d.type === 'view' && d.rev === S.rev && sameView(d.view)) setRaster(d.parts);
  else if (d.type === 'export' && d.rev === S.rev) downloadScenario(d);
  else if (d.type === 'profile' && d.rev === S.rev && liveJob?.version === d.probeId) {
    const request = liveJob;
    liveJob = null;
    if (request.version === liveVersion) {
      const p = request.point;
      S.aimElevation = (d.status === 0 || d.status === 1) && Number.isFinite(d.angularElevationDeg)
        ? d.angularElevationDeg : 0;
      if (!S.skyOpen) profilePanel.eyeView.look(S.heading, S.aimElevation);
      profilePanel.update(
        p,
        {
          ...d,
          catalog: candidates.get(p.peakId),
          targetHeightM: S.analysis.scenario.targetHeightM,
          heightMode: view().mode === 'height',
        },
        eye(),
      );
      if (d.status === 1 && !S.skyOpen && d.distance > 0) {
        profilePanel.eyeView.validateSightline(p, S.analysis.scenario.targetHeightM, radius(), hit => {
          if (request.version === liveVersion && request.id === S.id && request.rev === S.rev) {
            profilePanel.setMeshBlocker(hit);
          }
        });
      }
    } else scheduleLiveProfile();
  } else if (d.type === 'peaks' && d.rev === S.rev) {
    candidates = new Map(d.peaks.map((p) => [p.id, p]));
    discoveryMap.peaks(d.peaks);
    discovery.setPeaks(d);
    discoveryMap.highlight(candidates.get(discovery.getSelectedId()) || null);
    S.catalog = d;
    if (d.release) {
      let dataLine = el('catalog-detail');
      if (!dataLine) {
        dataLine = document.createElement('p');
        dataLine.id = 'catalog-detail';
        dataLine.className = 'small';
        el('detail').after(dataLine);
      }
      dataLine.textContent =
        'Peaks from Tileflow World · ' +
        d.release +
        ' · z' +
        d.zoom +
        ' · ' +
        d.loadedTiles +
        '/' +
        d.totalTiles +
        ' tiles. ' +
        (d.generalized ? 'Peak selection varies with map scale. ' : '') +
        (d.notice || '');
    }
    if (aim?.current()?.peakId) {
      liveVersion++;
      scheduleLiveProfile();
    }
  } else if (d.type === 'catalog-progress' && d.rev === S.rev) {
    discovery?.setPeaks({loading: true, progress: d});
  } else if (d.type === 'error') fail(d.message);
};
job.onerror = () => {
  if (S.point) fail('The browser could not complete the visibility calculation.');
};
let hits = [],
  active = -1,
  searchNum = 0,
  searchController;
function dismissSearchPreview() {
  searchPreview = null;
  el('search-preview').hidden = true;
  searchMarker?.remove();
  searchMarker = null;
}
function previewSearch(p) {
  if (!valid(p) || !map) return;
  hideSearch();
  dismissSearchPreview();
  el('query').blur();
  probes?.close();
  discovery?.closePanels();
  searchPreview = {...p, lon: wrap(p.lon)};
  el('search-name').textContent = p.name || coordinate(p);
  el('search-look').hidden = !S.point || distanceToPoint(p) > radius();
  el('search-preview').hidden = false;
  el('query').value = p.name || coordinate(p);
  const dot = document.createElement('span');
  dot.className = 'search-location-dot';
  searchMarker = new maplibregl.Marker({element: dot, subpixelPositioning: true})
    .setLngLat([p.lon, p.lat])
    .addTo(map);
  map.stop();
  map.jumpTo({
    center: [p.lon, p.lat],
    zoom: zoomForRadius(radius(), p.lat),
    pitch: prefer3D ? SCENE_PITCH : 0,
  });
  el('search-place').focus({preventScroll: true});
}
el('search-place').onclick = () => {
  if (searchPreview) pick(searchPreview, 'search');
};
el('search-look').onclick = () => {
  const p = searchPreview;
  dismissSearchPreview();
  if (p && S.point) aim.set(p, {fixed: true, source: 'search'});
};
el('search-dismiss').onclick = dismissSearchPreview;
function hideSearch() {
  searchNum++;
  searchController?.abort();
  el('results').hidden = true;
  el('query').setAttribute('aria-expanded', 'false');
  el('query').removeAttribute('aria-activedescendant');
  active = -1;
}
function renderHits(list, msg = '') {
  hits = list.slice(0, 8);
  active = -1;
  const box = el('results');
  box.replaceChildren();
  el('query').removeAttribute('aria-activedescendant');
  hits.forEach((p, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.id = 'hit-' + i;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.tabIndex = -1;
    const name = document.createElement('b'),
      region = document.createElement('small');
    name.textContent = p.name || coordinate(p);
    region.textContent = p.region || '';
    button.append(name, region);
    button.onclick = () => previewSearch(p);
    box.append(button);
  });
  if (msg) {
    const note = document.createElement('p');
    note.className = 'result-note';
    note.textContent = msg;
    box.append(note);
  }
  box.hidden = false;
  el('query').setAttribute('aria-expanded', 'true');
}
function localSearch() {
  dismissSearchPreview();
  searchNum++;
  searchController?.abort();
  const q = el('query').value.trim();
  renderHits(
    q ? PeakSearch.local(q) : PeakSearch.scenarios,
    q ? 'Press Enter to search OpenStreetMap as well.' : '',
  );
}
async function search() {
  if (active >= 0 && hits[active]) {
    previewSearch(hits[active]);
    return;
  }
  const q = el('query').value.trim();
  if (!q) {
    el('query').focus();
    localSearch();
    return;
  }
  const match = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (match) {
    const p = {lat: Number(match[1]), lon: Number(match[2])};
    if (valid(p) && Math.abs(p.lon) <= 180) previewSearch(p);
    else
      renderHits(
        [],
        'Enter a latitude between −85.05° and 85.05° and a longitude between −180° and 180°.',
      );
    return;
  }
  searchController?.abort();
  searchController = new AbortController();
  const n = ++searchNum;
  renderHits(PeakSearch.local(q), 'Searching…');
  try {
    const results = await PeakSearch.search(q, {signal: searchController.signal});
    if (n !== searchNum) return;
    renderHits(
      results,
      results.length ? '' : 'No results. Try coordinates or place the observer on the map.',
    );
  } catch (e) {
    if (n === searchNum)
      renderHits(
        PeakSearch.local(q),
        'Online search is unavailable. You can still place the observer on the map.',
      );
  }
}
el('query').onfocus = el('query').oninput = localSearch;
el('search').onsubmit = (e) => {
  e.preventDefault();
  search();
};
el('query').onkeydown = (e) => {
  if (e.key === 'Escape') {
    hideSearch();
    el('query').blur();
    return;
  }
  if (!['ArrowUp', 'ArrowDown'].includes(e.key) || !hits.length || el('results').hidden) return;
  e.preventDefault();
  active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
  for (const [i, b] of Array.from(el('results').querySelectorAll('.option')).entries()) {
    b.classList.toggle('active', i === active);
    b.setAttribute('aria-selected', String(i === active));
  }
  const b = el('hit-' + active);
  el('query').setAttribute('aria-activedescendant', b.id);
  b.scrollIntoView({block: 'nearest'});
};
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.top')) hideSearch();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || e.target === el('query')) return;
  if (searchPreview) {
    dismissSearchPreview();
    return;
  }
  if (placement?.isActive()) {
    placement.cancel();
    return;
  }
  if (probes?.active()) {
    probes.close();
    return;
  }
  if (!el('observer-actions').hidden) {
    setObserverTools(false);
    el('more-toggle').focus({preventScroll: true});
    return;
  }
  if (aim?.isFixed()) aim.setFixed(false);
});
for (const id of ['eye', 'radius', 'target-height', 'curvature', 'sector-bearing'])
  el(id).onchange = compute;
el('sector-width').onchange = () => {
  el('sector-row').hidden = geometry().sectorWidth === 360;
  compute();
};
el('more-toggle').onclick = () => setObserverTools(el('observer-actions').hidden);
el('settings-toggle').onclick = () => {
  el('settings').hidden = !el('settings').hidden;
  el('settings-toggle').setAttribute('aria-expanded', String(!el('settings').hidden));
};
function requestHorizon() {
  if (S.analysis) job.postMessage({type: 'horizon', id: S.id, rev: S.rev});
}
el('close').onclick = () => {
  reset();
  el('place-person').focus({preventScroll: true});
};
el('retry').onclick = () => {
  if (S.point) pick(S.point, false);
};
el('plus').onclick = () => map?.zoomIn();
el('minus').onclick = () => map?.zoomOut();
function syncCloseup() {
  const near = map?.getZoom() >= 19;
  const label = near ? 'Overview' : 'Close-up';
  el('closeup').querySelector('span').textContent = label;
  el('closeup').title = near ? 'Return to the previous view' : 'Zoom in on the observer';
  if (S.analysis) updateTip();
}
function framePerson() {
  if (!map || !S.point) return;
  placement?.cancel();
  probes?.close();
  if (map.getZoom() >= 19) {
    const previous = closeupCamera || {
      center: [S.point.lon, S.point.lat],
      zoom: 13.3,
      pitch: SCENE_PITCH,
      bearing: SCENE_BEARING,
    };
    closeupCamera = null;
    map.stop();
    map.jumpTo(previous);
    syncCloseup();
    return;
  }
  const c = map.getCenter();
  closeupCamera = {
    center: [c.lng, c.lat],
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
  };
  map.stop();
  map.jumpTo({
    center: [S.point.lon, S.point.lat],
    zoom: 21.85,
    pitch: 68,
    bearing: S.heading + 115,
  });
  prefer3D = true;
  syncCloseup();
}
el('closeup').onclick = () => {
  setObserverTools(false);
  framePerson();
  el('more-toggle').focus({preventScroll: true});
};
function placementMode(mode) {
  placementState = mode;
  const active = mode !== 'idle';
  document.body.dataset.placement = mode;
  el('world').classList.toggle('is-placing', active);
  observerModel?.setPlacementHidden(active);
  syncPlacementLayers();
  const hint = el('placement-status');
  hint.hidden = !active;
  hint.textContent =
    mode === 'armed'
      ? 'Tap the terrain to place the observer. Press Esc to cancel.'
      : mode === 'dragging'
        ? 'Drop the observer on the terrain.'
        : '';
  if (active) map?.stop();
}
function dropObserver(point) {
  // pick() releases pointer capture. Reserve this transition first so idle cannot
  // briefly paint the old rings, even when a previous drop is still being indexed.
  const token = {};
  pendingDropRings = token;
  const rings = pick(point, map.getZoom() < 7 ? 'search' : false);
  function finish() {
    if (pendingDropRings !== token) return;
    pendingDropRings = null;
    syncPlacementLayers();
  }
  Promise.resolve(rings).then(finish, finish);
}
function cameraControls() {
  if (!map) return;
  const tilted = map.getPitch() > 5;
  if (lastPerspective === tilted) return;
  lastPerspective = tilted;
  el('dimension').textContent = tilted ? '2D' : '3D';
  const label = tilted ? 'Switch to a 2D overhead view' : 'View terrain in 3D';
  el('dimension').title = label;
  el('dimension').setAttribute('aria-label', label);
}
el('dimension').onclick = () => {
  if (!map) return;
  prefer3D = map.getPitch() <= 5;
  if (prefer3D && map.getZoom() < 5 && S.point) {
    map.easeTo({
      center: [S.point.lon, S.point.lat],
      zoom: zoomForRadius(radius(), S.point.lat),
      pitch: SCENE_PITCH,
      bearing: SCENE_BEARING,
    });
    return;
  }
  map.easeTo({
    pitch: prefer3D ? SCENE_PITCH : 0,
    bearing: prefer3D ? map.getBearing() || SCENE_BEARING : 0,
    duration: 380,
  });
};
el('orbit').onclick = () => {
  if (map) map.easeTo({bearing: map.getBearing() + 45, duration: 400});
};
el('globe').onclick = () => {
  hideSearch();
  dismissSearchPreview();
  probes?.close();
  atlas?.fitWorld();
};
try {
  const sceneZoom = zoomForRadius(radius(), madeira.lat);
  atlas = createWorldMap(el('world'), {
    peaks: PeakSearch.scenarios,
    center: [madeira.lon, madeira.lat],
    zoom: sceneZoom,
    pitch: SCENE_PITCH,
    bearing: SCENE_BEARING,
    onPick,
  });
  map = atlas.map;
  map.on('pitch', cameraControls);
  map.on('zoomend', syncCloseup);
  cameraControls();
  placement = ObserverPlacement.bind({
    map,
    atlas,
    handle: el('place-person'),
    onMode: placementMode,
    hasObserver: () => !!S.point,
    onRemove: reset,
    onPlace: dropObserver,
  });
  map.on('mousemove', inspectMove);
  atlas.ready.then(() => {
    styleReady = true;
    field = FieldGuide.attach(map, atlas.beforeLabels);
    discoveryMap = DiscoveryMap.attach(map, atlas.beforeLabels);
    profilePanel = TerrainProfile.attach({
      onTry: (h) => {
        el('eye').value = h;
        aim.setFixed(true);
        compute();
      },
      onSave: saveAim,
      onToggleFixed: () => aim?.setFixed(!aim.isFixed()),
      onTrace: (points, g) => discoveryMap.trace(points, g),
      onHover: (p) => discoveryMap.hover(p),
    });
    aim = LiveAim.attach(map, {
      atlas,
      onAim: aimChanged,
      onLockChange: (fixed) => profilePanel.setFixed(fixed),
    });
    discovery = DiscoveryPanel.attach({
      map,
      onChoose: choosePeak,
      onHeading: (a) => setHeading(a, true),
      onHorizonRequest: requestHorizon,
      onPeek: (p) => discoveryMap.highlight(p || candidates.get(discovery.getSelectedId()) || null),
      onSkyChange: (open) => {
        S.skyOpen = open;
        profilePanel.setCovered(open);
        if (open) probes?.close();
        else aimHeading();
        updateTip();
      },
      onTerrainPick: (p) => {
        closeSky();
        if (p && S.point) aim.set(p, {fixed: true, source: 'horizon'});
      },
    });
    probes = MapProbes.attach(map, {
      onInspect: openProbe,
      onProfile: (p) => {
        probes.close();
        aim.set(p, {fixed: true, source: 'saved'});
        profilePanel.setCollapsed(false);
      },
      onPromote: (p) => {
        probes.remove(p.id);
        pick(p, map.getZoom() < 7 ? 'search' : false);
      },
    });
    if (S.point) field.setObserver(S.point, radius());
    if (pendingParts) setRaster(pendingParts);
    observerModel = Observer3D.createLayer(atlas.observerElement());
    map.addLayer(observerModel);
    atlas.setObserverModelVisible?.(true);
    placement.connectMarker(atlas.observerElement());
    el('place-person').disabled = false;
    observerPose();
    lastPerspective = null;
    cameraControls();
    if (!S.point) pick(PeakSearch.scenarios[0], false);
  });
} catch (e) {
  el('hint').textContent = 'Open this map in a browser that supports WebGL 2.';
  el('query').disabled = true;
  console.error(e);
}
