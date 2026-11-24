// The same line keeps its colour across the region. Berry is reserved for the selected service.
const daylight = ['#087f83', '#ba6329', '#685b9c', '#2479a1', '#a33866'];
const twilight = ['#90e7dc', '#ffbf80', '#c3b6ef', '#9cdaff', '#ff94bd'];
export const overviewEnd = 14.6;
export const overviewStart = 13.4;
export const trailLayerIds = daylight.map((_, i) => 'hsl-trail-' + i);
const zoom = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
const strength = ['case', ['get', 'stale'], 0.38, ['get', 'secondary'], 0.78, 1];
const atStreet = ['case', ['get', 'secondary'], 0.68, 1];
const streetDot = [
  'case',
  ['any', ['get', 'selected'], ['get', 'routeSelected']],
  '#9c315c',
  ['get', 'secondary'],
  '#718894',
  '#11618a',
];
const point = ['==', ['geometry-type'], 'Point'];

export function fleetLightLayers(period) {
  const night = period === 'dusk' || period === 'night';
  const colors = night ? twilight : daylight;
  const ink = ['match', ['get', 'ink'], 0, colors[0], 1, colors[1], 2, colors[2], 3, colors[3], colors[4]];
  const source = 'hsl-vehicles';
  const rank = {'circle-sort-key': ['case', ['get', 'selected'], 2, ['get', 'secondary'], 0, 1]};
  const trails = colors.map((color, i) => ({
    id: trailLayerIds[i],
    type: 'line',
    source,
    maxzoom: overviewEnd,
    filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'ink'], i]],
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {
      'line-gradient': [
        'interpolate',
        ['linear'],
        ['line-progress'],
        0,
        color + '00',
        0.38,
        color + '55',
        1,
        color,
      ],
      'line-width': zoom(7, 1.2, 11, 2.5, overviewStart, 3.3),
      'line-opacity': zoom(overviewStart, strength, overviewEnd, 0),
    },
  }));
  return [
    ...trails,
    {
      id: 'hsl-vehicle-glow',
      type: 'circle',
      source,
      filter: point,
      maxzoom: overviewEnd,
      layout: rank,
      paint: {
        'circle-color': ink,
        'circle-radius': zoom(6, 3, 10, 7, 12, 11, overviewStart, 13),
        'circle-blur': 0.9,
        'circle-opacity': zoom(
          overviewStart,
          ['*', strength, ['case', ['get', 'trailing'], night ? 0.9 : 0.36, night ? 0.48 : 0.2]],
          overviewEnd,
          0,
        ),
      },
    },
    {
      id: 'hsl-vehicle',
      type: 'circle',
      source,
      filter: point,
      layout: rank,
      paint: {
        'circle-color': zoom(overviewStart, ink, overviewEnd, streetDot),
        'circle-radius': zoom(
          6,
          1.3,
          10,
          2.05,
          overviewStart,
          ['case', ['get', 'selected'], 4, 2.9],
          overviewEnd,
          ['case', ['get', 'secondary'], 3.4, 5.5],
          18,
          ['case', ['get', 'secondary'], 4.5, 7.5],
        ),
        'circle-stroke-width': zoom(8, 0.25, overviewStart, night ? 0.55 : 1.1, overviewEnd, 1.5),
        'circle-stroke-color': zoom(overviewStart, night ? ink : '#fff8e8', overviewEnd, '#fff'),
        'circle-opacity': zoom(overviewStart, strength, 14.7, atStreet, 15.6, [
          'case',
          ['get', 'onRoute'],
          0,
          atStreet,
        ]),
        'circle-stroke-opacity': zoom(overviewStart, strength, 14.7, atStreet, 15.6, [
          'case',
          ['get', 'onRoute'],
          0,
          atStreet,
        ]),
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
        'circle-color': night ? '#fffae7' : '#fff1cf',
        'circle-radius': zoom(8, 0.48, 12, 1.05, overviewStart, ['case', ['get', 'selected'], 1.55, 1.22]),
        'circle-opacity': zoom(overviewStart, ['case', ['get', 'trailing'], 1, 0.57], overviewEnd, 0),
      },
    },
  ];
}
