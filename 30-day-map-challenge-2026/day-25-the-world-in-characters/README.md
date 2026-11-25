# The World in Characters

Day 25 of the 2026 30DayMapChallenge · **Is This a Map?**

Drag the globe to turn it. Zoom in to follow a coastline, read a region or trace a street. Every boundary, road and wave on the paper is drawn with letters or punctuation. On the globe or overview, press Space to toggle animated ink. Press Home to return to the world.

[Open the map](https://maps.tileflow.dev/the-world-in-characters/)

## Run locally

From the repository root, run the following commands and open the address printed by Vite.

```sh
pnpm install --frozen-lockfile
pnpm --filter @tileflow-demos/the-world-in-characters dev
```

The map uses the Tileflow SDK with bundled geography for the globe and regional atlas. The street atlas reads worldwide vector tiles from Tileflow's public catalog. A shared view can include a camera position, for example [the Iberian Peninsula](https://maps.tileflow.dev/the-world-in-characters/?z=5.379&lat=39.700661&lon=-6.354206).

The viewer and typesetting modules are in `public/`. [Source data, credits and rebuilding the atlas](SOURCES.md).

The [short film and its original score](film/) follow the printed itinerary from the rotating globe to the Grand Canal.
