import {heading, segmentProjection, turn} from './route-track.js';

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
export function carriagewayIndex(features) {
  const cells = new Map();
  for (const f of features) {
    const p = f.properties;
    if (!allowed.has(p.class) || p.indoor || p.access === 'private' || p.access === 'no') continue;
    const g = f.geometry;
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
          bearing: heading(a, b),
          oneway: p.oneway === true || p.oneway === 1,
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
export function alignCarriageway(cells, pose) {
  const [lng, lat] = pose.coordinate;
  const candidates = cells?.get(cellX(lng) + ',' + cellY(lat));
  if (!cells) return pose;
  if (!candidates) return {...pose, uncertain: true};
  let best,
    ambiguous = false,
    nearest = Infinity;
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
    const different =
      best &&
      (best.seg.structure !== seg.structure ||
        Math.hypot((best.coord[0] - coord[0]) * 55200, (best.coord[1] - coord[1]) * 111195) > 4);
    if (!best || score < best.score) {
      ambiguous = Boolean(different && best.score - score < 1.25);
      best = {coord, bearing, seg, score};
    } else if (different) ambiguous = true;
  }
  if (!best || ambiguous) return nearest < 3.5 ? pose : {...pose, uncertain: true};
  // Finland drives on the right. Divided roads already have a directional centreline.
  const right = best.seg.oneway || best.seg.narrow ? 0 : 1.3,
    rad = (best.bearing * Math.PI) / 180;
  const coordinate = [
    best.coord[0] + (right * Math.cos(rad)) / (111195 * Math.cos((lat * Math.PI) / 180)),
    best.coord[1] - (right * Math.sin(rad)) / 111195,
  ];
  // Retain the axle-to-axle heading through corners rather than jumping at tile vertices.
  return {coordinate, bearing: pose.bearing};
}

export function mapCarriageways(map) {
  let cells, pending, coverage, lastCenter;
  const align = (pose) => (align.covers(pose.coordinate) ? alignCarriageway(cells, pose) : pose);
  align.covers = (coordinate) => Boolean(cells && map.getZoom() >= 15 && coverage?.contains(coordinate));
  align.version = 0;
  const refresh = () => {
    if (map.getZoom() < 15) {
      clearTimeout(pending);
      pending = undefined;
      if (cells) align.version++;
      cells = null;
      return;
    }
    if (pending !== undefined) return;
    pending = setTimeout(() => {
      pending = undefined;
      // A tile from the previous camera can still be queryable during a pan.
      // Keep its original coverage until the new street tiles are ready.
      if (map.getZoom() >= 15 && map.getSource('tileflow') && map.isSourceLoaded('tileflow')) {
        const features = map.querySourceFeatures('tileflow', {sourceLayer: 'road'});
        if (features.length) {
          cells = carriagewayIndex(features);
          align.version++;
          coverage = map.getBounds();
          lastCenter = map.getCenter();
        }
      }
    }, 180);
  };
  map.on('sourcedata', (e) => {
    if (e.sourceId === 'tileflow' && (e.sourceDataType === 'content' || e.isSourceLoaded)) refresh();
  });
  map.on('zoomend', refresh);
  map.on('moveend', () => {
    if (map.getZoom() >= 15 && (!lastCenter || map.getCenter().distanceTo(lastCenter) > 200)) refresh();
  });
  map.on('remove', () => clearTimeout(pending));
  refresh();
  return align;
}
