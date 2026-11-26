import encoded from "./bathymetry.paths.json";
import { oceanBands } from "./atlas-inks.mjs";

// Polygon paths use integer millidegrees with delta-coded unsigned varints.
// Each depth has an independent binary stream and keeps its original holes.
function rounded(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i + ring.length - 1) % ring.length],
      corner = ring[i],
      next = ring[(i + 1) % ring.length];
    // Never bend a clipping edge shared by two polygon tiles.
    if (
      Math.abs(corner[0] % 40) < 0.00001 ||
      Math.abs(corner[1] % 30) < 0.00001 ||
      Math.abs(corner[0]) > 179.99
    ) {
      out.push(corner);
      continue;
    }
    const px = prev[0] - corner[0],
      py = prev[1] - corner[1],
      nx = next[0] - corner[0],
      ny = next[1] - corner[1];
    const p = Math.hypot(px, py),
      n = Math.hypot(nx, ny);
    if (p < 0.045 || n < 0.045 || (px * nx + py * ny) / (p * n) < -0.965) {
      out.push(corner);
      continue;
    }
    const a = Math.min(0.22, 0.18 / p),
      b = Math.min(0.22, 0.18 / n);
    out.push(
      [corner[0] + px * a, corner[1] + py * a],
      [
        corner[0] + (px * a + nx * b) * 0.23,
        corner[1] + (py * a + ny * b) * 0.23,
      ],
      [corner[0] + nx * b, corner[1] + ny * b],
    );
  }
  out.push(out[0]);
  return out;
}
function decode(depth) {
  const input = atob(encoded[depth]);
  let i = 0;
  function uint() {
    let value = 0,
      shift = 0,
      byte;
    do {
      byte = input.charCodeAt(i++);
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    return value;
  }
  function signed() {
    const n = uint();
    return (n >>> 1) ^ -(n & 1);
  }
  const count = uint();
  return Array.from({ length: count }, () => {
    const coordinates = Array.from({ length: uint() }, () => {
      let x = 0,
        y = 0;
      const ring = Array.from({ length: uint() }, () => [
        (x += signed()) / 1000,
        (y += signed()) / 1000,
      ]);
      return rounded(ring);
    });
    return {
      type: "Feature",
      properties: { depth },
      geometry: { type: "Polygon", coordinates },
    };
  });
}
export const bathymetry = {
  type: "FeatureCollection",
  features: oceanBands.flatMap(({ depth }) => decode(depth)),
};
