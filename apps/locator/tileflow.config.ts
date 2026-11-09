import { defineMap, disable, labels } from "@tileflow/core";
import { streets, streetsThemes } from "@tileflow/maps";

export default defineMap({
  id: "locator",
  name: "Linha Coffee in Lisbon",
  version: 1,
  extends: streets,
  themes: { light: streetsThemes.faded },
  defaultTheme: "light",
  modules: { poi: disable(), labels: labels({ language: "pt", roads: "major" }) },
  view: { center: [-9.1483, 38.7206], zoom: 12.7 },
});
