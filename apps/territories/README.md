# Dispatch Territories

Explore a Portland delivery week. Color the service areas by volume or on-time rate, then select an area on the map or in the ranked list. On-time rates use the count of punctual deliveries divided by all deliveries in the same area or week.

From the repository root, run `pnpm install`, then `pnpm dev:territories`. All area metrics come from the included dataset.

## Data

Tileflow created the fictional dispatch boundaries, delivery counts and rider counts in `src/regions.ts`. This fictional data is published under the repository [license](../../LICENSE). These service areas are illustrative. The shared Tileflow basemap displays its own attribution.
