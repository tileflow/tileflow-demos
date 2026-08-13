import { defineTileflow, labels, osm, poi } from "@tileflow/core";

export default defineTileflow({
  themes: {
    light: {
      colors: {
        background: "#f7f6f3",
        land: "#f1eee8",
        water: "#8ed6e8",
        park: "#b6e6bf",
        building: "#faf6e8",
        road: "#ffffff",
        roadMajor: "#e9ddc7",
        roadCasing: "#b7b0a6",
        boundary: "#c9ced3",
        text: "#53606b",
        textMuted: "#7c8996",
        textHalo: "#ffffff",
      },
      modules: {
        labels: {
          road: "#7a8794",
          water: "#4b8fa8",
        },
        poi: {
          coffee: "#b45309",
          culture: "#7c3aed",
          food: "#d97706",
          transit: "#2563eb",
        },
      },
      typography: {
        font: "Inter",
      },
    },
  },
  maps: {
    madrid: {
      basemap: osm(),
      theme: "light",
      modules: [
        labels({
          roads: "minimal",
          water: "balanced",
        }),
        poi({
          preset: "balanced",
          categories: ["food", "coffee", "culture", "transit"],
          icons: false,
          minZoom: 14,
        }),
      ],
      view: {
        center: [-3.7038, 40.4168],
        zoom: 15,
      },
    },
  },
});
