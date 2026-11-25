import {configureTileflowMapLibre, createTileflowMap} from '@tileflow/dom';

export {createTileflowBrandingLink} from '@tileflow/core/browser';

configureTileflowMapLibre({workerUrl: new URL('./renderer/maplibre-gl-worker.mjs', import.meta.url).href});

/** Mount a real Tileflow DOM controller over one locally served style and its sibling data. */
export async function mount(container, styleUrl, options = {}) {
  const key = options.mapName ?? 'world-in-type';
  const style = new URL(styleUrl, document.baseURI).href;
  const manifestUrl = options.manifestUrl
    ? new URL(options.manifestUrl, document.baseURI).href
    : new URL('manifest.json', style).href;
  const {width, height} = container.getBoundingClientRect();
  const initialZoom = Math.log2(Math.min(width * .976, height * 2.02) / 512);
  const controller = createTileflowMap(container, {
    source:{map:key,manifestUrl},
    theme:'paper',
    projection:options.projection ?? 'equalEarth',
    viewMode:'2d',
    center:options.center ?? [0,0],
    zoom:options.zoom ?? initialZoom,
    interactive:options.interactive ?? true,
    navigationControl:false,
    mapOptions:{
      attributionControl:false, renderWorldCopies:false, dragRotate:false, pitchWithRotate:false,
      touchPitch:false, fadeDuration:0, minZoom:-2, maxPitch:0, ...options.mapOptions
    },
    onError:options.onError,
    onLoad:options.onLoad
  });
  try {
    const map = await controller.ready;
    if (!map) throw new Error('Tileflow did not mount an interactive map.');
    return {controller,map,ready:controller.ready};
  } catch (error) {
    controller.destroy();
    throw error;

  }
}
