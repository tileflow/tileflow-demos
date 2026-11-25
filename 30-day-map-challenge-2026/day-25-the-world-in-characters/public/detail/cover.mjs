const limit = 85.05112878;
const mod = (value, period) => ((value % period) + period) % period;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const mercatorY = lat => (1 - Math.asinh(Math.tan(clamp(lat,-limit,limit) * Math.PI/180)) / Math.PI) / 2;

export function viewport(bounds, zoom, maxzoom = 15, minzoom = 0) {
  const [west,south,east,north] = bounds;
  const span = Math.abs(east-west) >= 360 ? 360 : mod(east-west,360);
  const left = mod(west+180,360)/360;
  const y0 = mercatorY(Math.max(south,north));
  const y1 = mercatorY(Math.min(south,north));
  const zmax = clamp(Math.floor(zoom),minzoom,maxzoom);
  for (let z = zmax; z >= minzoom; z--) {
    const n = 2 ** z;
    const x0 = Math.floor(left*n);
    const x1 = Math.min(x0+n-1, Math.max(x0,Math.ceil((left+span/360)*n)-1));
    const top = clamp(Math.floor(y0*n),0,n-1);
    const bottom = clamp(Math.max(top,Math.ceil(y1*n)-1),0,n-1);
    if ((x1-x0+1)*(bottom-top+1)>32 && z>minzoom) continue;
    const tiles = [];
    for (let y=top; y<=bottom; y++) for (let x=x0; x<=x1; x++) {
      const canonical = mod(x,n);
      const d = Math.hypot(x-(x0+x1)/2,y-(top+bottom)/2);
      tiles.push({z,x:canonical,y,key:[z,canonical,y].join('/'),d});
    }
    tiles.sort((a,b) => a.d-b.d || a.y-b.y || a.x-b.x);
    const w = left*360-180, e=w+span;
    const longitudeRanges = e<=180 ? [[w,e]] : [[w,180],[-180,e-360]];
    return {tiles, z, longitudeRanges, south:Math.min(south,north), north:Math.max(south,north)};
  }
}

export function intersects(bbox, view) {
  return bbox[1] <= view.north && bbox[3] >= view.south && view.longitudeRanges.some(([w,e]) => bbox[0] <= e && bbox[2] >= w);
}

// Each input uses canonical longitude intervals, including a split at the dateline.
export function containsView(outer,inner) {
  const eps=1e-9;
  return outer.south<=inner.south+eps && inner.north<=outer.north+eps &&
    inner.longitudeRanges.every(([w,e])=>outer.longitudeRanges.some(([a,b])=>a<=w+eps && e<=b+eps));
}
