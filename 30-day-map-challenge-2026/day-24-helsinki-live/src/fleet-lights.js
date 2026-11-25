import {lineColors} from './line-colors.js';

export const overviewEnd = 14.6;
export const overviewStart = 13.4;
// MapLibre maxzoom is exclusive. Three starts at exactly the same camera zoom.
export const busModelZoom = 14.7;
export const timingPalette = {
  'on-time': {
    day: '#00875d', night: '#78e0bc', label: 'On time or early',
    hint: 'Expected before the timetable or less than 2 minutes late.',
  },
  late: {
    day: '#bc7835', night: '#edb47c', label: '2–5 min late',
    hint: 'At least 2 minutes late and less than 5 minutes late.',
  },
  'very-late': {
    day: '#c83358', night: '#ff7575', label: '5+ min late', hint: 'At least 5 minutes late.',
  },
  unknown: {
    day: '#69767c', night: '#91a0a6', label: 'Unknown',
    hint: 'The next arrival has no fresh prediction matched to a scheduled visit. Excluded from the percentage.',
  },
};
export const timingGroup = (status) => status === 'early' ? 'on-time' :
  Object.hasOwn(timingPalette, status) ? status : 'unknown';

export function timingColor(status, period) {
  return timingPalette[timingGroup(status)][period === 'dusk' || period === 'night' ? 'night' : 'day'];
}

// Both swatches are tested against every semantic fill (WCAG AA at normal text sizes).
export function timingTextColor(status, period) {
  return period === 'night' || period === 'dusk' || timingGroup(status) === 'late' ? '#07141b' : '#ffffff';
}

export function timingColorExpression(period, property = 'punctuality') {
  return [
    'match', ['get', property],
    ['early', 'on-time'], timingColor('on-time', period),
    'late', timingColor('late', period),
    'very-late', timingColor('very-late', period),
    timingColor('unknown', period),
  ];
}
export const guideMinZoom = 9;

const lineIds = lineColors.map((_, i) => 'hsl-trail-' + i);
export const trailLayerIds = [...lineIds, ...Object.keys(timingPalette).map((key) => 'hsl-timing-' + key)];
const zoom = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
const strength = ['case', ['get', 'stale'], 0.38, ['get', 'secondary'], 0.78, 1];
const presence = ['case', ['==', ['get', 'punctuality'], 'unknown'], 0.45, 1];
const overviewStrength = ['*', strength, presence];
const atStreet = ['case', ['get', 'secondary'], 0.68, 1];
// The selected trip has its own 3D vehicle at every zoom.
const point = ['all', ['==', ['geometry-type'], 'Point'], ['!', ['boolean', ['get', 'fullTrip'], false]]];

export function fleetLightLayers(period) {
  const night = period === 'dusk' || period === 'night';
  const colors = lineColors.map((c) => (night ? c.body : c.ink));
  const ink = ['match', ['get', 'ink'], ...colors.flatMap((color, i) => [i, color]), colors[0]];
  const timingColours = Object.keys(timingPalette).map((key) => [key, timingColor(key, period)]);
  const hasStatus = ['has', 'punctuality'];
  const statusInk = timingColorExpression(period);
  const fleetInk = ['case', hasStatus, statusInk, ink];
  const source = 'hsl-vehicles';
  const rank = {'circle-sort-key': ['case', ['get', 'selected'], 2, ['get', 'secondary'], 0, 1]};
  const trails = [
    ...colors.map((colour, i) => ({
      id: lineIds[i], colour, match: ['all', ['!', ['has', 'punctuality']], ['==', ['get', 'ink'], i]],
    })),
    ...timingColours.map(([key, colour]) => ({
      id: 'hsl-timing-' + key, colour, statusTrail: true, match: key === 'on-time'
        ? ['in', ['get', 'punctuality'], ['literal', ['early', 'on-time']]]
        : ['==', ['get', 'punctuality'], key],
    })),
  ].map(({id, colour: color, match, statusTrail}) => ({
    id,
    type: 'line',
    source,
    maxzoom: statusTrail ? busModelZoom : overviewEnd,
    filter: ['all', ['==', ['geometry-type'], 'LineString'], match],
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {
      'line-gradient': [
        'interpolate',
        ['linear'],
        ['line-progress'],
        0,
        color + '00',
        0.30,
        color + '60',
        0.74,
        color + 'dc',
        1,
        color,
      ],
      'line-width': night ? zoom(7, 1.8, 11, 3.3, overviewStart, 4.3) : zoom(7, 1.6, 11, 2.85, overviewStart, 3.8),
      'line-opacity': statusTrail
        ? zoom(overviewStart, overviewStrength, overviewEnd, ['*', overviewStrength, .78])
        : zoom(overviewStart, overviewStrength, overviewEnd, 0),
    },
  }));
  const trailGlows = trails.filter(layer => layer.id.startsWith('hsl-timing-')).map(layer => ({
    ...layer,
    id: layer.id + '-glow',
    maxzoom: overviewEnd,
    paint: {
      ...layer.paint,
      'line-width': night ? zoom(7, 5.5, 11, 10, overviewStart, 13) : zoom(7, 4.5, 11, 8.5, overviewStart, 11),
      'line-blur': zoom(7, 2.5, 11, 4.5, overviewStart, 6),
      'line-opacity': zoom(overviewStart, ['*', overviewStrength, night ? 0.8 : 0.38], overviewEnd, 0),
    },
  }));
  return [
    ...trailGlows,
    ...trails,
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
        'circle-color': ['case', hasStatus, statusInk, night ? '#fffae7' : '#fff1cf'],
        'circle-radius': zoom(8, 0.48, 12, 1.05, overviewStart, ['case', ['get', 'selected'], 1.55, 1.22]),
        'circle-opacity': zoom(overviewStart, ['*', presence, ['case', ['get', 'trailing'], 1, 0.57]], overviewEnd, 0),
      },
    },
  ];
}
