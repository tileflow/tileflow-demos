// The terminal name gives way to individual boarding points at this zoom.
export const berthZoom = 15.5;
export const terminalLayers = ['hsl-terminals', 'hsl-berths', 'hsl-unnumbered-berths'];

export function indexTerminals(catalogue, network) {
  const stations = {}, parentOf = new Map();
  if (catalogue?.version !== network.version) return {stations, parentOf};
  const order = new Intl.Collator('fi', {numeric: true});
  for (const [id, station] of Object.entries(catalogue.stations)) {
    const stops = station.stops.filter((key) => network.stops[key]);
    if (stops.length < 2) continue;
    stops.sort((a, b) => {
      const first = network.stops[a], second = network.stops[b];
      return Number(!first.platform) - Number(!second.platform) ||
        order.compare(first.platform || '', second.platform || '') || order.compare(first.code, second.code);
    });
    stations[id] = {...station, stops};
    for (const key of stops) parentOf.set(key, id);
  }
  return {stations, parentOf};
}

export function addPlatformBadge(map, tones) {
  if (map.hasImage('hsl-berth-tag')) return;
  const canvas = document.createElement('canvas');
  canvas.width = 40; canvas.height = 32;
  const ctx = canvas.getContext('2d');
  function plate(id, fill, edge) {
    ctx.clearRect(0, 0, 40, 32);
    ctx.beginPath();
    ctx.roundRect(2, 2, 36, 28, 7);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = edge;
    ctx.stroke();
    map.addImage(id, ctx.getImageData(0, 0, 40, 32), {
      pixelRatio: 2, stretchX: [[12, 28]], stretchY: [[10, 22]], content: [8, 5, 32, 27],
    });
  }
  plate('hsl-berth-tag', '#fff7de', '#49626a');
  for (const [i, tone] of tones.entries()) {
    plate('hsl-eta-day-' + i, '#fffcf6', tone.ink);
    plate('hsl-eta-night-' + i, '#1a2935', tone.body);
  }
}

export function terminalLabelPaint(night) {
  return {'text-color': night ? '#fff8e9' : '#263d46', 'text-halo-color': night ? '#1d303b' : '#faf8e9', 'text-halo-width': 1.9};
}

export function berthLayers(night) {
  const font = ['Noto Sans Regular'];
  const berth = {
    'text-font': font, 'text-size': 13,
    'text-field': ['format', 'Platform ', {'font-scale': 0.94}, ['to-string', ['get', 'platform']], {'font-scale': 1.1}],
    'text-padding': 2, 'icon-padding': 2, 'icon-image': 'hsl-berth-tag',
    'icon-text-fit': 'both', 'icon-text-fit-padding': [1, 3, 1, 3],
  };
  // Centre the visible glyphs inside the fitted badge, independently of the map bearing.
  const berthPaint = {'text-color': '#263e46', 'text-translate': [0, -1.5], 'text-translate-anchor': 'viewport'};
  const numbered = ['has', 'platform'];
  return [
    {
      id: 'hsl-terminals', type: 'symbol', source: 'hsl-terminals', minzoom: 10, maxzoom: berthZoom,
      layout: {
        'icon-image': 'local-platform', 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, .58, 13, .8, 15.5, .93], 'icon-padding': 3,
        'text-optional': true,
        'text-field': ['get', 'name'], 'text-size': 12, 'text-font': font, 'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-justify': 'auto', 'text-radial-offset': 1.05, 'text-max-width': 16, 'text-padding': 3,
        'symbol-sort-key': ['-', 0, ['get', 'count']],
      },
      paint: terminalLabelPaint(night),
    },
    {
      id: 'hsl-unnumbered-berths', type: 'symbol', source: 'hsl-stops', minzoom: berthZoom,
      filter: ['all', ['has', 'parent'], ['!', numbered]],
      layout: {'icon-image': ['concat', 'local-', ['get', 'sign']], 'icon-anchor': 'bottom', 'icon-size': .93, 'icon-padding': 3},
    },
    {
      id: 'hsl-berths', type: 'symbol', source: 'hsl-stops', minzoom: berthZoom,
      filter: numbered, layout: berth, paint: berthPaint,
    },
  ];
}
