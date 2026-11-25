import * as maplibregl from 'maplibre-gl';
import {maxObserverHeight, observerModelOpacity, observerSymbolHeight} from './observer-3d';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {registerTileflowContourProtocol} from '@tileflow/core/internal';
import {registerSummitSymbols} from './summit-symbols';

maplibregl.setWorkerUrl(mapWorkerUrl);
registerTileflowContourProtocol(maplibregl);
const detailCredit =
  '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a> · <a href="https://www.naturalearthdata.com/">Natural Earth</a>';

let official = null;

// The Tileflow Vite plugin compiles Outdoors from tileflow.config.ts and serves it with the
// app, so the style always matches the SDK release the demo installs.
export async function loadOutdoorsStyle() {
  if (official) return;
  const manifestUrl = new URL(import.meta.env.BASE_URL + 'tileflow/manifest.json', window.location.origin);
  const manifest = await (await fetch(manifestUrl)).json();
  const map = manifest.maps.visibility;
  const styleUrl = new URL(map.themes[map.defaultTheme].styleUrl, manifestUrl);
  const style = await (await fetch(styleUrl)).json();
  if (typeof style.sprite === 'string') style.sprite = new URL(style.sprite, styleUrl).href;
  // Sightlines are measured on real heights, so the rendered ground is not exaggerated.
  if (style.terrain) style.terrain.exaggeration = 1;
  official = style;
}

export function outdoorsStyle() {
  if (!official) throw new Error('Load the Outdoors style before creating a map.');
  return structuredClone(official);
}

function buildStyle(peaks) {
  const style = outdoorsStyle();
  const features = peaks
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => ({
      type: 'Feature',
      properties: {name: p.name, region: p.region || '', exactLat: p.lat, exactLon: p.lon},
      geometry: {type: 'Point', coordinates: [p.lon, p.lat]},
    }));
  style.sources['atlas-peaks'] = {type: 'geojson', data: {type: 'FeatureCollection', features}};
  style.layers.push({
    id: 'atlas-peak-points',
    source: 'atlas-peaks',
    type: 'symbol',
    maxzoom: 10,
    layout: {
      'icon-image': 'explorer-summit-atlas',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 0, 0.58, 5, 0.72, 10, 0.9],
      'icon-padding': 1,
      'icon-pitch-alignment': 'viewport',
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 0, 10, 8, 13],
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-optional': true,
    },
    paint: {'text-color': '#3f4643', 'text-halo-color': '#fffefa', 'text-halo-width': 1.5},
  });
  return style;
}
export function createWorldMap(container, options = {}) {
  const {peaks = [], onPick, center = [0, 24], zoom = 1.3, pitch = 0, bearing = 0} = options;
  const map = new maplibregl.Map({
    container,
    center,
    zoom,
    pitch,
    bearing,
    minZoom: -1.5,
    maxZoom: 22,
    style: buildStyle(peaks),
    canvasContextAttributes: {antialias: false, powerPreference: 'low-power'},
    attributionControl: {compact: true, customAttribution: detailCredit},
    dragRotate: true,
    pitchWithRotate: true,
    touchZoomRotate: true,
    touchPitch: true,
    maxPitch: 72,
    renderWorldCopies: true,
    fadeDuration: 80,
    localIdeographFontFamily: 'sans-serif',
  });
  map.once('style.load', () => registerSummitSymbols(map));
  // In portrait the whole world is narrower than the viewport is tall. Preserve the
  // requested scale while constraining its center to the Mercator latitude range.
  map.setTransformConstrain((center, requested) => {
    const z = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), requested));
    const half = Math.min(0.5, map.getContainer().clientHeight / (1024 * 2 ** z));
    const lat = (Math.max(-85.05112878, Math.min(85.05112878, center.lat)) * Math.PI) / 180;
    const y = Math.max(half, Math.min(1 - half, (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2));
    return {
      center: new maplibregl.LngLat(
        center.lng,
        (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
      ),
      zoom: z,
    };
  });

  const peakLayers = [
    'atlas-peak-points',
    'tileflow-landform-peak',
    'tileflow-landform-volcano',
  ];
  const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
  function nearbyPeak(point) {
    if (!map.isStyleLoaded() && !map.getLayer('atlas-peak-points')) return null;
    const candidates = map.queryRenderedFeatures(
      [
        [point.x - 5, point.y - 5],
        [point.x + 5, point.y + 5],
      ],
      {layers: peakLayers},
    );
    if (!candidates.length) return null;
    return candidates
      .filter((f) => f.geometry.type === 'Point')
      .sort((a, b) => {
        const pixelDistance = (f) => {
          const c = f.geometry.coordinates,
            lon = c[0] + 360 * Math.round((map.getCenter().lng - c[0]) / 360),
            p = map.project([lon, c[1]]);
          return Math.hypot(p.x - point.x, p.y - point.y);
        };
        return pixelDistance(a) - pixelDistance(b);
      })[0];
  }
  function isGround(point, lngLat = map.unproject(point)) {
    if (
      !lngLat ||
      !Number.isFinite(lngLat.lat) ||
      !Number.isFinite(lngLat.lng) ||
      Math.abs(lngLat.lat) > 85.05112878
    )
      return false;
    // A ray falling above the horizon can unproject onto the plane behind the camera.
    // With the terrain active, both public conversions use the rendered DEM.
    if (!map.getPitch()) return true;
    const projected = map.project(lngLat);
    return Math.hypot(projected.x - point.x, projected.y - point.y) < 5;
  }
  function terrainIdentity() {
    const endpoint = map.getSource('tileflow-terrain')?.tiles?.[0];
    if (!endpoint) return null;
    const url = new URL(endpoint);
    const match = url.pathname.match(/\/tiles\/terrain\/([^/]+)\//);
    const descriptorSha256 = url.searchParams.get('terrainDescriptorSha256');
    return match && descriptorSha256 ? {release: match[1], descriptorSha256} : null;
  }
  const emitPick = (point, lngLat) => {
    if (!isGround(point, lngLat)) return;
    const ground = {lat: lngLat.lat, lon: wrap(lngLat.lng), name: '', region: ''};
    const candidate = nearbyPeak(point);
    if (!candidate) {
      onPick?.(ground, ground);
      return;
    }
    const [lon, lat] = candidate.geometry.coordinates,
      p = candidate.properties;
    onPick?.(
      {
        lat: p.exactLat ?? lat,
        lon: p.exactLon ?? wrap(lon),
        name: p.name_en || p.name || p.name_latin || '',
        region: p.region || '',
      },
      ground,
    );
  };
  map.on('click', (e) => {
    if (!hiker.contains(e.originalEvent?.target)) emitPick(e.point, e.lngLat);
  });
  map.on('mousemove', (e) => {
    if (!map.isMoving()) map.getCanvas().style.cursor = nearbyPeak(e.point) ? 'pointer' : '';
  });
  const canvas = map.getCanvas();
  canvas.setAttribute(
    'aria-label',
    'World map. Use the arrow keys to pan, plus and minus to zoom, and Enter to select the center.',
  );
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const centerPixel = map.project(map.getCenter());
      emitPick(centerPixel, map.unproject(centerPixel));
    }
  });
  function fitWorld() {
    map.fitBounds(
      [
        [-179.5, -58],
        [179.5, 80],
      ],
      {
        padding: {left: 16, right: 16, top: 34, bottom: 34},
        duration: 450,
        maxZoom: 2.1,
        pitch: 0,
        bearing: 0,
      },
    );
  }
  // The marker owns only its appearance. The application owns pointer capture,
  // keyboard movement and recalculation after a completed drag.
  const hiker = document.createElement('button');
  hiker.type = 'button';
  hiker.className = 'tileflow-hiker';
  hiker.ariaLabel = 'Observer. Drag to move to a new location.';
  hiker.title = 'Move observer';
  hiker.draggable = false;
  hiker.innerHTML = `<span class="hiker-visual" aria-hidden="true">
    <span class="hiker-far-disc"></span><span class="hiker-ground"></span>
    <svg class="hiker-direction" viewBox="-16 -10 32 16" focusable="false"><path class="hiker-arrow" fill="#215c50" stroke="#fff7dd" stroke-width="1.1" stroke-linejoin="round"/></svg>
    <img class="hiker-person" src="${new URL('./assets/observer-portrait.png', import.meta.url).href}" width="150" height="190" alt="" draggable="false"></span>`;
  const headingArrow = hiker.querySelector('.hiker-arrow');
  const marker = new maplibregl.Marker({
    element: hiker,
    anchor: 'bottom',
    subpixelPositioning: true,
    opacityWhenCovered: 0,
  });
  let markerOnMap = false,
    observerPosition = null,
    observerBearing = 65,
    modelVisible = false;
  const clampUnit = (v) => Math.max(0, Math.min(1, v));
  function updateHiker() {
    if (!markerOnMap || !observerPosition) return;
    const zoom = map.getZoom(),
      pitch = (map.getPitch() * Math.PI) / 180;
    const angle = ((observerBearing - map.getBearing()) * Math.PI) / 180;
    const sx = Math.sin(angle),
      sy = -Math.cos(angle) * Math.cos(pitch);
    // The chevron is foreshortened into the terrain plane, while the figure
    // stands upright in the viewport just as the distant 3D model does.
    const direction = Math.atan2(sy, sx);
    const calc = (along, across) =>
      [
        (along * Math.cos(direction) - across * Math.sin(direction)).toFixed(2),
        (along * Math.sin(direction) + across * Math.cos(direction)).toFixed(2),
      ].join(' ');
    headingArrow.setAttribute(
      'd',
      'M' + calc(13, 0) + 'L' + calc(7, 2.4) + 'L' + calc(7, -2.4) + 'Z',
    );
    hiker.style.setProperty('--hiker-facing', sx < 0 ? '-1' : '1');
    hiker.style.setProperty('--hiker-disc', String(clampUnit((8.5 - zoom) / 1.4)));
    const symbolHeight = observerSymbolHeight(zoom);
    hiker.style.setProperty('--hiker-height', symbolHeight + 'px');
    const fade = modelVisible ? observerModelOpacity(zoom, map.getPitch()) : 0;
    hiker.style.setProperty('--hiker-opacity', String(1 - fade));
    const pxPerM =
      (512 * 2 ** zoom) /
      (40030228.884 * Math.max(0.07, Math.cos((observerPosition.lat * Math.PI) / 180)));
    const modelHeight = Math.min(maxObserverHeight, pxPerM * 1.8 * Math.sin(pitch));
    const hitHeight = Math.max(symbolHeight, modelHeight * fade);
    hiker.style.setProperty('--hiker-hit-width', Math.max(44, hitHeight * 0.62 + 6) + 'px');
    hiker.style.setProperty('--hiker-hit-height', Math.max(44, hitHeight + 7) + 'px');
  }
  map.on('zoom', updateHiker);
  map.on('rotate', updateHiker);
  map.on('pitch', updateHiker);
  function setMarker(position) {
    observerPosition = position;
    if (!position) {
      if (markerOnMap) marker.remove();
      markerOnMap = false;
      return;
    }
    marker.setLngLat([position.lon, position.lat]);
    if (!markerOnMap) {
      marker.addTo(map);
      markerOnMap = true;
    }
    updateHiker();
  }
  function setObserverBearing(degrees) {
    if (!Number.isFinite(degrees)) return;
    observerBearing = degrees;
    updateHiker();
  }
  function setObserverModelVisible(visible) {
    modelVisible = Boolean(visible);
    updateHiker();
  }
  const ready = new Promise((resolve) => map.once('style.load', () => resolve(map)));
  return {
    map,
    ready,
    setMarker,
    observerElement: () => hiker,
    setObserverBearing,
    setObserverModelVisible,
    isGround,
    terrainIdentity,
    resize: () => map.resize(),
    fitWorld,
    flyTo: (p, z) => map.flyTo({center: [p.lon, p.lat], zoom: z ?? map.getZoom(), duration: 650}),
    beforeLabels: 'tileflow-labels-render-ferry',
  };
}
