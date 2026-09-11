import { defineMap, labels, poi } from "@tileflow/core";
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
      roads: "highways",
      water: "major",
    }),
    poi: poi({
      categories: ["food-drink", "arts-entertainment", "transport"],
      color: "category",
    }),
  },
  view: {
    center: [-3.7038, 40.4168],
    zoom: 15,
  },
});
