const naturalEarthUrl =
  'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-physical-labels/';
import catalogRows from './data/search-peaks.json';
const makePeak = (name, region, lat, lon, sourceUrl, aliases = [], source = 'OpenStreetMap') => ({
  name,
  region,
  lat,
  lon,
  sourceUrl,
  aliases,
  source,
});
const osmNode = (id) => 'https://www.openstreetmap.org/node/' + id;
const verified = [
  makePeak(
    'Pico do Arieiro',
    'Madeira, Portugal',
    32.7355,
    -16.9289,
    'https://visitmadeira.com/en/where-to-go/madeira/madeira-peaks/pico-do-areeiro/',
    ['Pico do Areeiro', 'Arieiro', 'Areeiro'],
    'Madeira scenario',
  ),
  makePeak('Teide', 'Tenerife, Spain', 28.2726934, -16.6422736, osmNode(6447099369), [
    'Pico del Teide',
    'Mount Teide',
  ]),
  makePeak('Gornergrat', 'Valais, Switzerland', 45.9833365, 7.7849888, osmNode(8925949718)),
  makePeak('Mount Everest', 'Nepal / China', 27.9880614, 86.92521, osmNode(164979149), [
    'Monte Everest',
    'Everest',
    'Sagarmatha',
    'Chomolungma',
  ]),
  makePeak('Kilimanjaro', 'Uhuru Peak, Tanzania', -3.0764084, 37.3539987, osmNode(32059197), [
    'Mount Kilimanjaro',
    'Uhuru Peak',
    'Kibo',
    'Kilimanyaro',
  ]),
  makePeak('Aconcagua', 'Mendoza, Argentina', -32.6531487, -70.0119607, osmNode(1504741757), [
    'Cerro Aconcagua',
  ]),
  makePeak('Mount Fuji', 'Kengamine, Japan', 35.3606812, 138.7273506, osmNode(873531353), [
    'Monte Fuji',
    'Fujisan',
    'Fuji',
    'Kengamine',
    '富士山',
  ]),
  makePeak('Aneto', 'Pyrenees, Spain', 42.6311462, 0.6566507, osmNode(4252339778), [
    'Pico Aneto',
    'Pico de Aneto',
    'Tuca d’Aneto',
  ]),
  makePeak('Mont Blanc', 'Alps', 45.8327056, 6.8651706, osmNode(281399025), ['Monte Bianco']),
  makePeak('Rock of Gibraltar', 'Gibraltar', 36.1285695, -5.3444135, osmNode(243843850), [
    'Peñón de Gibraltar',
  ]),
  makePeak(
    'Mulhacén',
    'Sierra Nevada, Spain',
    37.05333333,
    -3.31138889,
    'https://en.wikipedia.org/wiki/Mulhac%C3%A9n',
    ['Pico Mulhacén'],
    'Wikipedia',
  ),
];
const scenarios = verified.slice(0, 7);
const norm = (s) =>
  s
    .toLocaleLowerCase('en')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const countries = new Intl.DisplayNames(['en'], {type: 'region'});
const regions = {'Seven seas (open ocean)': 'Oceanic islands'};
function country(code) {
  return /^[a-z]{2}$/i.test(code || '') ? countries.of(code.toUpperCase()) : '';
}
const gazetteer = catalogRows.map(([name, aliases, lat, lon, code, region]) =>
  makePeak(
    name,
    (country(code) || regions[region] || region) + ' · approximate location',
    lat,
    lon,
    naturalEarthUrl,
    aliases,
    'Natural Earth',
  ),
);
const near = (a, b, d) =>
  Math.abs(a.lat - b.lat) < d &&
  Math.abs(((a.lon - b.lon + 540) % 360) - 180) * Math.cos((a.lat * Math.PI) / 180) < d;
const same = (a, b, d) =>
  near(a, b, d) &&
  (a.name === b.name ||
    [a.name, ...a.aliases]
      .map(norm)
      .some((s) => [b.name, ...b.aliases].some((t) => norm(t) === s)));
const peaks = [...verified, ...gazetteer.filter((p) => !verified.some((s) => same(p, s, 0.09)))];
const index = peaks.map((peak) => ({
  peak,
  keys: [...new Set([peak.name, ...peak.aliases].map(norm).filter(Boolean))],
}));
function coords(query) {
  const decimal = '([+-]?(?:\\d{1,3}(?:\\.\\d+)?|\\.\\d+))';
  const pair = new RegExp('^' + decimal + '\\s*°?(?:\\s*[,;]\\s*|\\s+)' + decimal + '\\s*°?$').exec(
    query.trim(),
  );
  if (!pair) return null;
  const lat = Number(pair[1]),
    lon = Number(pair[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return makePeak(
    'Coordinates',
    lat.toFixed(5) + '°, ' + lon.toFixed(5) + '°',
    lat,
    lon,
    '',
    [],
    'Coordinates',
  );
}
function local(query) {
  const coordinate = coords(query);
  if (coordinate) return [coordinate];
  const key = norm(query);
  if (!key) return [...scenarios];
  return index
    .map(({peak, keys}) => {
      let score = 0;
      for (const candidate of keys) {
        if (candidate === key) score = 4;
        else if (candidate.startsWith(key)) score = Math.max(score, 3);
        else if (candidate.includes(' ' + key)) score = Math.max(score, 2);
        else if (key.length >= 3 && candidate.includes(key)) score = Math.max(score, 1);
      }
      return {peak, score};
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map((row) => row.peak);
}
const cache = new Map();
function fromPhoton(feature) {
  const p = feature.properties,
    [lon, lat] = feature.geometry?.coordinates || [];
  if (
    !p?.name ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    p.osm_key !== 'natural' ||
    !['peak', 'volcano'].includes(p.osm_value)
  )
    return;
  const osmType = {N: 'node', W: 'way', R: 'relation'}[p.osm_type];
  if (!osmType || !Number.isInteger(p.osm_id)) return;
  const region =
    [p.state, country(p.countrycode) || p.country].filter(Boolean).join(', ') || 'OpenStreetMap';
  return makePeak(
    p.name,
    region,
    lat,
    lon,
    'https://www.openstreetmap.org/' + osmType + '/' + p.osm_id,
  );
}
async function search(query, {signal} = {}) {
  const localHits = local(query),
    key = norm(query);
  if (
    !key ||
    query.trim().length < 2 ||
    localHits[0]?.source === 'Coordinates' ||
    !/[\p{L}]/u.test(query)
  )
    return localHits;
  const curated = localHits.filter(
    (p) => verified.includes(p) && [p.name, ...p.aliases].some((s) => norm(s) === key),
  );
  if (curated.length) return [...curated, ...localHits.filter((p) => !curated.includes(p))];
  let remoteHits = cache.get(key);
  if (!remoteHits) {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', query.trim().slice(0, 180));
    url.searchParams.set('limit', '8');
    url.searchParams.set('lang', 'en');
    url.searchParams.append('osm_tag', 'natural:peak');
    url.searchParams.append('osm_tag', 'natural:volcano');
    // Only called when the search form is submitted, never on individual keystrokes.
    const controller = new AbortController(),
      cancel = () => controller.abort();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    signal?.addEventListener('abort', cancel, {once: true});
    const timer = setTimeout(cancel, 6500);
    try {
      const response = await fetch(url, {signal: controller.signal, credentials: 'omit'});
      if (!response.ok) throw new Error('Peak search returned HTTP ' + response.status + '.');
      remoteHits = (await response.json()).features
        .map(fromPhoton)
        .filter(Boolean)
        .sort((a, b) => Number(norm(b.name) === key) - Number(norm(a.name) === key));
      cache.set(key, remoteHits);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (localHits.length) return localHits;
      throw new Error('Online search is unavailable. Choose a location on the map.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
  const merged = [...remoteHits];
  for (const hit of localHits) {
    if (!merged.some((p) => same(p, hit, hit.source === 'Natural Earth' ? 0.07 : 0.003)))
      merged.push(hit);
  }
  return merged.slice(0, 14);
}
export default {scenarios, peaks, local, search, coordinates: coords};
