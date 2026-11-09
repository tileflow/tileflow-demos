import { defineMap, disable, labels } from "@tileflow/core";
import { streets, streetsThemes } from "@tileflow/maps";

export default defineMap({
  id: "territories",
  name: "Portland dispatch territories",
  version: 1,
  extends: streets,
  themes: { light: streetsThemes.monochrome },
  defaultTheme: "light",
  modules: { poi: disable(), labels: labels({ roads: "major" }) },
  view: { center: [-122.65, 45.531], zoom: 11.4 },
});
