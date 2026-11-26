// MapLibre interpolates a composite font size over integer source-tile stops.
// Keep its existing curve through the printed camera, then switch at an exact
// fractional camera zoom to the same shaped words at a fixed optical size.
const enlargement=.12;
export function closeWordScale(zoom,upperScale){
  const split=zoom+enlargement,low=Math.floor(split);
  const lower=Math.min(upperScale,2**(low-zoom));
  const upper=Math.min(upperScale,2**(low+1-zoom));
  return lower+(upper-lower)*Math.expm1((split-low)*Math.LN2);
}
export function wordZoomOpacity(id,zoom){
  const close=id.endsWith('-close-type');
  if(!close&&!/-(?:type|road-up|road-down|road-steep)$/.test(id))return 1;
  // A camera-only paint value is evaluated by the renderer during the gesture.
  // Both buckets use the same slot and their visible intervals are disjoint.
  return ['step',['zoom'],close?0:1,zoom+enlargement,close?1:0];
}
