import {coverageInterval, heading, segmentProjection, turn} from './route-track.js';

// Index the road layer already loaded by Streets. Small metric cells keep a camera frame local.
const latitudeStep = 45 / 111195,
  longitudeStep = latitudeStep / Math.cos((60.2 * Math.PI) / 180);
const cellX = (x) => Math.floor(x / longitudeStep),
  cellY = (y) => Math.floor(y / latitudeStep);
const allowed = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'street',
  'minor',
  'service',
  'busway',
  'bus_guideway',
]);
function oneWayDirection(value) {
  if (value === -1 || value === '-1' || value === 'reverse') return -1;
  return value === true || value === 1 || value === '1' || value === 'yes' || value === 'true' ? 1 : 0;
}

export function carriagewayIndex(features) {
  const cells = new Map();
  for (const f of features) {
    const p = f.properties;
    if (!allowed.has(p.class) || p.indoor || p.access === 'private' || p.access === 'no') continue;
    const g = f.geometry;
    const direction = oneWayDirection(p.oneway);
    const parts =
      g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of parts)
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1],
          b = line[i];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const segment = {
          a,
          b,
          bearing: direction === -1 ? heading(b, a) : heading(a, b),
          oneway: direction !== 0,
          narrow: p.class === 'service' || p.type === 'living_street',
          structure: p.structure ?? 'ground',
        };
        // Candidate radius is 8 m; add it to the bounds so each pose needs a single cell lookup.
        for (let x = cellX(Math.min(a[0], b[0]) - 0.00016); x <= cellX(Math.max(a[0], b[0]) + 0.00016); x++)
          for (
            let y = cellY(Math.min(a[1], b[1]) - 0.00008);
            y <= cellY(Math.max(a[1], b[1]) + 0.00008);
            y++
          ) {
            const key = x + ',' + y;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(segment);
          }
      }
  }
  return cells;
}
export function alignCarriageway(cells, pose, useDrivingLane = true) {
  const [lng, lat] = pose.coordinate;
  const candidates = cells?.get(cellX(lng) + ',' + cellY(lat));
  if (!cells) return pose;
  if (!candidates) return {...pose, uncertain: true};
  let best, nearest = Infinity;
  const matches = [];
  for (const seg of candidates) {
    let bearing = seg.bearing;
    if (!seg.oneway && turn(bearing, pose.bearing) > 90) bearing = (bearing + 180) % 360;
    const angle = turn(bearing, pose.bearing);
    const {t, error} = segmentProjection(pose.coordinate, seg.a, seg.b);
    if (!seg.oneway || angle < 90) nearest = Math.min(nearest, error);
    if (angle > 30 || error > 8) continue;
    const score = error + angle * 0.13;
    if (best && score > best.score + 1.25) continue;
    const coord = [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t];
    const match = {coord, bearing, seg, score};
    matches.push(match);
    if (!best || score < best.score) best = match;
  }
  // Tiled copies of a road must not hide an equally plausible parallel street or grade.
  const ambiguous = best && matches.some((other) =>
    other !== best && other.score <= best.score + 1.25 &&
    (other.seg.structure !== best.seg.structure ||
      Math.hypot((other.coord[0] - best.coord[0]) * 55200, (other.coord[1] - best.coord[1]) * 111195) > 4),
  );
  if (!best || ambiguous) return nearest < 3.5 ? pose : {...pose, uncertain: true};
  // A route traces the mapped road axis. Vehicles on an undivided road keep right.
  if (!useDrivingLane) return {...pose, coordinate: best.coord};
  const right = best.seg.oneway || best.seg.narrow ? 0 : 1.3,
    rad = (best.bearing * Math.PI) / 180;
  const coordinate = [
    best.coord[0] + (right * Math.cos(rad)) / (111195 * Math.cos((lat * Math.PI) / 180)),
    best.coord[1] - (right * Math.sin(rad)) / 111195,
  ];
  // Retain the axle-to-axle heading through corners rather than jumping at tile vertices.
  return {coordinate, bearing: pose.bearing};
}

export function mapCarriageways(map, onChange) {
  let cells = null, bounds = null, pending, lastCamera, dirty = true, source = map.getSource('tileflow');
  let seenTiles = new WeakSet();
  const covers = (coordinate) => Boolean(bounds && map.getZoom() >= 15 && bounds.contains(coordinate));
  const align = (pose) => covers(pose.coordinate) ? alignCarriageway(cells, pose) : pose;
  const centerline = (pose) => covers(pose.coordinate) ? alignCarriageway(cells, pose, false) : pose;
  align.centerline = centerline;
  align.covers = centerline.covers = covers;
  centerline.intersects = (a, b) => map.getZoom() >= 15 && Boolean(coverageInterval(bounds, a, b));
  centerline.bounds = null;
  align.version = centerline.version = 0;

  function publish(nextCells, nextBounds) {
    cells = nextCells;
    bounds = centerline.bounds = nextBounds;
    centerline.version = ++align.version;
    onChange?.();
  }
  function cameraChanged() {
    if (!lastCamera || Math.abs(map.getZoom() - lastCamera.zoom) >= .2 ||
        turn(map.getBearing(), lastCamera.bearing) >= 4 || Math.abs(map.getPitch() - lastCamera.pitch) >= 4) return true;
    const {lng, lat} = map.getCenter();
    return Math.abs(lng - lastCamera.lng) > lastCamera.stepLng || Math.abs(lat - lastCamera.lat) > lastCamera.stepLat;
  }
  function clear() {
    if (cells) publish(null, null);
  }
  function schedule() {
    if (map.getZoom() < 15) {
      clearTimeout(pending);
      pending = undefined;
      lastCamera = null;
      clear();
      return;
    }
    if (!dirty || pending !== undefined) return;
    pending = setTimeout(() => {
      pending = undefined;
      if (!dirty || map.getZoom() < 15 || map.isMoving() || !source || !map.isSourceLoaded('tileflow')) return;
      const features = map.querySourceFeatures('tileflow', {sourceLayer: 'road'});
      const next = carriagewayIndex(features);
      const area = map.getBounds();
      const {lng, lat} = map.getCenter();
      // A following camera pans a little on each frame. Reuse the current tiles until
      // the viewport exposes another eighth of its width or height.
      lastCamera = {lng, lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(),
        stepLng: (area.getEast() - area.getWest()) / 8, stepLat: (area.getNorth() - area.getSouth()) / 8};
      dirty = false;
      if (next.size) publish(next, area);
      else clear();
    }, 150);
  }
  function refresh() {
    dirty = true;
    schedule();
  }
  function updateSource() {
    const next = map.getSource('tileflow');
    if (next === source) return;
    source = next;
    seenTiles = new WeakSet();
    clear();
    refresh();
  }
  map.on('styledata', updateSource);
  map.on('style.load', () => {
    source = map.getSource('tileflow');
    seenTiles = new WeakSet();
    clear();
    refresh();
  });
  map.on('sourcedata', (e) => {
    if (e.sourceId !== 'tileflow') return;
    if (e.sourceDataType === 'content' || e.sourceDataType === 'metadata') {
      if (e.sourceDataChanged) seenTiles = new WeakSet();
      refresh();
    } else if (e.tile && (!e.tile.state || e.tile.state === 'loaded') && !seenTiles.has(e.tile)) {
      // Streets can reparse the same vector tile when symbol visibility changes.
      // Its road geometry is the same. An actual new tile or source still refreshes it.
      seenTiles.add(e.tile);
      refresh();
    } else if (e.isSourceLoaded) schedule();
  });
  map.on('zoom', () => { if (map.getZoom() < 15 && cells) refresh(); });
  function refreshMovedCamera() {
    if (map.getZoom() >= 15 && cameraChanged()) refresh();
  }
  map.on('zoomend', refreshMovedCamera);
  map.on('moveend', refreshMovedCamera);
  map.on('resize', refresh);
  // If a timer fired mid-pan or before the last tile loaded, retry when Streets settles.
  map.on('idle', schedule);
  map.on('remove', () => clearTimeout(pending));
  schedule();
  return align;
}
