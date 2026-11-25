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
  for (const [id, edge] of [['hsl-berth-tag', '#49626a'], ...tones.map((c, i) => ['hsl-berth-' + i, c.ink])]) {
    for (const highlighted of [false, true]) {
      ctx.clearRect(0, 0, 40, 32);
      // The square cream plate identifies the fixed platform, even over a similarly coloured bus.
      ctx.beginPath(); ctx.roundRect(2, 2, 36, 28, 4);
      ctx.fillStyle = highlighted ? '#ffdf91' : '#fff7de'; ctx.fill();
      ctx.lineWidth = highlighted ? 4 : 2.4; ctx.strokeStyle = edge; ctx.stroke();
      if (highlighted) {
        ctx.fillStyle = edge;
        ctx.fillRect(3, 5, 3, 22);
      }
      map.addImage(highlighted ? 'active-' + id : id, ctx.getImageData(0, 0, 40, 32), {
        pixelRatio: 2, stretchX: [[12, 28]], stretchY: [[10, 22]], content: [8, 5, 32, 27],
      });
    }
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
