# Day 20 · Hexagonize

**Hexagons** asks for a map built from hexagons. [2026 challenge themes](https://30daymapchallenge.com/#2026-themes)

Land and sea floor as one relief of hexagonal columns. Move the sea level to see the coast of the last Ice Age or a world without ice; hover a cell to see when the sea reaches it.

## Run locally

In this directory, run the following with Node.js 24 and pnpm.

```sh
pnpm install
pnpm dev
```

The map is a managed Tileflow Map: `public/map/manifest.json` is its manifest, and `tileflow deploy --map-id map_tvmwFQ2baiqotKqX` publishes changes to `tileflow.config.ts`.

Elevation © [Mapterhorn](https://mapterhorn.com/attribution) sources; map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
