import { defineMap, disable, roads } from "@tileflow/core";
import { streets, streetsThemes } from "@tileflow/maps";

export default defineMap({
  id: "field",
  name: "Marin Headlands walks",
  version: 1,
  extends: streets,
  themes: { light: streetsThemes.light },
  defaultTheme: "light",
  terrain: "hillshade",
  modules: { poi: disable(), roads: roads({ extras: { paths: true } }) },
  view: { center: [-122.5318, 37.8276], zoom: 13 },
});
