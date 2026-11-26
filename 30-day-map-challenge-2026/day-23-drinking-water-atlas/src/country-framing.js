import { geoArea, geoCentroid, geoDistance, geoOrthographic } from "d3-geo";
const rad = Math.PI / 180;
const wrap = (lon) => (((lon % 360) + 540) % 360) - 180;
function unwrap(ring, origin) {
  return ring.map(([x, y]) => [origin + wrap(x - origin), y]);
}
function box(points) {
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity;
  for (const [x, y] of points) {
    west = Math.min(west, x);
    east = Math.max(east, x);
    south = Math.min(south, y);
    north = Math.max(north, y);
  }
  return [west, south, east, north];
}
export function countryFrame(row, features) {
  const anchor = [row.lon, row.lat],
    parts = [];
  for (const f of features) {
    for (const rings of f.geometry.type === "Polygon"
      ? [f.geometry.coordinates]
      : f.geometry.coordinates) {
      const g = { type: "Polygon", coordinates: rings };
      const area = geoArea(g),
        center = geoCentroid(g),
        distance = geoDistance(anchor, center) / rad;
      if (area > 0 && Number.isFinite(distance))
        parts.push({ area, center, distance, rings });
    }
  }
  if (!parts.length)
    return {
      center: anchor,
      extent: [0.0028, 0.0028],
    };
  parts.sort(
    (a, b) =>
      b.area / (1 + (b.distance / 30) ** 2) -
      a.area / (1 + (a.distance / 30) ** 2),
  );
  const main = parts[0];
  const total = parts.reduce((s, p) => s + p.area, 0);
  const archipelago = main.area / total < 0.64;
  const limit = archipelago
    ? 46
    : Math.max(0.25, (Math.sqrt(main.area) / rad) * 1.25);
  let nearby = parts.filter(
    (p) =>
      p === main ||
      (p.area >= main.area * 0.038 &&
        geoDistance(main.center, p.center) / rad <= limit),
  );
  // For remote island groups a joint bounding box can be almost entirely ocean.
  // Keep the main island in view and retain the group's national statistic.
  if (nearby.length > 1 && archipelago) {
    const boxAll = box(
      nearby.flatMap((p) => unwrap(p.rings[0], main.center[0])),
    );
    const area =
      (boxAll[2] - boxAll[0]) *
      (boxAll[3] - boxAll[1]) *
      rad *
      rad *
      Math.cos(main.center[1] * rad);
    if (nearby.reduce((sum, p) => sum + p.area, 0) / area < 0.04)
      nearby = [main];
  }
  const outline = nearby.flatMap((p) => unwrap(p.rings[0], main.center[0]));
  const span = box(outline);
  const center = [wrap((span[0] + span[2]) / 2), (span[1] + span[3]) / 2];
  const projection = geoOrthographic()
    .rotate([-center[0], -center[1]])
    .scale(1)
    .translate([0, 0]);
  const xy = box(outline.map((p) => projection(p)));
  const extent = [
    Math.max(Math.abs(xy[0]), Math.abs(xy[2])) * 2,
    Math.max(Math.abs(xy[1]), Math.abs(xy[3])) * 2,
  ].map((n) => Math.max(n, 0.00005));
  return { center, extent };
}
