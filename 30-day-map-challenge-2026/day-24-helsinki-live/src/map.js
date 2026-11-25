import {createTileflowMap} from '@tileflow/dom';
import {AttributionControl, Marker, LngLatBounds} from 'maplibre-gl';
import {attachCameraControls} from './camera-controls.js';
import {displaySections, mappedSections, networkTrack} from './route-track.js';
import {tripArrows} from './trip-arrows.js';
import {mapCarriageways} from './carriageways.js';
import {lineColor, lineColors, lineIndex} from './line-colors.js';
import {createBusLayer} from './bus-model.js';
import {createFleetBadges} from './fleet-badges.js';
import {
  appendFleetTrail, busModelZoom, fleetLightLayers, forwardHaloLayers, overviewEnd, trailLayerIds, timingColorExpression,
  timingGroup,
} from './fleet-lights.js';
import {terminalLayers, berthLayers, berthZoom, terminalLabelPaint, addPlatformBadge} from './station-symbols.js';
import {createPlaceProjection} from './place-card.js';
import {createBusCardAnchor} from './bus-card-anchor.js';
import {createBuildingOcclusion} from './building-occlusion.js';

const fc = (features) => ({type: 'FeatureCollection', features});
const feature = (type, coordinates, properties = {}) => ({
  type: 'Feature',
  properties,
  geometry: {type, coordinates},
});
const empty = fc([]);
const networkBounds = [[24.64, 60.13], [25.19, 60.34]];
const overviewFit = {padding: 20, maxZoom: 11.3};

class CollapsedAttribution extends AttributionControl {
  onAdd(map) {
    const details = super.onAdd(map);
    // MapLibre 6 opens compact credits the first time a source supplies one.
    // Establish compact mode before insertion, including when the first credits arrive later.
    details.classList.add('maplibregl-compact');
    details.classList.remove('maplibregl-compact-show');
    details.removeAttribute('open');
    return details;
  }
}

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

export async function makeMap(network, handlers, timeOfDay, amenities = {}) {
  const controller = createTileflowMap(document.querySelector('#map'), {
    source: {map: 'helsinki-streets', manifestUrl: import.meta.env.BASE_URL + 'tileflow/manifest.json'},
    theme: 'light',
    timeOfDay,
    viewMode: '3d',
    navigationControl: false,
    mapOptions: {attributionControl: false, bounds: networkBounds, fitBoundsOptions: overviewFit},
    onError: ({code, error}) => console.warn(code, error),
  });
  const map = await controller.ready;
  if (!map) throw Error('Could not open the Streets map.');
  map.addControl(new CollapsedAttribution({compact: true}), 'bottom-right');
  const cameraPitch = attachCameraControls(map, controller);
  const buildingOcclusion = createBuildingOcclusion(map);
  map.hslBuildingOcclusion = buildingOcclusion;
  let lights = fleetLightLayers(timeOfDay);
  let halos = forwardHaloLayers(timeOfDay);
  let current = null,
    previews = empty,
    focus = empty,
    calls = empty,
    arrows = empty,
    previewStops = empty,
    hasSelection = false,
    renderPoints = empty;
  let selectedShape, selectedRouteId, streetLayer;
  function routeFeatures(shape, properties) {
    if (!network.roundaboutGaps?.[shape]) return [feature('LineString', network.shapes[shape], properties)];
    return mappedSections(networkTrack(network, shape)).map((part) => feature('LineString', part, properties));
  }
  const drawn = new Set(),
    lines = [];
  for (const [id, route] of Object.entries(network.routes)) {
    for (const p of route.patterns) {
      if (drawn.has(p.shape)) continue;
      drawn.add(p.shape);
      lines.push(...routeFeatures(p.shape, {id}));
    }
  }
  let focusShapes = [], roadRevision;
  const focusSections = new Map();
  const align = mapCarriageways(map, () => {
    if (focusShapes.length) drawFocus();
  });
  let arrowBounds, arrowZoom;
  function drawTripArrows(force = false) {
    const sections = focusSections.get(selectedShape);
    if (!sections) {
      if (arrowBounds) {
        arrows = empty;
        map.getSource('hsl-arrows')?.setData(arrows);
        arrowBounds = undefined;
      }
      return;
    }
    const zoom = map.getZoom();
    const tier = Math.floor(zoom);
    const bounds = map.getBounds();
    if (!force && tier === arrowZoom && arrowBounds?.contains(bounds.getSouthWest()) &&
        arrowBounds.contains(bounds.getNorthEast())) return;
    // A short pan stays within this margin and uses the existing street marks.
    const dx = (bounds.getEast() - bounds.getWest()) * .25;
    const dy = (bounds.getNorth() - bounds.getSouth()) * .25;
    arrowBounds = new LngLatBounds(
      [bounds.getWest() - dx, Math.max(-90, bounds.getSouth() - dy)],
      [bounds.getEast() + dx, Math.min(90, bounds.getNorth() + dy)],
    );
    arrowZoom = tier;
    arrows = fc(tripArrows(sections, arrowBounds, zoom));
    map.getSource('hsl-arrows')?.setData(arrows);
  }
  function drawFocus(force = false) {
    const road = map.getZoom() >= 15 ? align.centerline : undefined;
    const revision = road?.version ?? -1;
    if (!force && revision === roadRevision) return;
    roadRevision = revision;
    focusSections.clear();
    focus = fc(focusShapes.flatMap(shape => {
      const sections = displaySections(networkTrack(network, shape), road);
      focusSections.set(shape, sections);
      return sections.map(({coordinates}) => feature('LineString', coordinates, {id: selectedRouteId}));
    }));
    map.getSource('hsl-focus')?.setData(focus);
    drawTripArrows(true);
  }
  const allRoutes = fc(lines);
  const signKind = (id) => amenities[id]?.shelter ? 'sheltered-stop' : 'bus-stop';
  const stopPoint = (id) => amenities[id]?.point ?? network.stops[id].coordinate;
  const stationProperties = (id) => ({
    ...(network.parentOf?.has(id) && {parent: network.parentOf.get(id)}),
    ...(network.stops[id].platform && {platform: network.stops[id].platform}),
  });
  const allTerminals = fc(Object.entries(network.terminals ?? {}).map(([id, group]) =>
    feature('Point', group.coordinate, {id, name: group.name, count: group.stops.length}),
  ));
  const allStops = fc(
    Object.keys(network.stops).map((id) =>
      feature('Point', stopPoint(id), {id, sign: signKind(id), ...stationProperties(id)}),
    ),
  );
  const roofs = fc(
    Object.entries(amenities).flatMap(([id, data]) =>
      network.stops[id] && !network.stops[id].indoorLevel
        ? (data.roofs ?? []).flatMap((ring) => shelterGeometry(id, ring))
        : [],
    ),
  );

  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'bus-label';
  label.title = 'Show full trip';
  label.addEventListener('click', (event) => {
    event.stopPropagation();
    if (current) handlers.select('bus', current);
  });
  const number = document.createElement('b');
  label.append(number);
  const badges = createFleetBadges(map, id => handlers.select('bus', id, 'inPlace'));
  const marker = new Marker({element: label, anchor: 'bottom', offset: [0, -17]});
  const dock = document.getElementById('dock');
  const placeProjection = createPlaceProjection(map);
  let tappedPlace;
  const busCard = createBusCardAnchor(map, dock);
  const sources = (id, data, extra = {}) => {
    if (!map.getSource(id)) map.addSource(id, {type: 'geojson', data, ...extra});
  };
  const add = (layer, before) => {
    if (map.getLayer(layer.id)) return;
    map.addLayer(layer, before);
  };
  const width = (low, high) => ['interpolate', ['linear'], ['zoom'], 11, low, 18, high];
  const networkOpacity = () => width(hasSelection ? 0.17 : 0.32, hasSelection ? 0.08 : 0.17);
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
  const signs = await Promise.all(['bus-stop', 'sheltered-stop', 'platform'].map(async (kind) => {
    const img = new Image();
    img.src = import.meta.env.BASE_URL + kind + '.svg';
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return {id: 'local-' + kind, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height)};
  }));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const directionIds = ['hsl-direction', 'hsl-direction-1', 'hsl-direction-2'];
  let lastPulse = null;
  function pulseDirections(time) {
    if (!arrows.features.length) return;
    const active = reducedMotion.matches ? -1 : Math.floor(time / 350) % directionIds.length;
    if (active === lastPulse) return;
    lastPulse = active;
    for (const [i, id] of directionIds.entries()) {
      const intensity = active < 0 ? 0.75 : [0.94, 0.22, 0.48][(i - active + 3) % 3];
      if (map.getLayer(id)) map.setPaintProperty(id, 'icon-opacity', intensity);
    }
  }
  const lowLight = () => ['dusk', 'night'].includes(timeOfDay);
  const routeColor = () => {
    if (!selectedRouteId) return lowLight() ? '#71dfce' : '#08776f';
    return lineColor(network.routes[selectedRouteId]?.number).body;
  };
  const routeCase = () => lowLight() ? '#101b25' : '#354858';
  // Trip rings replace ordinary flags. Numbered boarding points keep their platform badges.
  let modelIds = new Set();
  function syncStopFilters() {
    const selected = calls.features.map(f => f.properties);
    const containsId = ids => ['in', ['get', 'id'], ['literal', ids]];
    const showFlag = ['!', containsId([...modelIds, ...selected.filter(p => p.trip).map(p => p.id)])];
    const filters = {
      'hsl-station': ['all', ['!', ['has', 'parent']], ['!', ['has', 'platform']], showFlag],
      'hsl-platform-sign': ['all', ['!', ['has', 'parent']], ['has', 'platform'], showFlag],
      'hsl-unnumbered-berths': ['all', ['has', 'parent'], ['!', ['has', 'platform']], showFlag],
      'hsl-preview-name': ['!', containsId(selected.map(p => p.id))],
    };
    for (const [id, filter] of Object.entries(filters)) {
      if (map.getLayer(id)) map.setFilter(id, filter);
    }
    if (!map.getLayer('hsl-berths')) return;
    const platforms = selected.filter(p => p.trip && p.platform);
    const next = platforms.find(p => p.highlight);
    const badge = platforms[0]?.badge;
    map.setLayoutProperty('hsl-berths', 'icon-image', badge ? ['case',
      ['==', ['get', 'id'], next?.id ?? ''], 'active-' + badge,
      containsId(platforms.map(p => p.id)), badge, 'hsl-berth-tag',
    ] : 'hsl-berth-tag');
  }
  const onPlatformsChanged = (ids) => {
    modelIds = ids;
    syncStopFilters();
  };
  const nodePaper = () => lowLight() ? '#23373f' : '#fffcf3';
  const nodeFill = () => ['case', ['get', 'highlight'], routeColor(), nodePaper()];
  const nodeOutline = () => ['case', ['get', 'highlight'], nodePaper(), routeColor()];
  let nodeSpriteColour;
  function paintNextNode() {
    const exists = map.hasImage('hsl-current-node');
    const colour = routeColor() + nodePaper();
    if (exists && nodeSpriteColour === colour) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 36;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(18, 18, 13.5, 0, Math.PI * 2);
    ctx.fillStyle = routeColor();
    ctx.fill();
    ctx.strokeStyle = nodePaper();
    ctx.lineWidth = 3.5;
    ctx.stroke();
    const pixels = ctx.getImageData(0, 0, 36, 36);
    if (exists) map.updateImage('hsl-current-node', pixels);
    else map.addImage('hsl-current-node', pixels, {pixelRatio: 2});
    nodeSpriteColour = colour;
  }
  function syncSelectionColors() {
    if (map.getLayer('hsl-next-node')) paintNextNode();
    for (const [id, property, value] of [
      ['hsl-route', 'line-color', routeColor()], ['hsl-route-case', 'line-color', routeCase()],
      ['hsl-platform-light', 'circle-stroke-color', routeColor()],
      ...['hsl-call', 'hsl-numbered-nodes'].flatMap(id => [
        [id, 'circle-color', nodeFill()], [id, 'circle-stroke-color', nodeOutline()],
      ]),
      ['hsl-platform-name', 'text-color', routeColor()],
      ['hsl-platform-name', 'text-halo-color', lowLight() ? '#17242b' : '#fffcf6'],
    ]) if (map.getLayer(id)) map.setPaintProperty(id, property, value);
  }
  function syncDaylightColors() {
    syncSelectionColors();
    if (map.getLayer('hsl-preview-name')) {
      map.setPaintProperty('hsl-preview-name', 'text-color', timingColorExpression(timeOfDay, 'punctuality', 'dayInk'));
      map.setPaintProperty('hsl-preview-name', 'text-halo-color', lowLight() ? '#17242b' : '#fffcf3');
    }
    for (const {id, paint} of halos) {
      if (map.getLayer(id)) map.setPaintProperty(id, 'line-gradient', paint['line-gradient']);
    }
    map.triggerRepaint();
  }
  let settingUp = false;
  function layers() {
    if (settingUp || !map.getStyle()?.layers?.length) return;
    settingUp = true;
    try {
      const restoreStopFilters = !map.getLayer('hsl-station');
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
      sources('hsl-terminals', allTerminals);
      sources('hsl-shelters', roofs, {
        tolerance: 0.05,
        maxzoom: 19,
        attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
      });
      sources('hsl-focus', focus, {tolerance: 0.06, maxzoom: 20});
      sources('hsl-calls', calls);
      sources('hsl-arrows', arrows);
      sources('hsl-preview-stops', previewStops);
      sources('hsl-previews', previews, {lineMetrics: true, tolerance: 0.08, maxzoom: 18});
      for (const sign of signs) {
        if (!map.hasImage(sign.id)) map.addImage(sign.id, sign.pixels, {pixelRatio: 2});
      }
      addChevron();
      paintNextNode();
      addPlatformBadge(map, lineColors);
      for (const [i, color] of lineColors.entries()) {
        const id = 'hsl-number-' + i;
        if (map.hasImage(id)) continue;
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color.body;
        ctx.beginPath();
        ctx.roundRect(0, 0, 32, 24, 5);
        ctx.fill();
        map.addImage(id, ctx.getImageData(0, 0, 32, 24), {
          pixelRatio: 2,
          stretchX: [[6, 26]],
          stretchY: [[5, 19]],
        });
      }
      sources('hsl-vehicles', renderPoints, {tolerance: 0.12, maxzoom: 18});
      add(
        {
          id: 'hsl-network',
          type: 'line',
          source: 'hsl-lines',
          layout: {'line-join': 'round'},
          paint: {
            'line-color': networkColor(),
            'line-opacity': networkOpacity(),
            'line-width': width(0.7, 1.2),
          },
        },
        building,
      );
      for (const layer of lights) if (layer.type === 'line') add(layer, building);
      for (const layer of halos) add(layer, building);
      for (const [id, color, routeWidth] of [
        ['hsl-route-case', routeCase(), width(4.3, 6.6)],
        ['hsl-route', routeColor(), width(2.7, 4.8)],
      ]) {
        add(
          {
            id,
            type: 'line',
            source: 'hsl-focus',
            layout: {'line-join': 'round', 'line-cap': 'round'},
            paint: {
              'line-color': color,
              'line-width': routeWidth,
              'line-opacity': id === 'hsl-route' ? 1 : .64,
            },
          },
          building,
        );
      }
      add({
        id: 'hsl-preview-name',
        type: 'symbol',
        source: 'hsl-preview-stops',
        minzoom: 16,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-anchor': 'left',
          'text-offset': [0.75, 0],
          'text-max-width': 18,
          'symbol-sort-key': ['get', 'arrival'],
        },
        paint: {'text-color': timingColorExpression(timeOfDay, 'punctuality', 'dayInk'),
          'text-halo-color': lowLight() ? '#17242b' : '#fffcf3', 'text-halo-width': 1.7},
      });
      for (const [phase, id] of directionIds.entries()) add(
        {
          id,
          type: 'symbol',
          source: 'hsl-arrows',
          filter: ['==', ['get', 'phase'], phase],
          paint: {'icon-opacity': 0.62, 'icon-opacity-transition': {duration: 275, delay: 0}},
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
      for (const [id, numbered] of [['hsl-station', false], ['hsl-platform-sign', true]]) {
        add({
          id, type: 'symbol', source: 'hsl-stops', minzoom: 12.5,
          ...(numbered && {maxzoom: berthZoom}),
          filter: ['all', ['!', ['has', 'parent']], numbered ? ['has', 'platform'] : ['!', ['has', 'platform']]],
          layout: {
            'icon-image': ['concat', 'local-', ['get', 'sign']], 'icon-anchor': 'bottom',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 12.5, .62, 15, .83, 18, 1],
            'icon-padding': 3,
          },
        });
      }
      for (const [id, numbered] of [['hsl-call', false], ['hsl-numbered-nodes', true]]) {
        const nodeRadius = (size) => ['case', ['get', 'highlight'], size + 2, size];
        add({
          id, type: 'circle', source: 'hsl-calls',
          filter: numbered ? ['has', 'platform'] : ['all', ['get', 'trip'], ['!', ['get', 'highlight']], ['!', ['has', 'platform']]],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, nodeRadius(2.2), 12, nodeRadius(3.3), 16, nodeRadius(5), 19, nodeRadius(6)],
            'circle-pitch-alignment': 'viewport', 'circle-pitch-scale': 'viewport',
            'circle-color': nodeFill(), 'circle-stroke-color': nodeOutline(),
            'circle-stroke-width': ['case', ['get', 'highlight'], 2, 1.6],
          },
        });
      }
      add({
        id: 'hsl-platform-light', type: 'circle', source: 'hsl-calls', minzoom: overviewEnd,
        filter: ['all', ['get', 'highlight'], ['!', ['has', 'platform']]],
        paint: {
          'circle-opacity': 0, 'circle-stroke-color': routeColor(), 'circle-stroke-width': 2,
          'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'viewport',
          'circle-radius': ['case', ['get', 'atStop'], 11, ['get', 'highlight'], 8, 4.5],
        },
      });
      add({
        id: 'hsl-platform-name', type: 'symbol', source: 'hsl-calls', minzoom: 13, maxzoom: 15.3,
        filter: ['all', ['get','trip'], ['get', 'highlight']],
        layout: {
          'text-field': ['get', 'name'], 'text-offset': [1, 0], 'text-anchor': 'left', 'text-ignore-placement': true,
          'text-font': ['Noto Sans Regular'], 'text-size': 12,
        },
        paint: {'text-color': routeColor(), 'text-halo-color': nodePaper(), 'text-halo-width': 2},
      });
      for (const layer of berthLayers(lowLight())) add(layer);
      add({
        id: 'hsl-next-node', type: 'symbol', source: 'hsl-calls',
        filter: ['all', ['get', 'highlight'], ['!', ['has', 'platform']]],
        layout: {
          'icon-image': 'hsl-current-node', 'icon-padding': 4,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 11, .68, 16, 1],
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
      });
      if (restoreStopFilters) syncStopFilters();
      for (const layer of lights) if (layer.type === 'circle') add(layer);
      add({
        id: 'hsl-numbers',
        type: 'symbol',
        source: 'hsl-vehicles',
        minzoom: overviewEnd,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['get', 'selected']], ['!', ['get', 'onRoute']]],
        layout: {
          'text-field': ['get', 'line'],
          'icon-image': ['concat', 'hsl-number-', ['to-string', ['get', 'ink']]],
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [1, 4, 1, 4],
          'text-font': ['Noto Sans Regular'],
          'text-size': 13,
          'text-padding': 2,
          'text-offset': [0, -1.85],
        },
        paint: {'text-color': '#172736'},
      });
      if (!map.getLayer('helsinki-bus-models')) {
        streetLayer = createBusLayer(
          map,
          (time, bounds) =>
            handlers.visible(time, bounds, map.getZoom() < busModelZoom).filter(bus => bus.onRoute || bus.fullTrip),
          () => controller.getThemeController()?.getSun(),
          amenities,
          network.stops,
          () => timeOfDay,
          onPlatformsChanged,
          badges.draw,
        );
        map.addLayer(streetLayer);
        map.addLayer(buildingOcclusion.layer);
        map.moveLayer('hsl-numbers');
      }
    } finally {
      settingUp = false;
    }
  }
  function setTimeOfDay(next) {
    if (timeOfDay === next) return;
    timeOfDay = next;
    lights = fleetLightLayers(next);
    halos = forwardHaloLayers(next);
    controller.update({timeOfDay});
    if (map.getLayer('hsl-terminals')) {
      for (const [key, value] of Object.entries(terminalLabelPaint(lowLight()))) {
        map.setPaintProperty('hsl-terminals', key, value);
      }
    }
    for (const {id, paint} of lights) {
      if (!map.getLayer(id)) continue;
      for (const [property, value] of Object.entries(paint)) map.setPaintProperty(id, property, value);
    }
    syncDaylightColors();
  }
  map.on('move', () => { if (selectedShape) drawTripArrows(); });
  map.on('zoomend', () => { if (focusShapes.length) drawFocus(); });
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
  const stopLayers = ['hsl-next-node', 'hsl-call', 'hsl-numbered-nodes', 'hsl-platform-light', 'hsl-platform-name',
    'hsl-preview-name', 'hsl-station', 'hsl-platform-sign', 'hsl-shelter-roof'];
  function selectPlace(kind, id, pole = false) {
    handlers.select(kind, id, 'inPlace');
    tappedPlace = {kind, id, pole};
  }
  let dragged = false;
  for (const event of ['mousedown', 'touchstart']) map.on(event, () => { dragged = false; });
  map.on('click', (e) => {
    if (dragged || e.originalEvent?.target?.closest?.('button, a, input, select, .maplibregl-ctrl')) return;
    if (handlers.closeMobilePanel()) return;
    const touch = e.originalEvent?.pointerType === 'touch' || e.originalEvent?.sourceCapabilities?.firesTouchEvents;
    let hit, distance = touch ? 15 : 8;
    for (const bus of handlers.visible(performance.now(), map.getBounds())) {
      const p = map.project(bus.coordinate);
      const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
      if (d < distance) {
        hit = bus.id;
        distance = d;
      }
    }
    const object = streetLayer?.pick(e.point);
    if (object?.kind === 'bus') return handlers.select('bus', object.id, 'inPlace');
    const tripStop = placesAt(e.point, 0, ['hsl-next-node', 'hsl-numbered-nodes', 'hsl-call'])[0];
    if (tripStop) return selectPlace('stop', tripStop.properties.id);
    const platform = placesAt(e.point, 0, terminalLayers)[0];
    if (platform) return selectPlace(platform.layer.id === 'hsl-terminals' ? 'terminal' : 'stop', platform.properties.id);
    if (object) return selectPlace(object.kind, object.id, true);
    if (hit && distance <= 6) return handlers.select('bus', hit);
    const number = placesAt(e.point, 0, ['hsl-numbers'])[0];
    if (number) return handlers.select('bus', number.properties.id);
    const sign = placesAt(e.point, 0, stopLayers)[0];
    if (sign) return selectPlace('stop', sign.properties.id);
    if (hit) return handlers.select('bus', hit);
    const stop = placesAt(e.point, touch ? 12 : 8, stopLayers)[0];
    if (stop) return selectPlace('stop', stop.properties.id);
    // Route strokes are visual guides. Keep the open details when a stroke is tapped.
    if (placesAt(e.point, 5, ['hsl-route', 'hsl-network', ...halos.map(layer => layer.id), ...trailLayerIds]).length) return;
    handlers.dismiss();
  });
  map.on('mousemove', (e) => {
    map.getCanvas().style.cursor = placesAt(e.point, 6, [
      ...terminalLayers,
      ...stopLayers,
      'hsl-vehicle',
      'hsl-vehicle-gps',
      'hsl-numbers',
    ]).length || streetLayer?.pick(e.point)
      ? 'pointer'
      : '';
  });
  for (const event of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
    map.on(event, e => {
      if (e.originalEvent) {
        dragged = true;
        handlers.detach();
      }
    });
  }
  // Smooth wheel zooms can dispatch a camera event after the input event has ended.
  const surface = map.getCanvasContainer();
  surface.addEventListener('wheel', handlers.detach, {passive: true, capture: true});
  const controls = document.querySelector('.map-controls');
  controls?.addEventListener('click', handlers.detach, true);
  controls?.addEventListener('input', handlers.detach);
  map.once('remove', () => {
    surface.removeEventListener('wheel', handlers.detach, true);
    controls?.removeEventListener('click', handlers.detach, true);
    controls?.removeEventListener('input', handlers.detach);
  });
  function moveCamera(target, pitch, duration) {
    map.stop();
    map.easeTo({...target, pitch: cameraPitch(pitch), duration});
  }
  return {
    map,
    setTimeOfDay,
    pulseDirections,
    restoreCamera(camera) {
      map.stop();
      map.jumpTo({...camera, pitch: cameraPitch(camera.pitch)});
    },
    position: () => map.getCenter(),
    align,
    drawVehicles(buses) {
      const features = [];
      const trailGroups = new Map();
      for (const bus of buses) {
        const {coordinate, trail, punctuality, ...properties} = bus;
        const ink = lineIndex(bus.line);
        features.push(
          feature('Point', coordinate, {
            ...properties,
            ink,
            ...(punctuality !== undefined && {punctuality}),
            body: lineColors[ink].body,
            trailing: Boolean(trail?.length),
          }),
        );
        if (trail?.length) {
          appendFleetTrail(features, trail, {
            ink, secondary: bus.secondary, stale: bus.stale,
            ...(bus.punctuality ? {punctuality: bus.punctuality} : {}),
          }, trailGroups);
        }
      }
      renderPoints = fc(features);
      set('hsl-vehicles', renderPoints);
      map.triggerRepaint();
    },
    drawPreviews(items) {
      if (!items.length && !previews.features.length) return;
      const firstArrivalByStop = new Map();
      previews = fc(
        items.map(({id, line, path, call, punctuality}) => {
          if (call && network.stops[call.id]) {
            const previous = firstArrivalByStop.get(call.id);
            if (!previous || call.arrival < previous.properties.arrival)
              firstArrivalByStop.set(
                call.id,
                feature('Point', stopPoint(call.id), {
                  id: call.id,
                  punctuality: timingGroup(punctuality),
                  label: line + ' · ' + call.name + ' · ' + call.eta,
                  arrival: call.arrival,
                }),
              );
          }
          return feature('LineString', path, {id, punctuality: timingGroup(punctuality)});
        }),
      );
      previewStops = fc([...firstArrivalByStop.values()]);
      set('hsl-preview-stops', previewStops);
      set('hsl-previews', previews);
    },
    geometry(patterns, ids, progress, routeId, call) {
      const fullTrip = Boolean(progress && patterns.length);
      const active = Boolean(patterns.length || ids.length);
      if (active !== hasSelection) {
        hasSelection = active;
        if (map.getLayer('hsl-network')) {
          map.setPaintProperty('hsl-network', 'line-opacity', networkOpacity());
          map.setPaintProperty('hsl-network', 'line-color', networkColor());
        }
      }
      const shapes = [...new Set(patterns.map((p) => p.shape).filter((shape) => network.shapes[shape]))];
      const tripShape = fullTrip ? patterns[0].shape : undefined;
      const changed = selectedRouteId !== routeId || selectedShape !== tripShape ||
        focusShapes.length !== shapes.length || shapes.some((shape, i) => shape !== focusShapes[i]);
      selectedShape = tripShape;
      selectedRouteId = routeId;
      if (changed) {
        focusShapes = shapes;
        drawFocus(true);
      }
      syncSelectionColors();
      const badge = selectedRouteId ? 'hsl-berth-' + lineIndex(network.routes[selectedRouteId].number) : 'hsl-berth-tag';
      calls = fc(
        [...new Set(progress?.currentStop ? [...ids, progress.currentStop] : ids)]
          .filter((id) => network.stops[id])
          .map((id) =>
            feature('Point', stopPoint(id), {
              id,
              trip: Boolean(selectedRouteId),
              name: network.stops[id].name,
              ...stationProperties(id),
              badge,
              highlight: progress ? id === progress.currentStop : ids.length === 1,
              atStop: id === call?.id && ['doors', 'at'].includes(call.state),
            }),
          ),
      );
      set('hsl-calls', calls);
      syncStopFilters();
    },
    resetBusAnchor() {
      tappedPlace = null;
      busCard.reset();
    },
    labelPlace(kind, id) {
      const stop = kind === 'stop' ? network.stops[id] : null;
      const coordinate = stop ? stopPoint(id) : network.terminals?.[id]?.coordinate;
      if (!coordinate) return busCard.reset();
      const tapped = tappedPlace?.kind === kind && tappedPlace.id === id;
      const anchor = placeProjection({kind, id, coordinate, platform: stop?.platform,
        parent: network.parentOf?.has(id), shelter: amenities[id]?.shelter,
        physical: stop && modelIds.has(id) ? streetLayer?.platformPoint(id) : null, preferPole: tapped && tappedPlace.pole});
      busCard.drawPlace(kind, id, anchor, lowLight() ? '#91d3c4' : '#39796d', tapped);
    },
    label(bus, coordinate, title, showBadge = true) {
      buildingOcclusion.target(bus, coordinate);
      if (!bus) {
        busCard.reset();
        tappedPlace = null;
        marker.remove();
        current = null;
        return;
      }
      if (current !== bus.id) tappedPlace = null;
      const line = network.routes[bus.route].number;
      if (number.textContent !== line || current !== bus.id) {
        number.textContent = line;
        label.style.setProperty('--line-body', lineColor(line).body);
      }
      const name = 'Line ' + line + ' to ' + title;
      if (label.getAttribute('aria-label') !== name) label.setAttribute('aria-label', name);
      const ground = map.project(coordinate);
      const roof = streetLayer?.roofPoint(bus.id);
      let bottom = roof ? roof.top - 5 : ground.y - 10;
      const x = roof?.x ?? ground.x;
      if (bottom < 23) {
        bottom = Math.min(map.getCanvas().clientHeight - 2, (roof?.bottom ?? ground.y) + 27);
      }
      const offset = marker.getOffset();
      const w = map.getCanvas().clientWidth;
      label.hidden = !showBadge || badges.has(bus.id) || ground.x < 0 || ground.x > w || ground.y < 0 || ground.y > map.getCanvas().clientHeight;
      const dx = Math.round(Math.max(18, Math.min(w - 18, x)) - ground.x);
      const dy = Math.round(bottom - ground.y);
      if (dx !== offset.x || dy !== offset.y) marker.setOffset([dx, dy]);
      const last = marker.getLngLat();
      if (!last || last.lng !== coordinate[0] || last.lat !== coordinate[1]) marker.setLngLat(coordinate);
      if (current !== bus.id) {
        marker.addTo(map);
        current = bus.id;
      }
      busCard.draw({busId: bus.id, ground, roof, atStreet: map.getZoom() >= busModelZoom,
        color: lineColor(line).body, lineNumber: line});
      return roof;
    },
    overview() {
      map.fitBounds(networkBounds, {...overviewFit, bearing: 0, pitch: 0, linear: true, duration: 650});
    },
    fly(coordinate, zoom = 16.5) {
      moveCamera({center: coordinate, zoom}, 53, 650);
    },
    fit(patterns) {
      const bounds = new LngLatBounds();
      for (const p of patterns) {
        for (const coord of network.shapes[p.shape] ?? []) bounds.extend(coord);
        for (const id of p.stops) if (network.stops[id]) bounds.extend(network.stops[id].coordinate);
      }
      if (bounds.isEmpty()) return;
      const padding = map.getPadding(), canvas = map.getCanvas();
      const inset = Math.max(0, Math.min(42, (canvas.clientWidth - padding.left - padding.right) / 6,
        (canvas.clientHeight - padding.top - padding.bottom) / 6));
      const camera = map.cameraForBounds(bounds, {padding: inset, maxZoom: 15.9});
      if (camera) moveCamera({center: camera.center, zoom: camera.zoom, bearing: camera.bearing}, 28, 650);
    },
  };
}
