import {terrainMosaic} from './world-terrain';
import {shadeRelief} from './relief-shading';

const SHADE_RADIUS = 15000,
  SHADOW_MARGIN = 8000;
let latest = 0,
  controller = null;

onmessage = async ({data: d}) => {
  if (d.type !== 'relief') return;
  latest = d.id;
  controller?.abort();
  controller = new AbortController();
  const {signal} = controller;
  try {
    const t0 = performance.now();
    const mosaic = await terrainMosaic(d.lat, d.lon, {signal, radius: SHADE_RADIUS + SHADOW_MARGIN, zoom: 11});
    const t1 = performance.now();
    if (d.id !== latest) return;
    const radiusPx = SHADE_RADIUS / mosaic.metres;
    const shade = shadeRelief({...mosaic, radiusPx});
    const t2 = performance.now();
    if (d.id !== latest) return;
    const coords = [
      mosaic.lngLat(shade.left, shade.top),
      mosaic.lngLat(shade.right, shade.top),
      mosaic.lngLat(shade.right, shade.bottom),
      mosaic.lngLat(shade.left, shade.bottom),
    ];
    postMessage(
      {
        type: 'relief',
        id: d.id,
        w: shade.w,
        h: shade.h,
        rgba: shade.rgba,
        coords,
        metrics: {
          zoom: mosaic.zoom,
          metres: mosaic.metres,
          pixels: shade.w * shade.h,
          terrainMs: t1 - t0,
          shadeMs: t2 - t1,
        },
      },
      [shade.rgba.buffer],
    );
  } catch (error) {
    if (signal.aborted) return;
    postMessage({type: 'relief-error', id: d.id, message: String(error?.message || error)});
  }
};
