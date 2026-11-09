# Linha Coffee

Search six Lisbon shops by name or neighborhood, filter their amenities, or select a shop on the map. **Near me** shows your position with the three nearest matching shops and calculates distances on your device. If every shop is over 50 km away, the map stays in place.

From the repository root, run `pnpm install`, then `pnpm dev:locator`. To look up a street in the Lisbon area, set `TILEFLOW_DEMO_SEARCH_KEY` in the server environment before starting Vite on localhost. The **Find near this address** action uses Tileflow Search with a server credential that grants `geocoding:read`. Returned attributions appear with the results. A static build uses the included directory.

## Data

Tileflow created the fictional shops, locations, hours and amenities in `src/stores.ts` and dedicates them to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The shared Tileflow basemap displays its own attribution.
