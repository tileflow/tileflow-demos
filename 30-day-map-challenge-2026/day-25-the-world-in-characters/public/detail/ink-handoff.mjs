// Keep both ends of a geographic handoff until it finishes. A reversal uses
// the same field and position. Further deliveries replace one pending target.
export function createInkHandoff(duration = 135) {
  let first = null, second = null, pending = null;
  let position = 0, destination = 1, last = null;
  let startedAtZoom = 0, pendingZoom = 0;
  function reset(chart) {
    first = chart;
    second = pending = null;
    position = 0;
    destination = 1;
    last = null;
  }
  function start(chart, zoom) {
    second = chart;
    startedAtZoom = zoom;
    destination = 1;
    position = 0;
    last = null;
  }
  function advance(time) {
    if (!second) return;
    if (last === null) { last = time; return; }
    // Wider sheets have to cover newly exposed ground during a zoom-out.
    // Finish before the next wider sheet arrives on a sustained wheel burst.
    const span=second.zoom<first.zoom-.05?Math.min(110,duration):duration;
    const step = Math.max(0, time - last) / (pending ? span * .62 : span);
    last = time;
    position = Math.max(0, Math.min(1, position + (destination ? step : -step)));
    if (position !== destination) return;
    const next = pending, zoom = pendingZoom;
    reset(destination ? second : first);
    if (next && next !== first) start(next, zoom);
  }
  return {
    select(chart, zoom, time, instant = false, coverage) {
      if (!chart || !first || instant || chart.projection !== first.projection) {
        reset(chart);
        return;
      }
      advance(time);
      if (!second) {
        if (chart !== first) start(chart, zoom);
      } else if (chart === first || chart === second) {
        destination = Number(chart === second);
        pending = null;
      } else {
        // A wider delivery must paint newly exposed ground in this frame.
        // Keep the already-visible plate with the largest inked footprint as
        // its partner instead of queuing it behind two shrinking rectangles.
        if(coverage){
          const a=coverage(first),b=coverage(second),covered=Math.max(a,b);
          if(covered<.86&&coverage(chart)>covered+.14){
            const common=Math.min(a,b);
            const newArea=Math.max(0,b-a)+common*position;
            const visible=newArea>common*(1-position)?second:first;
            reset(visible);
            start(chart,zoom);
            return;
          }
        }
        pending = chart;
        pendingZoom = zoom;
      }
    },
    advance,
    get first() { return first; },
    get second() { return second; },
    get position() { return position; },
    get startedAtZoom() { return startedAtZoom; }
  };
}

// Columns of the inverse chart-to-screen transform in GLSL order. Both plates
// sample the outgoing plate's coordinates, including when zoom or pan reverses.
export function paperMatrix(xx, xy, yx, yy, scale) {
  const determinant = xx * yy - xy * yx;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return null;
  const gain = scale / determinant;
  return [yy * gain, -xy * gain, -yx * gain, xx * gain];
}
