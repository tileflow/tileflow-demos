import * as maplibregl from 'maplibre-gl';

const collection = (features) => ({type: 'FeatureCollection', features});
const coord = (p) => [p.lon, p.lat];
const point = (p, properties) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates: coord(p)},
  properties,
});
function attach(map, beforeLabels) {
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'fill' && /landcover|landuse|vegetation/i.test(layer.id)) {
      const original = map.getPaintProperty(layer.id, 'fill-color');
      function soften(value) {
        if (Array.isArray(value)) return value.map(soften);
        if (typeof value !== 'string') return value;
        const hex = /^#([a-f0-9]{6})$/i.exec(value),
          rgba = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:[, /]+\s*([.\d]+))?\s*\)$/i.exec(
            value,
          );
        if (!hex && !rgba) return value;
        const n = hex ? parseInt(hex[1], 16) : 0,
          c = hex ? [n >> 16, (n >> 8) & 255, n & 255] : rgba.slice(1, 4).map(Number);
        if (c[1] <= c[0] + 3 || c[1] <= c[2] + 5) return value;
        const l = c[0] * 0.26 + c[1] * 0.58 + c[2] * 0.16,
          m = c.map((v, i) => Math.round(0.3 * v + 0.54 * l + 0.16 * [248, 245, 234][i]));
        return 'rgba(' + m.join(',') + ',' + (rgba?.[4] ?? 1) + ')';
      }
      if (original != null) map.setPaintProperty(layer.id, 'fill-color', soften(original));
    }
    if (layer.type === 'line' && /contour/i.test(layer.id)) {
      const opacity = map.getPaintProperty(layer.id, 'line-opacity');
      if (typeof opacity === 'number' || opacity == null)
        map.setPaintProperty(layer.id, 'line-opacity', (opacity ?? 1) * 0.7);
    }
  }
  const data = collection([]);
  for (const id of ['discovered-summits', 'summit-highlight', 'terrain-trace', 'analysis-sector'])
    map.addSource(id, {type: 'geojson', data});
  const summitLayout = {
    'icon-image': ['concat', 'explorer-summit-', ['get', 'status']],
    'icon-size': ['interpolate', ['linear'], ['zoom'], 8.5, 0.58, 11.5, 0.75, 16, 1],
    'icon-padding': 1,
    'icon-pitch-alignment': 'viewport',
    'symbol-sort-key': ['get', 'priority'],
    'text-field': ['step', ['zoom'], '', 12.5, ['get', 'name']],
    'text-font': ['Noto Sans Bold'],
    'text-optional': true,
    'text-size': 11,
    'text-anchor': 'top',
    'text-offset': [0, 0.83],
  };
  const summitPaint = {'text-color': '#344c41', 'text-halo-color': '#fffefa', 'text-halo-width': 1.5};
  // At overview scales show the visible skyline. Other measured peaks appear on approach.
  map.addLayer({
    id: 'discovered-summits-other',
    type: 'symbol',
    source: 'discovered-summits',
    minzoom: 14,
    filter: ['!=', ['get', 'status'], 'visible'],
    layout: summitLayout,
    paint: summitPaint,
  });
  map.addLayer({
    id: 'discovered-summits',
    type: 'symbol',
    source: 'discovered-summits',
    minzoom: 8.5,
    filter: ['==', ['get', 'status'], 'visible'],
    layout: summitLayout,
    paint: summitPaint,
  });
  map.addLayer({
    id: 'summit-highlight',
    type: 'symbol',
    source: 'summit-highlight',
    layout: {
      ...summitLayout,
      'icon-image': ['concat', 'explorer-summit-', ['get', 'status'], '-focus'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 8, 0.8, 12, 1.05],
      'icon-anchor': 'bottom',
      'icon-offset': [0, -4],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['step', ['zoom'], '', 8, ['get', 'name']],
      'text-anchor': 'left',
      'text-offset': [1.24, -1.2],
    },
    paint: summitPaint,
  });
  map.addLayer({
    id: 'terrain-trace',
    type: 'line',
    source: 'terrain-trace',
    paint: {
      'line-color': '#624e3c',
      'line-width': 2,
      'line-opacity': 0.82,
      'line-dasharray': [2, 2],
    },
  });
  map.addLayer(
    {
      id: 'analysis-sector',
      source: 'analysis-sector',
      type: 'line',
      paint: {'line-color': '#3f6557', 'line-dasharray': [3, 2], 'line-width': 2},
    },
    beforeLabels,
  );
  function sector(p, r, g) {
    let features = [];
    if (p && g.sectorWidth < 360) {
      const origin = coord(p),
        rad = Math.PI / 180,
        d = r / 6371008.8,
        phi = p.lat * rad;
      const endpoint = (deg) => {
        const a = deg * rad,
          lat = Math.asin(Math.sin(phi) * Math.cos(d) + Math.cos(phi) * Math.sin(d) * Math.cos(a));
        return [
          p.lon +
            Math.atan2(
              Math.sin(a) * Math.sin(d) * Math.cos(phi),
              Math.cos(d) - Math.sin(phi) * Math.sin(lat),
            ) /
              rad,
          lat / rad,
        ];
      };
      const edge = [origin];
      for (let j = 0; j <= 60; j++)
        edge.push(endpoint(g.sectorBearing - g.sectorWidth / 2 + (j * g.sectorWidth) / 60));
      edge.push(origin);
      features = [
        {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: edge}},
      ];
    }
    map.getSource('analysis-sector').setData(collection(features));
  }
  let markers = [],
    hover = null;
  function marker(p, cls, title) {
    if (!p || !Number.isFinite(p.lon)) return null;
    const dot = document.createElement('span');
    dot.className = 'detail-trace-dot ' + cls;
    dot.title = title;
    return new maplibregl.Marker({element: dot, subpixelPositioning: true})
      .setLngLat(coord(p))
      .addTo(map);
  }
  function trace(points, g) {
    for (const m of markers) m.remove();
    markers = [];
    map.getSource('terrain-trace').setData(
      collection(
        points.length > 1
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: points.reduce((a, p) => {
                    let lon = p.lon;
                    if (a.length) lon += 360 * Math.round((a[a.length - 1][0] - lon) / 360);
                    a.push([lon, p.lat]);
                    return a;
                  }, []),
                },
              },
            ]
          : [],
      ),
    );
    if (g?.status === 0) {
      const det = marker(
        points[g.blockerIndex],
        'determining',
        g.complete ? 'Height-limiting obstruction' : 'Largest known obstruction',
      );
      const first = marker(points[g.firstIntersectionIndex], '', 'First obstruction');
      markers = [det, first].filter(Boolean);
    }
  }
  function summit(p) {
    return point(p, {
      id: p.id,
      name: p.name || '',
      status: p.status,
      priority: -(p.catalogElevationM ?? p.modelElevationM ?? 0),
    });
  }
  return {
    sector,
    peaks: (peaks) => map.getSource('discovered-summits').setData(collection(peaks.map(summit))),
    pick: (screen) => {
      if (!screen) return null;
      const padding = 4;
      const hits = map.queryRenderedFeatures(
        [[screen.x - padding, screen.y - padding], [screen.x + padding, screen.y + padding]],
        {layers: ['summit-highlight', 'discovered-summits', 'discovered-summits-other']},
      );
      return hits[0]?.properties.id ?? null;
    },
    highlight: (p) => map.getSource('summit-highlight').setData(collection(p ? [summit(p)] : [])),
    trace,
    hover: (p) => {
      hover?.remove();
      hover = marker(p, 'inspect', 'Terrain profile sample');
    },
  };
}
export default {attach};
