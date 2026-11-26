import {lineColors} from './line-colors.js';
import {distance} from './route-track.js';

export const contextBusColors = {day: '#83959e', night: '#72838d'};
export const overviewEnd = 14.6;
export const overviewStart = 13.4;
// MapLibre maxzoom is exclusive. Three starts at exactly the same camera zoom.
export const busModelZoom = 14.7;
export const timingPalette = {
  'on-time': {
    day: '#00875d', night: '#78e0bc', dayInk: '#00825a', label: 'On time or early',
    hint: 'Expected before the timetable or less than 2 minutes late.',
  },
  late: {
    day: '#db690d', night: '#ffae50', dayInk: '#ad4a00', label: '2–5 min late',
    hint: 'At least 2 minutes late and less than 5 minutes late.',
  },
  'very-late': {
    day: '#bd2d40', night: '#ff7483', label: '5+ min late', hint: 'At least 5 minutes late.',
  },
  unknown: {
    day: '#69767c', night: '#91a0a6', label: 'Unknown',
    hint: 'The next arrival has no fresh prediction matched to a scheduled visit. Excluded from the percentage.',
  },
};
export const timingGroup = (status) => status === 'early' ? 'on-time' :
  Object.hasOwn(timingPalette, status) ? status : 'unknown';

export function timingColor(status, period, daySwatch = 'day') {
  const band = timingPalette[timingGroup(status)];
  if (period === 'dusk' || period === 'night') return band.night;
  return band[daySwatch] ?? band.day;
}

// Both swatches are tested against every semantic fill (WCAG AA at normal text sizes).
export function timingTextColor(status, period) {
  return period === 'night' || period === 'dusk' || timingGroup(status) === 'late' ? '#07141b' : '#ffffff';
}

export function timingColorExpression(period, property = 'punctuality', daySwatch = 'day') {
  const color = status => timingColor(status, period, daySwatch);
  return [
    'match', ['get', property],
    ['early', 'on-time'], color('on-time'),
    'late', color('late'),
    'very-late', color('very-late'),
    color('unknown'),
  ];
}
export const trailLayerIds = ['hsl-fleet-trail'];
const zoom = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];

// One feature per visual band can hold many disconnected journeys. Keep the
// original road vertices and split by metres so sparse fixes fade consistently.
const trailAlphas = [.14, .46, .74, .94];
export function appendFleetTrail(features, coordinates, properties, groups) {
  if (!coordinates || coordinates.length < 2) return;
  const offsets = [0];
  for (let i = 1; i < coordinates.length; i++) {
    offsets.push(offsets[i - 1] + distance(coordinates[i - 1], coordinates[i]));
  }
  const length = offsets.at(-1);
  if (!(length > 0)) return;
  const {punctuality, ink, secondary, stale, sameLine} = properties;
  const color = sameLine ? {ink, sameLine: true} : punctuality === undefined ? {ink} : {punctuality: timingGroup(punctuality)};
  const key = [color.punctuality ?? ink, Boolean(sameLine), secondary, stale].join('|');
  let bands = groups.get(key);
  if (!bands) {
    bands = trailAlphas.map(trailAlpha => {
      const lines = [];
      features.push({
        type: 'Feature',
        geometry: {type: 'MultiLineString', coordinates: lines},
        properties: {...color, secondary, stale, trailAlpha},
      });
      return lines;
    });
    groups.set(key, bands);
  }
  let start = coordinates[0];
  let next = 1;
  for (let i = 0; i < bands.length; i++) {
    const end = length * ((i + 1) / bands.length);
    const part = [start];
    while (next < coordinates.length && offsets[next] <= end) {
      if (offsets[next] > offsets[next - 1]) part.push(coordinates[next]);
      next++;
    }
    if (next < coordinates.length && offsets[next - 1] < end) {
      const a = coordinates[next - 1], b = coordinates[next];
      const fraction = (end - offsets[next - 1]) / (offsets[next] - offsets[next - 1]);
      part.push([a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]);
    }
    bands[i].push(part);
    start = part.at(-1);
  }
}

export function forwardHaloLayers(period, lineColour) {
  // Widths grow with the bus so the ribbon fits within its lane, even close up.
  const strokes = [
    {prefix: 'hsl-halo-glow-', width: [4.4, 5.5, 10, 21, 66], blur: [1.4, 1.8, 3, 6, 16], opacity: .30},
    {prefix: 'hsl-halo-', width: [2.1, 2.8, 5.4, 11, 40], blur: [.25, .35, .55, .95, 2.5], opacity: .91},
  ];
  const scale = ([a, b, c, d, e]) => ['interpolate', ['exponential', 2], ['zoom'],
    busModelZoom, a, 16, b, 17, c, 18, d, 20, e];
  return strokes.flatMap(({prefix, width, blur, opacity}) => Object.keys(timingPalette).map(status => {
    const color = lineColour ?? timingColor(status, period);
    return {
      id: prefix + status,
      type: 'line',
      source: 'hsl-previews',
      minzoom: busModelZoom,
      filter: ['==', ['get', 'punctuality'], status],
      layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {
        'line-width': scale(width), 'line-blur': scale(blur), 'line-opacity': opacity,
        'line-gradient': ['interpolate', ['linear'], ['line-progress'],
          0, color, .30, color, .56, color + 'bb', .82, color + '45', 1, color + '00'],
      },
    };
  }));
}
const strength = ['case', ['get', 'stale'], 0.38, ['get', 'secondary'], 0.35, 1];
const peer = ['boolean', ['get', 'sameLine'], false];
const presence = ['case', peer, 1, ['==', ['get', 'punctuality'], 'unknown'], 0.45, 1];
const overviewStrength = ['*', strength, presence];
const atStreet = ['case', ['get', 'secondary'], 0.42, 1];
// The selected trip has its own 3D vehicle at every zoom.
const point = ['all', ['==', ['geometry-type'], 'Point'], ['!', ['boolean', ['get', 'fullTrip'], false]]];

export function fleetLightLayers(period) {
  const night = period === 'dusk' || period === 'night';
  const colors = lineColors.map((c) => (night ? c.body : c.ink));
  const ink = ['match', ['get', 'ink'], ...colors.flatMap((color, i) => [i, color]), colors[0]];
  const hasStatus = ['has', 'punctuality'];
  const statusInk = timingColorExpression(period);
  const peerInk = ['match', ['get', 'ink'], ...lineColors.flatMap((c, i) => [i, c.body]), lineColors[0].body];
  const fleetInk = ['case', peer, peerInk, ['get', 'secondary'], night ? contextBusColors.night : contextBusColors.day,
    hasStatus, statusInk, ink];
  const source = 'hsl-vehicles';
  const rank = {'circle-sort-key': ['case', ['get', 'selected'], 2, ['get', 'secondary'], 0, 1]};
  const trailStrength = ['*', overviewStrength, ['number', ['get', 'trailAlpha']]];
  return [
    {
      id: trailLayerIds[0],
      type: 'line',
      source,
      maxzoom: busModelZoom,
      filter: ['has', 'trailAlpha'],
      layout: {'line-cap': 'butt', 'line-join': 'round'},
      paint: {
        'line-color': fleetInk,
        'line-width': night ? zoom(7, 1.8, 11, 3.3, overviewStart, 4.3) : zoom(7, 1.6, 11, 2.85, overviewStart, 3.8),
        'line-opacity': zoom(overviewStart, trailStrength, overviewEnd,
          ['case', hasStatus, ['*', trailStrength, .78], 0]),
      },
    },
    {
      id: 'hsl-vehicle-glow',
      type: 'circle',
      source,
      filter: point,
      maxzoom: overviewEnd,
      layout: rank,
      paint: {
        'circle-color': fleetInk,
        'circle-radius': night ? zoom(6, 3, 10, 7, 12, 11, overviewStart, 13) : zoom(6, 5, 10, 8, 12, 10.5, overviewStart, 12),
        'circle-blur': 0.9,
        'circle-opacity': zoom(
          overviewStart,
          ['*', overviewStrength, ['case', ['get', 'trailing'], night ? 0.9 : 0.43, night ? 0.48 : 0.31]],
          overviewEnd,
          0,
        ),
      },
    },
    {
      id: 'hsl-vehicle',
      type: 'circle',
      source,
      maxzoom: busModelZoom,
      filter: point,
      layout: rank,
      paint: {
        'circle-color': fleetInk,
        'circle-radius': zoom(
          6,
          night ? 1.3 : 2.55,
          10,
          night ? 2.05 : 3.35,
          overviewStart,
          ['case', ['get', 'selected'], night ? 4 : 5, night ? 2.9 : 4.15],
          overviewEnd,
          ['case', ['get', 'secondary'], 3.4, 5.5],
        ),
        'circle-opacity': zoom(overviewStart, overviewStrength, busModelZoom, atStreet),
      },
    },
    {
      id: 'hsl-vehicle-gps',
      type: 'circle',
      source,
      minzoom: busModelZoom,
      filter: ['all', point, ['!', ['get', 'onRoute']]],
      layout: rank,
      paint: {
        'circle-color': fleetInk,
        'circle-radius': zoom(busModelZoom, ['case', ['get', 'secondary'], 3.4, 5.5],
          18, ['case', ['get', 'secondary'], 4.5, 7.5]),
        'circle-opacity': atStreet,
      },
    },
    {
      id: 'hsl-vehicle-core',
      type: 'circle',
      source,
      filter: ['all', point, ['!', ['get', 'stale']]],
      maxzoom: overviewEnd,
      layout: rank,
      paint: {
        'circle-color': ['case', ['any', peer, ['get', 'secondary'], hasStatus], fleetInk, night ? '#fffae7' : '#fff1cf'],
        'circle-radius': zoom(8, 0.48, 12, 1.05, overviewStart, ['case', ['get', 'selected'], 1.55, 1.22]),
        'circle-opacity': zoom(overviewStart, ['*', overviewStrength, ['case', ['get', 'trailing'], 1, 0.57]], overviewEnd, 0),
      },
    },
  ];
}
