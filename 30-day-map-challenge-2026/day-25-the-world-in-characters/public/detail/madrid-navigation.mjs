// Viewport-scoped ODbL extract. These are actual OSM street axes and surveyed
// areas. The format, origin and licence are in madrid-navigation/COPYING.txt.
const extent = [-4.12, 40.02, -3.22, 40.82];
const unit = 1e-5;
const blocks = new Map();
const layers = ['transportation', 'place', 'waterway', 'water', 'landuse'];
const minorRoads = new Set(['residential', 'unclassified', 'living_street']);
const smallRoads = new Set(['service', 'pedestrian', 'cycleway', 'footway']);
let manifest;

export function hasMadridNavigation(bounds, zoom) {
  if (zoom < 10.65 || zoom > 16.6 || bounds?.length !== 4 || !bounds.every(Number.isFinite)) return false;
  const [west, south, east, north] = bounds;
  const lon = (west + east) / 2, lat = (south + north) / 2;
  return west >= extent[0] && south >= extent[1] && east <= extent[2] && north <= extent[3]
    && lon >= -3.96 && lon <= -3.43 && lat >= 40.245 && lat <= 40.64;
}

function table() {
  manifest ??= fetch(new URL('./madrid-navigation/index.json', import.meta.url))
    .then(response => {
      if (!response.ok) throw Error('Missing local Madrid road index');
      return response.json();
    })
    .then(({cells}) => ({a: new Set(cells.a), b: new Set(cells.b)}))
    .catch(error => { manifest = undefined; throw error; });
  return manifest;
}

function loadBlock(key) {
  let entry = blocks.get(key);
  if (!entry) {
    entry = fetch(new URL('./madrid-navigation/' + key + '.gz', import.meta.url)).then(async response => {
      if (!response.ok) throw Error('Local Madrid road cell unavailable');
      // Some static hosts advertise the file as gzip-encoded, in which case
      // Fetch returns the already-decoded body. The usual static server serves
      // .gz opaquely, so the worker decodes its stream itself.
      if (/^gzip$/i.test(response.headers.get('Content-Encoding') || '')) return response.json();
      return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
    }).catch(error => {
      if (blocks.get(key) === entry) blocks.delete(key);
      throw error;
    });
  }
  blocks.delete(key);
  blocks.set(key, entry);
  if (blocks.size > 28) blocks.delete(blocks.keys().next().value);
  return entry;
}

function line(packed) {
  let x = packed[0], y = packed[1];
  const coordinates = [[x * unit, y * unit]];
  for (let i = 2; i < packed.length; i += 2) {
    x += packed[i];
    y += packed[i + 1];
    coordinates.push([x * unit, y * unit]);
  }
  return coordinates;
}

function feature(row) {
  if (row.feature) return row.feature;
  const [kind, , subclass, name, ref, structure, box, packed] = row;
  const link = kind === 0 && subclass.endsWith('_link');
  const roadClass = link ? subclass.slice(0, -5) : minorRoads.has(subclass) ? 'minor' : subclass;
  const layer = kind === 4 && subclass === 'park' ? 'park' : layers[kind];
  const properties = {_layer: layer, class: kind === 0 ? roadClass : subclass, subclass};
  if (name) properties.name = name;
  if (ref) properties.ref = ref;
  if (structure) properties.structure = structure;
  if (link) properties.link = true;
  let geometry;
  if (kind === 1) geometry = {type: 'Point', coordinates: [packed[0] * unit, packed[1] * unit]};
  else if (kind >= 3) geometry = {type: 'MultiPolygon', coordinates: packed.map(polygon => polygon.map(line))};
  else geometry = {type: 'LineString', coordinates: line(packed)};
  return row.feature = {type: 'Feature', properties, bbox: box.map(v => v * unit), geometry};
}

export async function madridNavigation(bounds, zoom, residentOnly = false) {
  if (!hasMadridNavigation(bounds, zoom) || (residentOnly && !manifest)) return [];
  const index = await (residentOnly ? manifest : table()), requests = [];
  for (const tier of zoom >= 12.60 ? ['a', 'b'] : ['a']) {
    const size = tier === 'a' ? .18 : .075;
    const [west, south, east, north] = bounds;
    const x0 = Math.floor((west - extent[0]) / size), x1 = Math.floor((east - extent[0]) / size);
    const y0 = Math.floor((south - extent[1]) / size), y1 = Math.floor((north - extent[1]) / size);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cell = x + '-' + y;
      if (!index[tier].has(cell)) continue;
      const key=tier+cell;
      if(residentOnly&&!blocks.has(key))return [];
      requests.push(residentOnly?blocks.get(key):loadBlock(key));
    }
  }
  const seen = new Set(), rows = [], limit = bounds.map(n => n / unit);
  for (const block of await Promise.all(requests)) for (const row of block) {
    const [kind, id, subclass, , , , box] = row;
    if (box[2] < limit[0] || box[0] > limit[2] || box[3] < limit[1] || box[1] > limit[3]) continue;
    if (kind === 0 && ((zoom < 11.5 && subclass.endsWith('_link')) || (zoom < 14.25 && smallRoads.has(subclass)))) continue;
    const key = id * 5 + kind;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(feature(row));
  }
  return rows;
}
