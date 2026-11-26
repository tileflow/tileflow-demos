import {LngLat, Map, MercatorCoordinate} from 'maplibre-gl';
import {outdoorsStyle} from './world-map';
import {applyObserverCamera} from './observer-map-camera';

const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Project the geographic target at its actual height through the same camera
// matrices as the renderer. This ray intersects only drawn terrain. A screen
// coordinate unprojected onto the map's fallback plane is not an obstruction.
function nearerSlope(map, origin, {target, targetHeight, maxDistance}) {
  const terrain = map.terrain;
  const tr = map._camera.transform;
  const distance = origin.distanceTo(target);
  if (distance <= 10 || distance > maxDistance || !terrain?.getCoverageIndex()) return null;
  const surface = terrain.getDrawnElevationForLngLat(target, true);
  if (!Number.isFinite(surface) || !Number.isFinite(terrain.getDrawnElevationForLngLat(origin, true))) return null;
  const world = MercatorCoordinate.fromLngLat(target);
  const cameraWorld = MercatorCoordinate.fromLngLat(origin);
  world.x += Math.round(cameraWorld.x - world.x);
  const altitude = surface + targetHeight;
  const edgeMargin = Math.max(10, distance * .02);
  function hitAt(elevation) {
    const pixel = tr.coordinatePoint(world, elevation, tr._pixelMatrix3D);
    if (!(pixel.x >= 1 && pixel.x < tr.width - 1 && pixel.y >= 1 && pixel.y < tr.height - 1)) return null;
    const hit = tr.screenTerrainPointToMercatorCoordinate(pixel, terrain);
    if (!hit) return null;
    const where = hit.toLngLat().wrap();
    const distanceM = origin.distanceTo(where);
    if (distanceM >= distance - edgeMargin || !Number.isFinite(terrain.getDrawnElevationForLngLat(where, true))) return null;
    return {distanceM, where};
  }
  const first = hitAt(altitude);
  if (!first) return null;
  // A barely tangent ray or the target's own slope is ambiguous. Require a
  // second ray slightly above the target to hit the same foreground feature.
  const higher = hitAt(altitude + Math.max(1, distance * Math.tan(.15 * Math.PI / 180)));
  if (!higher || Math.abs(higher.distanceM - first.distanceM) > Math.max(10, first.distanceM * .08)) return null;
  // A nearer part of the ray may cross a hole. Require coverage (with the
  // drawn tiles' own DEM) up to the obstruction before describing its range.
  const hitWorld = MercatorCoordinate.fromLngLat(first.where);
  const dx = hitWorld.x - cameraWorld.x - Math.round(hitWorld.x - cameraWorld.x);
  const dy = hitWorld.y - cameraWorld.y;
  const steps = Math.ceil(first.distanceM / 25);
  for (let i = 1; i < steps; i++) {
    const at = new MercatorCoordinate(cameraWorld.x + dx * i / steps, cameraWorld.y + dy * i / steps).toLngLat().wrap();
    if (!Number.isFinite(terrain.getDrawnElevationForLngLat(at, true))) return null;
  }
  return {distanceM: first.distanceM, coordinate: {lon: first.where.lng, lat: first.where.lat}};
}

export function createObserverView(container) {
  const panel = document.createElement('div');
  panel.className = 'eye-panel';
  panel.innerHTML = `
    <div class="eye-frame" id="observer-map-frame" aria-hidden="true">
      <div class="eye-map" inert></div>
      <span class="eye-message" hidden></span>
    </div>
    <button class="observer-view" type="button" aria-controls="observer-map-frame" aria-expanded="false">
      <svg class="eye-expand" viewBox="0 0 20 20" aria-hidden="true">
        <path class="eye-size-icon" d="M4 8V4h4m4 0h4v4M16 12v4h-4m-4 0H4v-4"/>
        <path class="eye-chevron" d="m5 12 5-5 5 5"/>
      </svg>
      <span class="eye-caption"><span>Observer map</span><span class="eye-compass"></span></span>
    </button>`;
  container.append(panel);
  const viewport = panel.querySelector('.eye-map');
  const message = panel.querySelector('.eye-message');
  const button = panel.querySelector('.observer-view');
  const direction = panel.querySelector('.eye-compass');
  const mobile = matchMedia('(max-width: 820px)');
  let point = null, radius = 0, bearing = 0, eyeHeight = 1.7, elevationAngle = 0;
  let map = null, frame = 0, expanded = false, failed = false;
  let mapWidth = 0, mapHeight = 0;
  let anchored = false, sampledGround = null, verified = false;
  let basemapDrawn = false;
  let sightline = null, sightFrame = 0;

  function queueSightline() {
    if (!sightline || sightFrame) return;
    sightFrame = requestAnimationFrame(() => {
      sightFrame = 0;
      if (!sightline) return;
      const evidence = point && map && verified && panel.dataset.mapState === 'ready' && map.loaded()
        ? nearerSlope(map, point, sightline) : null;
      const rounded = evidence ? Math.round(evidence.distanceM * 10) : null;
      if (rounded !== sightline.last) {
        sightline.last = rounded;
        sightline.report(evidence);
      }
    });
  }

  function state(value, text = '') {
    if (panel.dataset.mapState === value && message.textContent === text) return;
    panel.dataset.mapState = value;
    viewport.style.visibility = value === 'ready' ? 'visible' : 'hidden';
    queueSightline();
    message.textContent = text;
    message.hidden = !text;
  }

  function updateDirection() {
    const degrees = Math.round(bearing) % 360;
    direction.textContent = `${compass[Math.round(bearing / 45) % 8]} ${degrees}°`;
    panel.dataset.heading = String(bearing);
  }

  function updateButton() {
    container.classList.toggle('eye-expanded', expanded);
    button.setAttribute('aria-expanded', String(expanded));
    const action = mobile.matches ? (expanded ? 'Close' : 'Open') : (expanded ? 'Reduce' : 'Expand');
    button.setAttribute('aria-label', action + ' observer map');
    button.title = action + ' observer map';
  }

  function invalidatePose() {
    verified = false;
    for (const key of ['groundElevation', 'cameraAltitude', 'cameraPitch', 'cameraLat', 'cameraLon']) delete panel.dataset[key];
    if (!mobile.matches || expanded) state('loading', 'Positioning view…');
  }

  function terrainAtObserver() {
    // queryTerrainElevation alone returns zero for missing DEM and for sea level.
    return map?.terrain?.getElevationAndDEMStateForLngLat(point, Math.max(0, Math.floor(map.getZoom())));
  }

  function matchesEyeCamera() {
    const tr = map._camera.transform, eye = tr.getCameraLngLat();
    const lonDelta = ((eye.lng - point.lng + 540) % 360) - 180;
    const horizontalM = 111195 * Math.hypot(eye.lat - point.lat, lonDelta * Math.cos(point.lat * Math.PI / 180));
    const tolerance = Math.max(.002, Math.min(.1, eyeHeight * .1));
    return horizontalM < .1 && Math.abs(tr.getCameraAltitude() - sampledGround - eyeHeight) < tolerance
      && Math.abs(tr.pitch - 90 - elevationAngle) < .1 && Math.abs(((tr.bearing - bearing + 540) % 360) - 180) < .1;
  }

  function terrainFrame() {
    if (!point || !map || (mobile.matches && !expanded) || !anchored) return;
    const sample = terrainAtObserver();
    if (sample?.demState !== 'loaded') {
      state('loading', 'Loading terrain…');
      return;
    }
    if (sampledGround === null || Math.abs(sample.elevation - sampledGround) > .002) {
      if (sampledGround !== null && Math.abs(sample.elevation - sampledGround) > .1) {
        state('loading', 'Updating terrain…');
      }
      schedule();
      return;
    }
    if (verified && !matchesEyeCamera()) {
      invalidatePose();
      schedule();
      return;
    }
    if (verified && (basemapDrawn || (map.isSourceLoaded('tileflow') && map.isSourceLoaded('tileflow-terrain')))) {
      basemapDrawn = true;
      state('ready');
    }
  }

  function refresh() {
    frame = 0;
    if (!point || failed || (mobile.matches && !expanded)) return;
    const width = viewport.clientWidth, height = viewport.clientHeight;
    if (!width || !height) return;
    const resized = mapWidth !== width || mapHeight !== height;
    mapWidth = width;
    mapHeight = height;
    if (map) {
      if (resized) map.resize();
      if (!anchored) {
        // Load the DEM at the new point before displaying a camera. The survey
        // frame stays hidden and is never presented as the observer's view.
        anchored = true;
        map.jumpTo({center: point, zoom: 14, pitch: 0, bearing: 0, elevation: 0});
        return;
      }
      const sample = terrainAtObserver();
      if (sample?.demState !== 'loaded') return;
      sampledGround = sample.elevation;
      const applied = applyObserverCamera(map, {
        point: {lon: point.lng, lat: point.lat}, bearing, radius,
        groundElevation: sampledGround, eyeHeight, height, elevationAngle,
      });
      // A steep foreground may trigger collision compensation. Check the
      // approved transform both here and in the actual render callback.
      verified = matchesEyeCamera();
      panel.dataset.groundElevation = String(sampledGround);
      panel.dataset.cameraAltitude = String(applied.altitudeM);
      panel.dataset.cameraPitch = String(applied.pitch);
      panel.dataset.cameraLat = String(applied.latitude);
      panel.dataset.cameraLon = String(applied.longitude);
      if (!verified) state('unavailable', eyeHeight === 0
        ? 'At ground level · increase observer height' : 'Eye-level view unavailable here');
      return;
    }

    state('loading', 'Loading terrain…');
    anchored = true;
    try {
      map = new Map({
        container: viewport,
        style: outdoorsStyle(),
        center: point, zoom: 14, pitch: 0,
        centerClampedToGround: false, maxPitch: 180, maxZoom: 24,
        interactive: false,
        trackResize: false,
        attributionControl: false, // Both Outdoors views share the attribution on the main map.
        fadeDuration: 0,
        canvasContextAttributes: {antialias: false, powerPreference: 'low-power'},
        localIdeographFontFamily: 'sans-serif',
      });
    } catch {
      failed = true;
      viewport.replaceChildren();
      state('unavailable', 'Map unavailable');
      return;
    }
    const instance = map;
    instance.on('webglcontextlost', () => {
      if (map === instance) state('unavailable', 'Map unavailable');
    });
    instance.on('webglcontextrestored', () => {
      if (map === instance) { state('loading', 'Loading terrain…'); schedule(); }
    });
    instance.on('error', (event) => {
      // Unavailable optional tiles (e.g. a trail tile over the sea) do not
      // prevent the world and terrain sources from drawing the map.
      if (map === instance && !event.tile && ['tileflow', 'tileflow-terrain'].includes(event.sourceId)) {
        state('unavailable', 'Map data unavailable');
      }
    });
    instance.on('sourcedata', (event) => {
      // A neighbouring tile can change near-plane clearance without changing
      // the ground sample at the eye. Recheck once that tile has arrived.
      if (map === instance && !verified && sampledGround !== null
        && event.sourceId === 'tileflow-terrain' && event.sourceDataType === 'content') schedule();
    });
    instance.on('render', () => { if (map === instance) terrainFrame(); });
    instance.on('idle', () => {
      if (map !== instance || !point || !anchored || (mobile.matches && !expanded)) return;
      if (terrainAtObserver()?.demState === 'none') state('unavailable', 'Elevation data unavailable here');
      else terrainFrame();
      queueSightline();
    });
  }

  function schedule() {
    if (!frame && point && (!mobile.matches || expanded)) frame = requestAnimationFrame(refresh);
  }

  function expand(on) {
    expanded = on;
    updateButton();
    if (mobile.matches && !on) state('closed');
    else {
      if (panel.dataset.mapState === 'closed') state('loading', 'Loading map…');
      schedule();
    }
  }

  button.onclick = () => expand(!expanded);
  button.onkeydown = (event) => {
    if (event.key === 'Escape' && expanded) {
      event.stopPropagation();
      expand(false);
    }
  };
  mobile.addEventListener('change', () => expand(false));
  new ResizeObserver(schedule).observe(viewport);

  return {
    clear(reset = true) {
      point = null;
      sightline = null;
      cancelAnimationFrame(sightFrame);
      sightFrame = 0;
      cancelAnimationFrame(frame);
      frame = 0;
      const removed = map;
      map = null;
      removed?.remove();
      failed = false;
      verified = anchored = basemapDrawn = false;
      sampledGround = null;
      if (reset) { expanded = false; bearing = elevationAngle = 0; }
      panel.hidden = true;
      for (const key of ['observerLat', 'observerLon', 'radiusM', 'heading', 'eyeHeight', 'groundElevation', 'cameraAltitude', 'cameraPitch', 'cameraLat', 'cameraLon']) delete panel.dataset[key];
      direction.textContent = '';
      button.disabled = true;
      updateButton();
      state('closed');
    },
    setObserver(position, radiusMeters, eyeHeightMeters = 1.7) {
      const moved = !point || point.lng !== position.lon || point.lat !== position.lat;
      const changed = moved || radiusMeters !== radius || eyeHeightMeters !== eyeHeight;
      point = new LngLat(position.lon, position.lat);
      radius = radiusMeters;
      eyeHeight = eyeHeightMeters;
      panel.dataset.eyeHeight = String(eyeHeight);
      panel.dataset.observerLon = String(point.lng);
      panel.dataset.observerLat = String(point.lat);
      panel.dataset.radiusM = String(radius);
      panel.hidden = false;
      button.disabled = false;
      updateButton();
      updateDirection();
      if (!changed) return;
      invalidatePose();
      if (moved) {
        sightline = null;
        failed = anchored = basemapDrawn = false;
        sampledGround = null;
      }
      if (mobile.matches && !expanded) state('closed');
      else if (moved) state('loading', 'Loading terrain…');
      schedule();
    },
    look(heading, targetAngle = 0) {
      if (!Number.isFinite(heading)) return;
      const normalized = ((heading % 360) + 360) % 360;
      const angle = Number.isFinite(targetAngle) ? targetAngle : 0;
      if (bearing === normalized && elevationAngle === angle) return;
      elevationAngle = angle;
      bearing = normalized;
      if (point) { invalidatePose(); updateDirection(); schedule(); }
    },
    validateSightline(target, targetHeightM, maxDistanceM, onResult) {
      sightline = target ? {
        target: new LngLat(target.lon, target.lat), targetHeight: targetHeightM,
        maxDistance: maxDistanceM, report: onResult, last: undefined,
      } : null;
      queueSightline();
    },
  };
}
