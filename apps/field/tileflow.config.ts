import { boundsOf } from "@tileflow-demos/shared/geo";
import { trails } from "./src/trails";
import { defineMap, disable, roads } from "@tileflow/core";
import { streets, streetsThemes } from "@tileflow/maps";

const view = { center: [-122.5318, 37.8276] as [number, number], zoom: 13 };

export default defineMap({
  id: "field",
  name: "Marin Headlands walks",
  version: 1,
  extends: streets,
  themes: { light: streetsThemes.light },
  defaultTheme: "light",
  terrain: "hillshade",
  modules: { poi: disable(), roads: roads({ extras: { paths: true } }) },
  view,
  scenes: {
    "field-desktop": {
      theme: "light",
      camera: { type: "bounds", bounds: boundsOf(trails[0].track), padding: 48 },
      viewport: { width: 1024, height: 720, dpr: 1 },
      target: { kind: "application", path: "/", captureId: "field", frame: "viewport" },
    },
  },
});
