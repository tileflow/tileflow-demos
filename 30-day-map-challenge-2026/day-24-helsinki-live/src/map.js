import {createTileflowMap} from '@tileflow/dom';
import {Marker, LngLatBounds} from 'maplibre-gl';
import {distance, heading, splitShape} from './route-track.js';
import {mapCarriageways} from './carriageways.js';
import {createBusLayer} from './bus-model.js';
import {createStopCard} from './stop-card.js';

const fc = (features) => ({type: 'FeatureCollection', features});
const feature = (type, coordinates, properties = {}) => ({
  type: 'Feature',
  properties,
  geometry: {type, coordinates},
});
const empty = fc([]);
function shelterGeometry(id, ring) {
  const roof = feature('Polygon', [ring], {id, part: 'roof'});
  // Four inset supports describe a rectangular canopy at map scale without inventing walls.
  if (ring.length !== 5) return [roof];
  const corners = ring.slice(0, -1);
  const supports = corners.map(([x, y], i) => {
    const [oppositeX, oppositeY] = corners[(i + 2) % 4];
    const lng = x + (oppositeX - x) * 0.08,
      lat = y + (oppositeY - y) * 0.08;
    const dy = 0.075 / 111320,
      dx = dy / Math.cos((lat * Math.PI) / 180);
    return [
      [lng - dx, lat - dy],
      [lng + dx, lat - dy],
      [lng + dx, lat + dy],
      [lng - dx, lat + dy],
      [lng - dx, lat - dy],
    ];
  });
  return [
    roof,
    feature(
      'MultiPolygon',
      supports.map((ring) => [ring]),
      {id, part: 'support'},
    ),
  ];
}

const vehicleOpacity = ['case', ['get', 'secondary'], 0.68, 1];
const dotOpacity = [
  'interpolate',
  ['linear'],
  ['zoom'],
  14.7,
  vehicleOpacity,
  15.6,
  ['case', ['get', 'onRoute'], 0, vehicleOpacity],
];

export async function makeMap(network, handlers, timeOfDay, amenities = {}) {
  const controller = createTileflowMap(document.querySelector('#map'), {
    source: {map: 'helsinki-streets', manifestUrl: import.meta.env.BASE_URL + 'tileflow/manifest.json'},
    theme: 'light',
    timeOfDay,
    viewMode: '3d',
    navigationControl: false,
    onError: ({code, error}) => console.warn(code, error),
  });
  const map = await controller.ready;
  if (!map) throw Error('Could not open the Streets map.');
  let current = null,
    previews = empty,
    focus = empty,
    calls = empty,
    arrows = empty,
    hasSelection = false,
    showAllTripStops = false,
    renderPoints = empty;
  let selectedTrackLine, selectedRouteId, lastSplitOffset;
  const drawn = new Set(),
    lines = [];
  for (const [id, route] of Object.entries(network.routes)) {
    for (const p of route.patterns) {
      if (drawn.has(p.shape)) continue;
      drawn.add(p.shape);
      lines.push(feature('LineString', network.shapes[p.shape], {id}));
    }
  }
  const align = mapCarriageways(map);
  const allRoutes = fc(lines);
  const signKind = (id) =>
    network.stops[id].platform || network.stops[id].indoorLevel
      ? 'platform'
      : amenities[id]?.shelter
        ? 'sheltered-stop'
        : 'bus-stop';
  const allStops = fc(
    Object.entries(network.stops).map(([id, s]) => feature('Point', s.coordinate, {id, sign: signKind(id)})),
  );
  const roofs = fc(
    Object.entries(amenities).flatMap(([id, data]) =>
      network.stops[id] && !network.stops[id].indoorLevel
        ? (data.roofs ?? []).flatMap((ring) => shelterGeometry(id, ring))
        : [],
    ),
  );
  const stopCard = createStopCard(map, network.stops, (id) => handlers.select('stop', id));

  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'bus-label';
  label.title = 'Show full trip';
  label.addEventListener('click', (event) => {
    event.stopPropagation();
    if (current) handlers.select('bus', current);
  });
  const number = document.createElement('b'),
    destination = document.createElement('span');
  label.append(number, destination);
  const marker = new Marker({element: label, anchor: 'bottom', offset: [0, -17]});
  const sources = (id, data, extra = {}) => {
    if (!map.getSource(id)) map.addSource(id, {type: 'geojson', data, ...extra});
  };
  const add = (layer, before) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  };
  const width = (low, high) => ['interpolate', ['linear'], ['zoom'], 11, low, 18, high];
  const networkOpacity = () => (hasSelection ? 0.24 : 0.6);
  const networkColor = () => (hasSelection ? '#abb9bd' : '#738996');
  function addChevron() {
    if (map.hasImage('hsl-chevron')) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(7, 20);
    ctx.lineTo(16, 11);
    ctx.lineTo(25, 20);
    ctx.strokeStyle = '#345263';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = '#fffaf3';
    ctx.lineWidth = 3.6;
    ctx.stroke();
    map.addImage('hsl-chevron', ctx.getImageData(0, 0, 32, 32), {pixelRatio: 2});
  }
  const signs = (
    await Promise.all(
      ['bus-stop', 'sheltered-stop', 'platform'].map(async (kind) => {
        const response = await fetch(import.meta.env.BASE_URL + kind + '.svg');
        if (!response.ok) throw Error('Could not load a stop symbol.');
        const artwork = await response.text();
        return Promise.all(
          [
            ['local', '#007ac9'],
            ['trip', '#a33866'],
          ].map(async ([tone, ink]) => {
            const img = new Image();
            img.src =
              'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(artwork.replaceAll('#007ac9', ink));
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 72;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 64, 72);
            return {id: tone + '-' + kind, pixels: ctx.getImageData(0, 0, 64, 72)};
          }),
        );
      }),
    )
  ).flat();
  const lowLight = () => ['dusk', 'night'].includes(timeOfDay);
  const routeColor = () => (lowLight() ? '#ff94bd' : '#a33866');
  const routeCase = () => (lowLight() ? '#48233b' : '#fffcf6');
  function previewGradient(selected) {
    const rgb = selected
      ? lowLight()
        ? '255,148,189'
        : '163,56,102'
      : lowLight()
        ? '75,190,251'
        : '0,122,188';
    return [
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      'rgba(' + rgb + ',0.93)',
      0.36,
      'rgba(' + rgb + ',0.68)',
      1,
      'rgba(' + rgb + ',0)',
    ];
  }
  let settingUp = false;
  function layers() {
    if (settingUp || !map.getStyle()?.layers?.length) return;
    settingUp = true;
    try {
      const building = [
        'tileflow-buildings-render-flatShadow',
        'tileflow-buildings-fill',
        'tileflow-buildings-scene-3d',
      ].find((id) => map.getLayer(id));
      sources('hsl-lines', allRoutes, {
        tolerance: 0.7,
        maxzoom: 16,
        attribution:
          '<a href="https://www.hsl.fi/en/opendata" target="_blank" rel="noopener noreferrer">© HSL</a>',
      });
      sources('hsl-stops', allStops);
      sources('hsl-shelters', roofs, {
        tolerance: 0.05,
        maxzoom: 19,
        attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
      });
      sources('hsl-focus', focus);
      sources('hsl-calls', calls);
      sources('hsl-arrows', arrows);
      sources('hsl-previews', previews, {lineMetrics: true, tolerance: 0.08, maxzoom: 18});
      for (const sign of signs) {
        if (!map.hasImage(sign.id)) map.addImage(sign.id, sign.pixels, {pixelRatio: 2});
      }
      addChevron();
      sources('hsl-vehicles', renderPoints);
      add(
        {
          id: 'hsl-network',
          type: 'line',
          source: 'hsl-lines',
          layout: {'line-join': 'round'},
          paint: {
            'line-color': networkColor(),
            'line-opacity': networkOpacity(),
            'line-width': width(0.85, 1.7),
          },
        },
        building,
      );
      for (const [id, color, w] of [
        ['hsl-route-case', routeCase(), 7.2],
        ['hsl-route', routeColor(), 4.6],
      ]) {
        add(
          {
            id,
            type: 'line',
            source: 'hsl-focus',
            layout: {'line-join': 'round', 'line-cap': 'round'},
            paint: {
              'line-color': color,
              'line-width': width(w * 0.53, w),
              'line-opacity': [
                'case',
                ['boolean', ['get', 'passed'], false],
                id === 'hsl-route' ? 0.46 : 0.24,
                1,
              ],
            },
          },
          building,
        );
      }
      for (const selected of [false, true]) {
        add(
          {
            id: selected ? 'hsl-selected-preview' : 'hsl-preview',
            type: 'line',
            source: 'hsl-previews',
            minzoom: 11.5,
            filter: ['==', ['get', 'selected'], selected],
            layout: {'line-cap': 'round', 'line-join': 'round'},
            paint: {
              'line-width': width(3.5, 8),
              'line-gradient': previewGradient(selected),
            },
          },
          building,
        );
      }
      add(
        {
          id: 'hsl-direction',
          type: 'symbol',
          source: 'hsl-arrows',
          minzoom: 15.5,
          layout: {
            'icon-image': 'hsl-chevron',
            'icon-size': 1,
            'icon-rotate': ['get', 'bearing'],
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        },
        building,
      );
      // Only independently mapped outdoor shelter footprints have any physical volume.
      for (const [part, base, top, color] of [
        ['support', 0, 2.35, '#476f71'],
        ['roof', 2.35, 2.52, '#6c9392'],
      ]) {
        add({
          id: 'hsl-shelter-' + part,
          filter: ['==', ['get', 'part'], part],
          type: 'fill-extrusion',
          source: 'hsl-shelters',
          minzoom: 17,
          paint: {
            'fill-extrusion-base': base,
            'fill-extrusion-height': top,
            'fill-extrusion-color': color,
            'fill-extrusion-vertical-gradient': false,
          },
        });
      }
      const stopLayout = {
        'icon-image': ['concat', 'local-', ['get', 'sign']],
        'icon-anchor': 'bottom',
        'icon-padding': 1,
        'icon-ignore-placement': true,
      };
      add({
        id: 'hsl-station',
        type: 'symbol',
        source: 'hsl-stops',
        minzoom: 13.5,
        layout: {...stopLayout, 'icon-size': width(0.46, 0.86)},
      });
      add({
        id: 'hsl-platform-light',
        type: 'circle',
        source: 'hsl-calls',
        filter: ['==', ['get', 'highlight'], true],
        paint: {
          'circle-color': ['case', ['get', 'atStop'], '#56c6ac', '#ac6487'],
          'circle-opacity': ['case', ['get', 'atStop'], 0.36, 0.22],
          'circle-stroke-color': ['case', ['get', 'atStop'], '#206c67', '#90516e'],
          'circle-stroke-width': 1.4,
          'circle-pitch-alignment': 'map',
          'circle-radius': ['case', ['get', 'atStop'], 16, 11],
        },
      });
      add({
        id: 'hsl-call',
        type: 'symbol',
        source: 'hsl-calls',
        filter: ['!', ['get', 'highlight']],
        paint: {'icon-opacity': ['case', ['boolean', ['get', 'passed'], false], 0.52, 1]},
        layout: {
          ...stopLayout,
          'icon-image': ['concat', 'trip-', ['get', 'sign']],
          'icon-size': width(0.56, 0.94),
          'icon-allow-overlap': showAllTripStops,
          'icon-ignore-placement': false,
        },
      });
      add({
        id: 'hsl-next-stop',
        type: 'symbol',
        source: 'hsl-calls',
        filter: ['get', 'highlight'],
        layout: {
          ...stopLayout,
          'icon-image': ['concat', 'trip-', ['get', 'sign']],
          'icon-size': 0.94,
          'icon-allow-overlap': true,
        },
      });
      add({
        id: 'hsl-platform-name',
        maxzoom: 15.3,
        type: 'symbol',
        source: 'hsl-calls',
        minzoom: 13,
        filter: ['==', ['get', 'highlight'], true],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-offset': [1.3, 0],
          'text-anchor': 'left',
          'text-size': 12,
        },
        paint: {'text-color': '#682843', 'text-halo-color': '#fffcf6', 'text-halo-width': 2},
      });
      add({
        id: 'hsl-vehicle',
        type: 'circle',
        source: 'hsl-vehicles',
        paint: {
          'circle-color': [
            'case',
            ['any', ['get', 'selected'], ['get', 'routeSelected']],
            '#9c315c',
            ['get', 'secondary'],
            '#718894',
            '#11618a',
          ],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            ['case', ['get', 'secondary'], 2.5, 3.8],
            18,
            ['case', ['get', 'secondary'], 4.5, 7.5],
          ],
          'circle-opacity': dotOpacity,
          'circle-stroke-opacity': dotOpacity,
        },
      });
      add({
        id: 'hsl-numbers',
        type: 'symbol',
        source: 'hsl-vehicles',
        minzoom: 14,
        filter: ['!', ['get', 'selected']],
        layout: {
          'text-field': ['get', 'line'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-offset': [0, -1.15],
          'text-padding': 6,
        },
        paint: {'text-color': '#12394e', 'text-halo-color': '#fff', 'text-halo-width': 1.6},
      });
      if (!map.getLayer('helsinki-bus-models'))
        map.addLayer(
          createBusLayer(
            map,
            (time, bounds) =>
              map.getZoom() >= 14.7 ? handlers.visible(time, bounds).filter((b) => b.onRoute) : [],
            () => controller.getThemeController()?.getSun(),
          ),
        );
    } finally {
      settingUp = false;
    }
  }
  function setTimeOfDay(next) {
    if (timeOfDay === next) return;
    timeOfDay = next;
    controller.update({timeOfDay});
    for (const [id, property, value] of [
      ['hsl-route', 'line-color', routeColor()],
      ['hsl-route-case', 'line-color', routeCase()],
      ['hsl-preview', 'line-gradient', previewGradient(false)],
      ['hsl-selected-preview', 'line-gradient', previewGradient(true)],
    ]) {
      if (map.getLayer(id)) map.setPaintProperty(id, property, value);
    }
  }
  map.on('idle', layers);
  map.on('style.load', layers);
  layers();
  const set = (id, data) => map.getSource(id)?.setData(data);
  function placesAt(point, radius, layers) {
    const active = layers.filter((id) => map.getLayer(id));
    if (!active.length) return [];
    return map.queryRenderedFeatures(
      [
        [point.x - radius, point.y - radius],
        [point.x + radius, point.y + radius],
      ],
      {layers: active},
    );
  }
  map.on('click', (e) => {
    const stopLayers = ['hsl-next-stop', 'hsl-call', 'hsl-station', 'hsl-shelter-roof'];
    let hit,
      distance = 23;
    for (const bus of handlers.visible(performance.now(), map.getBounds())) {
      const p = map.project(bus.coordinate);
      const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
      if (d < distance) {
        hit = bus.id;
        distance = d;
      }
    }
    if (hit && distance <= 6) return handlers.select('bus', hit);
    const sign = placesAt(e.point, 0, stopLayers)[0];
    if (sign) return handlers.select('stop', sign.properties.id);
    if (hit) return handlers.select('bus', hit);
    const stop = placesAt(e.point, 7, stopLayers)[0];
    if (stop) return handlers.select('stop', stop.properties.id);
    const preview = placesAt(e.point, 2, ['hsl-preview', 'hsl-selected-preview'])[0];
    if (preview) return handlers.select('bus', preview.properties.id);
    const route = placesAt(e.point, 5, ['hsl-route', 'hsl-network'])[0];
    if (route) handlers.select('route', route.properties.id);
  });
  map.on('mousemove', (e) => {
    map.getCanvas().style.cursor = placesAt(e.point, 6, [
      'hsl-station',
      'hsl-next-stop',
      'hsl-call',
      'hsl-preview',
      'hsl-vehicle',
      'hsl-network',
      'hsl-route',
    ]).length
      ? 'pointer'
      : '';
  });
  map.on('dragstart', (e) => {
    if (e.originalEvent) handlers.detach();
  });
  map.on('rotatestart', (e) => {
    if (e.originalEvent) handlers.detach();
  });
  function moveCamera(target, pitch, duration) {
    map.stop();
    map.easeTo({...target, pitch, duration});
  }
  return {
    map,
    setTimeOfDay,
    position: () => map.getCenter(),
    align,
    drawVehicles(buses) {
      renderPoints = fc(
        buses.map((b) =>
          feature('Point', b.coordinate, {
            id: b.id,
            line: b.line,
            selected: b.selected,
            routeSelected: b.routeSelected,
            secondary: b.secondary,
            onRoute: b.onRoute,
          }),
        ),
      );
      set('hsl-vehicles', renderPoints);
      map.triggerRepaint();
    },
    drawPreviews(items) {
      if (!items.length && !previews.features.length) return;
      previews = fc(items.map(({id, selected, path}) => feature('LineString', path, {id, selected})));
      const marks = [];
      if (map.getZoom() >= 15.5) {
        for (const {path} of items) {
          let metres = 0;
          for (let i = 1; i < path.length; i++) {
            metres += distance(path[i - 1], path[i]);
            if (metres < 22) continue;
            marks.push(feature('Point', path[i], {bearing: heading(path[i - 1], path[i])}));
            break;
          }
        }
      }
      arrows = fc(marks);
      set('hsl-previews', previews);
      set('hsl-arrows', arrows);
    },
    geometry(patterns, ids, progress, routeId, call) {
      stopCard.update(call, amenities);
      const fullTrip = Boolean(progress && patterns.length);
      if (showAllTripStops !== fullTrip) {
        showAllTripStops = fullTrip;
        if (map.getLayer('hsl-call')) map.setLayoutProperty('hsl-call', 'icon-allow-overlap', fullTrip);
      }
      const active = Boolean(patterns.length || ids.length);
      if (active !== hasSelection) {
        hasSelection = active;
        if (map.getLayer('hsl-network')) {
          map.setPaintProperty('hsl-network', 'line-opacity', networkOpacity());
          map.setPaintProperty('hsl-network', 'line-color', networkColor());
        }
      }
      selectedTrackLine = fullTrip ? network.shapes[patterns[0].shape] : undefined;
      selectedRouteId = routeId;
      lastSplitOffset = undefined;
      const passedStops = new Set(progress?.passedStops);
      focus = fc(
        patterns
          .filter((p) => network.shapes[p.shape])
          .map((p) => feature('LineString', network.shapes[p.shape], {id: routeId})),
      );
      calls = fc(
        [...new Set(progress?.currentStop ? [...ids, progress.currentStop] : ids)]
          .filter((id) => network.stops[id])
          .map((id) =>
            feature('Point', network.stops[id].coordinate, {
              id,
              name: network.stops[id].name,
              sign: signKind(id),
              passed: fullTrip && passedStops.has(id),
              highlight: progress ? id === progress.currentStop : ids.length === 1,
              atStop: id === call?.id && ['doors', 'at'].includes(call.state),
            }),
          ),
      );
      set('hsl-focus', focus);
      set('hsl-calls', calls);
    },
    tripProgress(track, offset) {
      if (!selectedTrackLine) return;
      if (!track || track.line !== selectedTrackLine) {
        if (lastSplitOffset === undefined) return;
        lastSplitOffset = undefined;
        focus = fc([feature('LineString', selectedTrackLine, {id: selectedRouteId})]);
      } else {
        if (lastSplitOffset !== undefined && Math.abs(lastSplitOffset - offset) < 1) return;
        lastSplitOffset = offset;
        const {passed, remaining} = splitShape(track, offset);
        const parts = [];
        if (passed) parts.push(feature('LineString', passed, {id: selectedRouteId, passed: true}));
        if (remaining) parts.push(feature('LineString', remaining, {id: selectedRouteId, passed: false}));
        focus = fc(parts);
      }
      set('hsl-focus', focus);
    },
    label(bus, coordinate, title) {
      if (!bus) {
        marker.remove();
        current = null;
        return;
      }
      if (number.textContent !== network.routes[bus.route].number)
        number.textContent = network.routes[bus.route].number;
      if (destination.textContent !== title) destination.textContent = title;
      label.hidden = map.getZoom() >= 18.85 || stopCard.nearBus(coordinate);
      const last = marker.getLngLat();
      if (!last || last.lng !== coordinate[0] || last.lat !== coordinate[1]) marker.setLngLat(coordinate);
      if (current !== bus.id) {
        marker.addTo(map);
        current = bus.id;
      }
    },
    fly(coordinate, zoom = 16.5, immediate = false) {
      moveCamera({center: coordinate, zoom}, 53, immediate ? 0 : 650);
    },
    fit(patterns) {
      const bounds = new LngLatBounds();
      for (const p of patterns) {
        for (const coord of network.shapes[p.shape] ?? []) bounds.extend(coord);
        for (const id of p.stops) if (network.stops[id]) bounds.extend(network.stops[id].coordinate);
      }
      if (bounds.isEmpty()) return;
      const camera = map.cameraForBounds(bounds, {padding: 42, maxZoom: 15.9});
      if (camera) moveCamera({center: camera.center, zoom: camera.zoom, bearing: camera.bearing}, 28, 650);
    },
  };
}
