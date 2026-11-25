// Cast shadows and sky visibility for a Web Mercator elevation mosaic.
// The map's hillshade already draws slopes facing away from the light, so this
// raster adds only what a per-pixel hillshade cannot see: shadows thrown by
// distant ridges and the darkening of valleys that see less of the sky.

const RAD = Math.PI / 180;

export const RELIEF_DEFAULTS = Object.freeze({
  sunAzimuth: 315, // degrees clockwise from north, matching the hillshade light
  sunElevation: 25, // degrees above the horizon
  sunRadius: 3, // apparent radius in degrees; larger values soften the penumbra
  exaggeration: 1.5,
  shadowDistance: 8000, // metres searched toward the sun
  skyDistance: 1500, // metres searched for the sky-view factor
  skyDirections: 8,
  shadowStrength: 0.5,
  skyStrength: 0.8,
  color: [28, 38, 52],
});

// Highest elevation angle, as a tangent, seen from (x, y) toward (dx, dy).
function horizon(h, width, height, x, y, h0, dx, dy, metres, maxPixels) {
  let best = -Infinity;
  for (let d = 1; d < maxPixels; d += Math.max(1, d * 0.06)) {
    const sx = x + dx * d,
      sy = y + dy * d;
    if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) break;
    const ix = sx | 0,
      iy = sy | 0,
      fx = sx - ix,
      fy = sy - iy,
      i = iy * width + ix;
    const v =
      (h[i] * (1 - fx) + h[i + 1] * fx) * (1 - fy) +
      (h[i + width] * (1 - fx) + h[i + width + 1] * fx) * fy;
    const t = (v - h0) / (d * metres);
    if (t > best) best = t;
  }
  return best;
}

/**
 * Shade the circle of `radiusPx` around `centre` in a mosaic of `width` × `height`
 * elevations spaced `metres` apart. Returns the RGBA raster of the square that
 * encloses the circle and that square's mosaic pixel bounds.
 */
export function shadeRelief({heights, width, height, metres, centre, radiusPx}, options = {}) {
  const o = {...RELIEF_DEFAULTS, ...options};
  const left = Math.max(1, Math.floor(centre.x - radiusPx)),
    top = Math.max(1, Math.floor(centre.y - radiusPx));
  const right = Math.min(width - 2, Math.ceil(centre.x + radiusPx)),
    bottom = Math.min(height - 2, Math.ceil(centre.y + radiusPx));
  const w = right - left + 1,
    hgt = bottom - top + 1,
    rgba = new Uint8ClampedArray(w * hgt * 4);
  const h = new Float32Array(heights.length);
  for (let i = 0; i < h.length; i++) h[i] = heights[i] * o.exaggeration;

  const az = o.sunAzimuth * RAD,
    el = o.sunElevation * RAD,
    r = o.sunRadius * RAD;
  const sun = [-r, 0, r].map((a) => [Math.sin(az + a), -Math.cos(az + a)]);
  const light = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  const sky = Array.from({length: o.skyDirections}, (_, k) => {
    const a = (2 * Math.PI * k) / o.skyDirections;
    return [Math.sin(a), -Math.cos(a)];
  });
  const shadowPx = o.shadowDistance / metres,
    skyPx = o.skyDistance / metres;
  const fadeStart = radiusPx * 0.8;

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const dist = Math.hypot(x - centre.x, y - centre.y);
      if (dist > radiusPx) continue;
      const i = y * width + x,
        h0 = h[i];
      // Surface normal from central differences (image rows increase southward).
      const gx = (h[i + 1] - h[i - 1]) / (2 * metres),
        gy = (h[i + width] - h[i - width]) / (2 * metres);
      const facing =
        (-gx * light[0] + gy * light[1] + light[2]) / Math.sqrt(gx * gx + gy * gy + 1);

      let visible = 0;
      for (const [dx, dy] of sun) {
        const angle = Math.atan(horizon(h, width, height, x, y, h0, dx, dy, metres, shadowPx));
        visible += Math.min(1, Math.max(0, (el - angle) / (2 * r) + 0.5));
      }
      visible /= sun.length;
      // Only shadows that fall on sunlit slopes are new; the hillshade darkens the rest.
      const cast = (1 - visible) * Math.min(1, Math.max(0, facing / 0.35));

      let svf = 0;
      for (const [dx, dy] of sky) {
        const angle = Math.max(0, Math.atan(horizon(h, width, height, x, y, h0, dx, dy, metres, skyPx)));
        svf += Math.cos(angle) ** 2;
      }
      svf /= sky.length;

      const fade = dist < fadeStart ? 1 : 1 - (dist - fadeStart) / (radiusPx - fadeStart);
      const alpha = Math.min(0.65, o.shadowStrength * cast + o.skyStrength * (1 - svf)) * fade;
      const k = ((y - top) * w + (x - left)) * 4;
      rgba[k] = o.color[0];
      rgba[k + 1] = o.color[1];
      rgba[k + 2] = o.color[2];
      rgba[k + 3] = Math.round(alpha * 255);
    }
  }
  return {rgba, w, h: hgt, left, top, right: right + 1, bottom: bottom + 1};
}
