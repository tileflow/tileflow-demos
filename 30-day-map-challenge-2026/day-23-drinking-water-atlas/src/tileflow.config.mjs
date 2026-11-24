import { atlasInks as ink, oceanBands, seaPaint } from "./atlas-inks.mjs";
import {
  defineMap,
  defineTheme,
  disable,
  fixed,
  geojsonSource,
  maplibreOverlay,
} from "@tileflow/core";
const source = (name) => geojsonSource({ attribution: name });
const overlay = (source, layers) =>
  maplibreOverlay({ source, layers, placement: "above-labels" });
const line = (id, color, width, opacity = 1) => ({
  id,
  type: "line",
  paint: { "line-color": color, "line-width": width, "line-opacity": opacity },
});
const color = {
  "surface.background": ink.shelf,
  "surface.water": ink.shelf,
  "surface.land": ink.coverage[4],
  "surface.park": ink.coverage[3],
  "surface.building": ink.coverage[2],
  "boundaries.default": "#effff6",
  "roads.default": "#fff",
  "roads.casing": "#fff",
  "roads.major": "#fff",
  "labels.primary": "#05433e",
  "labels.halo": "#fff",
  "labels.muted": "#397b75",
};
const opacitySelection = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  1,
  0,
];
export const config = defineMap({
  id: "atlas-agua",
  name: "Drinking Water Atlas",
  version: 1,
  projection: "globe",
  atmosphere: {
    skyColor: fixed("#f8fbea", { reason: "Warm daylight around the globe" }),
    spaceColor: fixed("#dcefe6", { reason: "Match the atlas background" }),
    horizonColor: fixed("#92d8d2", { reason: "A soft turquoise horizon" }),
    fogColor: fixed("#e2f1e6", { reason: "Daylight over the ocean" }),
    starCount: 0,
    starIntensity: 0,
  },
  defaultTheme: "dia",
  themes: {
    dia: defineTheme({
      id: "dia",
      version: 1,
      colorScheme: "light",
      tokens: { color },
    }),
  },
  modules: Object.fromEntries(
    "addresses aeroways boundaries buildings labels land landforms nautical poi roads transit vegetation water"
      .split(" ")
      .map((k) => [k, disable()]),
  ),
  sources: {
    countries: source("Natural Earth"),
    seabed: source("Natural Earth bathymetry · SRTM Plus"),
    coast: source("Natural Earth coastline"),
    provinces: source("Natural Earth"),
    rivers: source("Natural Earth"),
    lakes: source("Natural Earth"),
    graticule: source("Geographic graticule"),
    dots: source("Natural Earth · WHO/UNICEF JMP"),
    islands: source("Natural Earth · WHO/UNICEF JMP"),
  },
  overlays: {
    abathymetry: overlay(
      "seabed",
      oceanBands.map(({ depth, ink: color }) => ({
        id: `depth-${depth}`,
        maxzoom: 8.6,
        type: "fill",
        filter: ["==", ["get", "depth"], depth],
        paint: { "fill-color": seaPaint(color), "fill-antialias": false },
      })),
    ),
    agrid: overlay("graticule", [line("reticula", ink.graticule, 0.65, 0.36)]),
    bcoast: overlay("coast", [line("coast-halo", ink.coast, 2.0, 0.9)]),
    bcountries: overlay("countries", [
      {
        id: "pais",
        type: "fill",
        paint: { "fill-color": ["get", "color"], "fill-antialias": true },
      },
      line("fronteras", ink.boundary, 0.74, 0.9),
    ]),
    bdetail1: overlay("provinces", [
      { ...line("provincias", ink.province, 0.78, 0.48), minzoom: 2.6 },
    ]),
    bdetail2: overlay("rivers", [
      { ...line("rios", ink.river, 0.92, 0.92), minzoom: 2.7 },
    ]),
    bdetail3: overlay("lakes", [
      {
        id: "lagos",
        type: "fill",
        minzoom: 2.6,
        paint: { "fill-color": ink.lake, "fill-opacity": 0.99 },
      },
    ]),
    cdots: overlay("dots", [
      {
        id: "puntos",
        type: "circle",
        paint: {
          "circle-color": ["get", "ink"],
          "circle-radius": 1.48,
          "circle-opacity": 1,
          "circle-pitch-alignment": "map",
          "circle-pitch-scale": "map",
        },
      },
    ]),
    dislands: overlay("islands", [
      {
        id: "islas",
        type: "circle",
        paint: {
          "circle-radius": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            3.4,
            2.15,
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            1.65,
            0.65,
          ],
          "circle-stroke-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            ink.selection,
            "#f0fff4",
          ],
          "circle-pitch-alignment": "map",
          "circle-pitch-scale": "map",
        },
      },
    ]),
    eoutline: overlay("countries", [
      {
        ...line("pais-activo", ink.selection, 2.15),
        paint: {
          ...line("x", ink.selection, 2.15).paint,
          "line-opacity": opacitySelection,
        },
      },
    ]),
  },
});
