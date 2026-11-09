import { defineMap, disable, labels } from "@tileflow/core";
import { streets, streetsThemes } from "@tileflow/maps";

const view = { center: [-122.65, 45.531] as [number, number], zoom: 11.4 };

export default defineMap({
  id: "territories",
  name: "Portland dispatch territories",
  version: 1,
  extends: streets,
  themes: { light: streetsThemes.monochrome },
  defaultTheme: "light",
  modules: { poi: disable(), labels: labels({ roads: "major" }) },
  view,
  scenes: {
    "territories-desktop": {
      theme: "light",
      camera: { type: "center", ...view },
      viewport: { width: 1024, height: 720, dpr: 1 },
      target: { kind: "application", path: "/", captureId: "territories", frame: "viewport" },
    },
  },
});
