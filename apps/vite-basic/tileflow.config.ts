import { defineMap, disable, labels, roads } from "@tileflow/core";
import { streets, streetsThemes } from "@tileflow/maps";

export default defineMap({
  id: "madrid",
  name: "Madrid",
  version: 1,
  extends: streets,
  themes: { light: streetsThemes.light },
  defaultTheme: "light",
  modules: {
    labels: labels({
      language: "es",
      places: "none",
      roads: "major",
      water: "major",
    }),
    poi: disable(),
    roads: roads({
      detail: "major",
      hierarchy: "strong",
      weight: "bold",
      outline: "none",
      extras: { paths: false },
    }),
  },
  view: {
    center: [-3.7038, 40.4168],
    zoom: 15,
  },
});
