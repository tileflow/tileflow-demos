# Sun on the street

How much of every sidewalk is in the sun, every five minutes of every day of the year, shaded by
buildings and street trees. Live at <https://maps.tileflow.dev/sun-on-the-street/>.

```bash
pnpm install
pnpm dev:sun-on-the-street
```

The map is a Tileflow Streets map (`tileflow.config.ts`) shown with `@tileflow/dom`. On top of it the
app draws its own MapLibre custom layer (`src/sun-layer.ts`): the ground shadow of every building
and the sidewalks coloured by their sun.

- `src/worker.ts` reads the World vector tiles (buildings, roads and trees) in a pool of workers,
  places sidewalks along both sides of every street and marches a ray towards the sun from each
  point for every five-minute step of the day, on the GPU when there is one (`src/gpu-march.ts`).
  Street trees carry no height in the tiles, so each counts as a typical crown, 10 m high and 3.5 m
  across in radius.
- `src/when.ts` is the chart: the height of the sun by hour, daylight by day of the month, or by
  month, with the months below.
- `src/spot.ts` is the card of a clicked sidewalk: its sun through the whole year.

URL parameters: `view=lng,lat,zoom[,pitch,bearing]`, `date=YYYY-MM-DD`, `time=HH:MM`,
`mode=hour|day|month`, `buildings3d=off`, and `notrees` to leave only the buildings.

Map data © OpenStreetMap contributors.
