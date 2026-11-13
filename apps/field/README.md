# Headlands Field Guide

Choose a Marin Headlands walk to explore its route, waypoints and elevation profile. Distance and ascent in the saved guide come from its track. A gap in a live profile means the service returned no height.

From the repository root, run `pnpm install`, then `pnpm dev:field`. To enable **Calculate live walk**, set `TILEFLOW_DEMO_FIELD_KEY` in the server environment before starting Vite on localhost. The credential needs access to Tileflow Routing and Elevation. The server routes through the selected walk's waypoints, then samples the returned geometry. Service failures leave the saved walk available.

## Data

Tileflow created the illustrative paths, waypoint notes, walking times and sample heights in `src/trails.ts`. This fictional data is published under the repository [license](../../LICENSE). The tracks are illustrative and unsuitable for navigation. Live results display their routing and elevation attribution. The shared Tileflow basemap displays its own attribution.
