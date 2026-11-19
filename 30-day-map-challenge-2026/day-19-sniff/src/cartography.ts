import type { ExpressionSpecification, FilterSpecification, LineLayerSpecification, Map as MapLibreMap } from 'maplibre-gl';

import {roadPalette} from './road-palette';

const overviewRoadColors = new Map(Object.entries(roadPalette.overview));
const rippleId = 'sniff-water-ripples';
function ripplePattern() {
 const canvas = document.createElement('canvas');
 const size = canvas.width = canvas.height = 256;
 const context = canvas.getContext('2d')!;
 context.lineWidth = 1.1;
 context.lineCap = 'round';

 for (let row = 0; row < 8; row++) {
  for (let column = 0; column < 5; column++) {
   const seed = row * 19 + column * 13;
   const centre = column * 51 + (row % 2) * 23 + 6 + seed % 17;
   const y = 8 + row * 32 + seed % 11;
   const width = 14 + seed % 12;
   const swell = .85 + seed % 4 * .19;
   const trace = (offset: number) => {
    context.beginPath();
    for (const tile of [-size, 0, size]) {
     const x = centre + tile - width / 2;
     context.moveTo(x, y + offset);
     context.bezierCurveTo(x + width * .12, y + swell + offset, x + width * .18, y - swell * 1.65 + offset, x + width * .32, y - swell * .5 + offset);
     context.bezierCurveTo(x + width * .47, y + swell * 1.05 + offset, x + width * .5, y - swell * 1.9 + offset, x + width * .65, y - swell * .66 + offset);
     context.bezierCurveTo(x + width * .78, y + swell * .15 + offset, x + width * .88, y + swell * 1.35 + offset, x + width, y + offset);
    }
    context.stroke();
   };
   context.strokeStyle = 'rgba(25, 114, 146, 0.10)';
   trace(.9);
   context.strokeStyle = `rgba(246, 255, 255, ${.36 + seed % 7 * .019})`;
   trace(0);
  }
 }

 return context.getImageData(0, 0, size, size);
}

function roadTint(layer: LineLayerSpecification) {
 const match = /^tileflow-road-(?:surface|bridge)-(\w+(?:-major)?)-(fill|rampFill)$/.exec(layer.id);
 if (!match) return;
 const [, roadClass, phase] = match;
 const overview = overviewRoadColors.get(roadClass);
 const original = layer.paint?.['line-color'];
 if (!overview || !original) return;
 // The last authored camera stop preserves Tileflow's feature-specific street colours.
 const detail = Array.isArray(original) && original[0] === 'interpolate' ? original.at(-1) : original;
 if (typeof detail !== 'string' && !Array.isArray(detail)) return;
 const street = detail as string | ExpressionSpecification;
 const outline = phase === 'fill' && (roadClass === 'motorway' || roadClass === 'trunk');
 return { overview, street, outline };
}

export function styleCartography(map: MapLibreMap) {
 const layers = [...map.getStyle().layers];
 const waterIndex = layers.findIndex(layer => layer.id === 'tileflow-water');
 const water = layers[waterIndex];
 if (water?.type === 'fill') {
  const waterSurfaceTop = Math.max(waterIndex, layers.findIndex(layer => layer.id === 'tileflow-water-intermittent'));
  map.addImage(rippleId, ripplePattern());
  const shape = { source: water.source, 'source-layer': water['source-layer'], filter: water.filter };
  // Cover the water side of this outline with the original fill. This leaves a
  // coast shadow without horizontal or vertical seams on the water tile edges.
  map.addLayer({
   ...shape, id: 'sniff-shore-shadow', type: 'line', minzoom: 10,
   layout: { 'line-join': 'round' },
   paint: {
    'line-color': '#386c78',
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 13, 4.7, 17.5, 8],
    'line-blur': ['interpolate', ['linear'], ['zoom'], 10, .6, 13, 1.65, 17.5, 2.8],
    'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, .26, 18, .23],
   },
  }, water.id);
  map.addLayer({
   ...shape, id: 'sniff-water-texture', type: 'fill', minzoom: 10,
   paint: {
    'fill-pattern': rippleId,
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11.5, 1, 14.25, 1, 18.5, .58],
   },
  }, layers[waterSurfaceTop + 1]?.id);
 }

 for (const layer of layers) {
  if (layer.type === 'symbol' && /^tileflow-label-road-network-/.test(layer.id)) {
   map.setPaintProperty(layer.id, 'text-color', ['step', ['zoom'], '#274353', 16.35, roadPalette.label]);
   map.setPaintProperty(layer.id, 'text-halo-color', ['step', ['zoom'], '#fff7e6', 16.35, roadPalette.halo]);
  }
  if (layer.type !== 'line') continue;
  const tone = roadTint(layer);
  if (!tone) continue;
  map.setPaintProperty(layer.id, 'line-color', ['interpolate', ['linear'], ['zoom'], 14.15, tone.overview, 17.55, tone.street]);
  if (!tone.outline || !layer.paint?.['line-width']) continue;
  const openRoad: ExpressionSpecification = ['!=', ['get', 'class'], 'construction'];
  const filter = (layer.filter === undefined ? openRoad : ['all', layer.filter, openRoad]) as FilterSpecification;
  map.addLayer({
   id: `${layer.id}-sniff-overview-edge`, type: 'line', source: layer.source, 'source-layer': layer['source-layer'],
   minzoom: Math.max(10, layer.minzoom ?? 0), maxzoom: 15,
   filter,
   layout: layer.layout,
   paint: {
    'line-color': '#617f8d', 'line-width': .65, 'line-gap-width': layer.paint['line-width'],
    'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 12.25, .43, 13.55, .43, 15, 0],
   },
  }, layer.id);
 }
}
