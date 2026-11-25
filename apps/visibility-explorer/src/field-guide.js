const R = 6371008.8,
  DEG = Math.PI / 180;
const ringSource = 'field-distances',
  headingSource = 'field-direction';
const firstLayer = 'field-rings-halo';
const fc = (features) => ({type: 'FeatureCollection', features});
const nothing = () => fc([]);
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const ringsFor = (radius) => {
  switch (radius) {
    case 1000:
      return [250, 500, radius];
    case 2000:
      return [500, 1000, radius];
    case 5000:
      return [1000, 2500, radius];
    case 10000:
      return [2000, 5000, radius];
    default:
      return [radius / 4, radius / 2, radius];
  }
};
const format = new Intl.NumberFormat('en-US', {maximumFractionDigits: 2});
const label = (m) => (m >= 1000 ? format.format(m / 1000) + ' km' : format.format(m) + ' m');

// A destination on the same sphere as the analysis grid. Keep unwrapped
// longitude while constructing an arc, then cut it into canonical world copies.
function at(origin, radius, degrees) {
  const phi = origin.lat * DEG,
    az = degrees * DEG,
    angle = radius / R;
  const latitude = Math.asin(
    Math.max(
      -1,
      Math.min(1, Math.sin(phi) * Math.cos(angle) + Math.cos(phi) * Math.sin(angle) * Math.cos(az)),
    ),
  );
  const delta = Math.atan2(
    Math.sin(az) * Math.sin(angle) * Math.cos(phi),
    Math.cos(angle) - Math.sin(phi) * Math.sin(latitude),
  );
  return [origin.lon + delta / DEG, latitude / DEG];
}

function arc(origin, radius, start, end, properties) {
  const count = Math.ceil((end - start) / 2),
    parts = [];
  let a = at(origin, radius, start),
    currentWorld;
  function add(from, to) {
    if (from[0] === to[0] && from[1] === to[1]) return;
    const world = Math.floor(((from[0] + to[0]) / 2 + 180) / 360);
    if (world !== currentWorld) {
      parts.push([[from[0] - 360 * world, from[1]]]);
      currentWorld = world;
    }
    parts[parts.length - 1].push([to[0] - 360 * world, to[1]]);
  }
  for (let n = 1; n <= count; n++) {
    const b = at(origin, radius, start + ((end - start) * n) / count);
    const min = Math.min(a[0], b[0]),
      max = Math.max(a[0], b[0]);
    const seam = 180 + 360 * Math.floor((min + 180) / 360);
    if (min < seam && seam < max) {
      const factor = (seam - a[0]) / (b[0] - a[0]),
        cut = [seam, a[1] + factor * (b[1] - a[1])];
      add(a, cut);
      add(cut, b);
    } else add(a, b);
    a = b;
  }
  return {type: 'Feature', properties, geometry: {type: 'MultiLineString', coordinates: parts}};
}

// Intersect the short inspection fan with each world strip before wrapping, so
// a glance across 180° cannot create a polygon over the rest of the map.
function fan(origin, radius, heading) {
  const points = [[origin.lon, origin.lat]];
  for (let i = -12; i <= 12; i += 2) points.push(at(origin, radius, heading + i));
  function clip(polygon, meridian, sign) {
    const result = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[(i + polygon.length - 1) % polygon.length],
        b = polygon[i];
      const aIn = sign * (a[0] - meridian) >= 0,
        bIn = sign * (b[0] - meridian) >= 0;
      if (aIn !== bIn) {
        const f = (meridian - a[0]) / (b[0] - a[0]);
        result.push([meridian, a[1] + f * (b[1] - a[1])]);
      }
      if (bIn) result.push(b);
    }
    return result;
  }
  const worlds = points.map((p) => Math.floor((p[0] + 180) / 360)),
    polygons = [];
  for (let world = Math.min(...worlds); world <= Math.max(...worlds); world++) {
    const west = -180 + 360 * world,
      east = 180 + 360 * world;
    const vertices = clip(clip(points, west, 1), east, -1).map(([x, y]) => [x - 360 * world, y]);
    if (vertices.length < 3) continue;
    const area = vertices.reduce((sum, a, i) => {
      const b = vertices[(i + 1) % vertices.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0);
    if (Math.abs(area) < 1e-13) continue;
    if (area < 0) vertices.reverse();
    vertices.push(vertices[0]);
    polygons.push([vertices]);
  }
  return {type: 'Feature', properties: {}, geometry: {type: 'MultiPolygon', coordinates: polygons}};
}

function attach(map, beforeLayer) {
  const add = (layer) => map.addLayer(layer, beforeLayer);
  map.addSource(ringSource, {type: 'geojson', data: nothing(), maxzoom: 16, tolerance: 0.1});
  map.addSource(headingSource, {type: 'geojson', data: nothing(), maxzoom: 16, tolerance: 0.1});
  const lines = ['==', ['geometry-type'], 'LineString'];
  const radiusWidth = ['case', ['get', 'outer'], 2.5, 1.9];
  add({
    id: firstLayer,
    type: 'line',
    source: ringSource,
    filter: lines,
    paint: {'line-color': '#fffbea', 'line-opacity': 0.72, 'line-width': ['+', radiusWidth, 1.8]},
  });
  add({
    id: 'field-rings',
    type: 'line',
    source: ringSource,
    filter: lines,
    paint: {
      'line-color': '#254b48',
      'line-opacity': ['case', ['get', 'outer'], 0.93, 0.85],
      'line-width': radiusWidth,
      'line-dasharray': [3, 3.5],
    },
  });
  add({
    id: 'field-glance',
    type: 'fill',
    source: headingSource,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {'fill-color': '#cc893a', 'fill-opacity': 0.24, 'fill-antialias': false},
  });
  add({
    id: 'field-arcs-halo',
    type: 'line',
    source: headingSource,
    filter: lines,
    layout: {'line-cap': 'round'},
    paint: {'line-color': '#fff5dc', 'line-width': 5, 'line-opacity': 0.88},
  });
  add({
    id: 'field-arcs',
    type: 'line',
    source: headingSource,
    filter: lines,
    layout: {'line-cap': 'round'},
    paint: {'line-color': '#955620', 'line-width': 2.5, 'line-opacity': 0.94},
  });
  add({
    id: 'field-ring-labels',
    type: 'symbol',
    source: ringSource,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-padding': 2,
      'text-anchor': 'center',
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {'text-color': '#234940', 'text-halo-color': '#fffced', 'text-halo-width': 1.8},
  });
  let origin = null,
    radii = [],
    pending = null,
    visible = false,
    angle = 0,
    range = null,
    drawnAngle = null,
    drawnRange = null;
  function clearAngles() {
    if (pending !== null) {
      cancelAnimationFrame(pending);
      pending = null;
    }
    if (drawnAngle !== null) {
      map.getSource(headingSource).setData(nothing());
      drawnAngle = null;
      drawnRange = null;
    }
  }
  function updateHeading() {
    pending = null;
    if (!origin || !visible || (drawnAngle === angle && drawnRange === range)) return;
    const reach = Math.min(range ?? radii[0], radii[2]);
    const features = radii
      .filter((r) => range === null || r <= reach)
      .map((r) => arc(origin, r, angle - 12, angle + 12, {}));
    features.push(fan(origin, reach, angle));
    map.getSource(headingSource).setData(fc(features));
    drawnAngle = angle;
    drawnRange = range;
  }
  function setHeading(degrees, show, distance) {
    range = Number.isFinite(distance) ? Math.max(0.5, Math.round(distance * 2) / 2) : null;
    visible = Boolean(show) && Number.isFinite(degrees);
    if (!visible) {
      clearAngles();
      return;
    }
    angle = (Math.round((((degrees % 360) + 360) % 360) * 2) / 2) % 360;
    if (origin && (angle !== drawnAngle || range !== drawnRange) && pending === null)
      pending = requestAnimationFrame(updateHeading);
  }
  function clear() {
    clearAngles();
    visible = false;
    origin = null;
    radii = [];
    map.getSource(ringSource).setData(nothing());
  }
  function setObserver(point, radiusM) {
    if (
      !Number.isFinite(point?.lat) ||
      Math.abs(point.lat) > 85.052 ||
      !Number.isFinite(point?.lon) ||
      !Number.isFinite(radiusM) ||
      radiusM <= 0
    ) {
      clear();
      return;
    }
    const lon = wrap(point.lon);
    if (origin?.lat === point.lat && origin.lon === lon && radii[2] === radiusM) return;
    origin = {lat: point.lat, lon};
    radii = ringsFor(radiusM);
    const features = [];
    for (const [i, r] of radii.entries()) {
      features.push(arc(origin, r, 0, 360, {radius: r, outer: i === 2}));
      // Stagger labels around the northeast edge so the three fit on smaller screens.
      const p = at(origin, r, 38 + 18 * i);
      features.push({
        type: 'Feature',
        properties: {radius: r, label: label(r)},
        geometry: {type: 'Point', coordinates: [wrap(p[0]), p[1]]},
      });
    }
    const indexed = map.getSource(ringSource).setData(fc(features));
    const minZoom = Math.max(
      0,
      Math.min(
        22,
        Math.log2((60 * 2 * Math.PI * R * Math.cos(origin.lat * DEG)) / (512 * radiusM)),
      ),
    );
    map.setLayerZoomRange('field-ring-labels', minZoom, 24);
    clearAngles();
    if (visible) updateHeading();
    return indexed;
  }
  return {setObserver, setHeading, clear, beforeRaster: firstLayer};
}
export default {attach, firstLayer};
