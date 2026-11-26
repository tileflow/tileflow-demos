// Optional regeneration from Natural Earth's immutable vector snapshot. An optional
// directory supplies the same five downloaded GeoJSON files for offline builds.
import { readFile, writeFile } from "node:fs/promises";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import { quantize } from "topojson-client";
const upstream =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/";
const collection = (features) => ({ type: "FeatureCollection", features });
async function load(name) {
  const f = `ne_10m_${name}.geojson`;
  return (
    process.argv[2]
      ? JSON.parse(await readFile(`${process.argv[2]}/${f}`, "utf8"))
      : await (await fetch(upstream + f)).json()
  ).features;
}
// Map units preserve separate statistical geographies such as French Guiana,
// Réunion, the Caribbean Netherlands and Tokelau. Keep a single geometry for
// other countries so constituent regions are not mistaken for national borders.
const extended = new Set(["FRA", "NLD", "NZL"]);
const [national, units] = await Promise.all([
  load("admin_0_countries"),
  load("admin_0_map_units"),
]);
const entities = [
  ...national.filter((f) => !extended.has(f.properties.ADM0_A3)),
  ...units.filter((f) => extended.has(f.properties.ADM0_A3)),
];
const countries = collection(
  entities.map((f) => {
    const p = f.properties;
    return {
      type: "Feature",
      properties: {
        code:
          p.ISO_A3_EH !== "-99"
            ? p.ISO_A3_EH
            : { KOS: "XKX", SOL: "SOM", CYN: "CYP" }[p.ADM0_A3] || p.ADM0_A3,
      },
      geometry: f.geometry,
    };
  }),
);
function compact(objects, threshold, quantization) {
  const topo = presimplify(topology(objects));
  // Preserve small, individually closed rings. The same area threshold suitable
  // for a mainland would erase an enclave such as Vatican City or a coral island.
  for (const arc of topo.arcs) {
    if (arc.length < 3) continue;
    const first = arc[0],
      last = arc[arc.length - 1];
    const tiny = arc.every(
      (p) =>
        Math.abs(p[0] - first[0]) < 0.11 && Math.abs(p[1] - first[1]) < 0.11,
    );
    if (tiny || (first[0] === last[0] && first[1] === last[1])) {
      const keep = tiny ? 18 : arc.length < 120 ? 12 : 5;
      for (const p of arc
        .slice(1, -1)
        .sort((a, b) => b[2] - a[2])
        .slice(0, keep))
        p[2] = Infinity;
    }
  }
  return quantize(simplify(topo, threshold), quantization);
}
const world = compact({ countries }, 0.0007, 1e7);
await writeFile(
  new URL("../src/world.topo.json", import.meta.url),
  JSON.stringify(world),
);
function groupLines(features) {
  const groups = new Map();
  for (const { geometry } of features) {
    if (!geometry) continue;
    for (const line of geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.coordinates) {
      const mid = line[Math.floor(line.length / 2)];
      const key = `${Math.floor(mid[0] / 8)},${Math.floor(mid[1] / 8)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(line);
    }
  }
  return collection(
    [...groups.values()].map((coordinates) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "MultiLineString", coordinates },
    })),
  );
}
const provinces = groupLines(
  (await load("admin_1_states_provinces_lines")).filter(
    (f) => f.properties.SHAPE_LENG > 0.025,
  ),
);
const rivers = groupLines(
  (await load("rivers_lake_centerlines")).filter(
    (f) => f.properties.scalerank <= 8,
  ),
);
const lakes = collection(
  (await load("lakes"))
    .filter((f) => f.properties.scalerank <= 7)
    .map((f) => ({ ...f, properties: {} })),
);
const detail = compact({ provinces, rivers, lakes }, 0.003, 1e6);
await writeFile(
  new URL("../src/detail.topo.json", import.meta.url),
  JSON.stringify(detail),
);
