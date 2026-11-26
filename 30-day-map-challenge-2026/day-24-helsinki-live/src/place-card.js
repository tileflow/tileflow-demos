import {berthZoom} from './station-symbols.js';
import {overviewEnd} from './fleet-lights.js';

export const sidePanel = matchMedia('(min-width: 760px) and (min-height: 500px)');

const lerp = (a, b, fraction) => a + (b-a)*Math.max(0,Math.min(1,fraction));

export function createPlaceProjection(map) {
  const metrics = document.createElement('canvas').getContext('2d');
  metrics.font = '12px "Noto Sans", sans-serif';
  // MapLibre may suppress a symbol when neighbouring labels collide.
  // Audit the selected symbol after each placement, rather than querying
  // all the rendered features on every animation frame.
  let cached;
  const invalidate = () => { cached = null; };
  map.on('moveend', invalidate);
  map.on('idle', invalidate);
  map.once('remove', () => {
    map.off('moveend', invalidate);
    map.off('idle', invalidate);
  });
  function shown(layer, id, p) {
    if (!map.getLayer(layer)) return false;
    if (cached?.layer === layer && cached.id === id) return cached.visible;
    const hits = map.queryRenderedFeatures([[p.x-54,p.y-35],[p.x+54,p.y+18]], {layers:[layer]});
    const visible = hits.some(f => String(f.properties.id) === String(id));
    cached = {id, layer, visible};
    return visible;
  }
  return function project({kind, id, coordinate, platform, parent, shelter, physical, preferPole}) {
    const ground = map.project(coordinate), zoom = map.getZoom();
    const point = (type, x, y, halfWidth, halfHeight) => ({type, x, y, halfWidth, halfHeight});
    const fallback = () => point('location', ground.x, ground.y, 4, 4);
    const pole = () => point('pole', physical.x, physical.y,
      Math.max(3,(physical.right-physical.left)/2), Math.max(4,(physical.bottom-physical.top)/2));
    if (preferPole && physical) return pole();
    if (kind === 'terminal') {
      if (zoom >= 13.5 && zoom < berthZoom && shown('hsl-terminals', id, ground)) {
        return point('terminal',ground.x,ground.y,11,11);
      }
      return fallback();
    }
    if (platform && zoom >= berthZoom && shown('hsl-berths',id,ground)) {
      return point('platform',ground.x,ground.y,metrics.measureText('Platform '+platform).width/2+5,8);
    }
    if (physical) return pole();
    const flagLayer = parent ? 'hsl-unnumbered-berths' : 'hsl-station';
    if (!platform && zoom >= (parent ? berthZoom : overviewEnd) && shown(flagLayer,id,ground)) {
      const scale = parent ? .72 : zoom < 17 ? lerp(.48,.72,(zoom-overviewEnd)/(17-overviewEnd)) : lerp(.72,.84,(zoom-17)/2);
      // Art is 32 × 36 CSS pixels with a bottom anchor at the foot of its post.
      const y = ground.y - (shelter ? 17.5 : 19) * scale;
      return point('flag',ground.x,y,(shelter?15:11)*scale,11*scale);
    }
    return fallback();
  };
}
