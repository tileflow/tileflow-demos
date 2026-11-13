import { defineMap, disable, labels } from "@tileflow/core";
import { streets, streetsThemes } from "@tileflow/maps";

const view = { center: [-9.1483, 38.7206] as [number, number], zoom: 12.3 };

export default defineMap({
  id: "locator",
  name: "Linha Coffee in Lisbon",
  version: 1,
  extends: streets,
  themes: { light: streetsThemes.faded },
  defaultTheme: "light",
  modules: { poi: disable(), labels: labels({ language: "pt", roads: "major" }) },
  view,
  scenes: {
    "locator-desktop": {
      theme: "light",
      camera: { type: "center", ...view },
      viewport: { width: 1024, height: 720, dpr: 1 },
      target: { kind: "application", path: "/", captureId: "locator", frame: "viewport" },
    },
  },
});
