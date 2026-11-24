// Rebuild the deterministic geographic lattice used in the world view.
import { readFile, writeFile } from "node:fs/promises";

const source =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_admin_0_map_units.geojson";
const raw = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], "utf8"))
  : await (await fetch(source)).json();
const attributions = { SOL: "SOM", CYN: "CYP", KOS: "XKX" };
const countries = {
  type: "FeatureCollection",
  features: raw.features.map(({ geometry, properties: p }) => ({
    type: "Feature",
    properties: {
      code:
        p.ISO_A3_EH !== "-99"
          ? p.ISO_A3_EH
          : attributions[p.ADM0_A3] || p.ADM0_A3,
    },
    geometry,
  })),
};
const polygons = [];
for (const feature of countries.features) {
  const shapes =
    feature.geometry.type === "MultiPolygon"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];
  for (const rings of shapes) {
    const xs = rings[0].map((p) => p[0]),
      ys = rings[0].map((p) => p[1]);
    polygons.push({
      rings,
      code: feature.properties.code,
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    });
  }
}
function inside(x, y, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i],
      [c, d] = ring[j];
    if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a) hit = !hit;
  }
  return hit;
}
const dots = {};
const step = 1.85;
for (let row = 0, lat = -85; lat <= 85; row++, lat += step) {
  const columns = Math.round((360 * Math.cos((lat * Math.PI) / 180)) / step);
  for (let col = 0; col < columns; col++) {
    const lon = -180 + ((col + (row % 2 ? 0.75 : 0.25)) * 360) / columns;
    for (const {
      rings,
      box: [w, s, e, n],
      code,
    } of polygons) {
      if (
        lon < w ||
        lon > e ||
        lat < s ||
        lat > n ||
        !inside(lon, lat, rings[0]) ||
        rings.slice(1).some((r) => inside(lon, lat, r))
      )
        continue;
      (dots[code] ??= []).push([+lon.toFixed(3), +lat.toFixed(3)]);
      break;
    }
  }
}
await writeFile(
  new URL("../src/globe-dots.json", import.meta.url),
  JSON.stringify(dots),
);
console.log(
  `${countries.features.length} features, ${Object.values(dots).flat().length} grid dots`,
);
