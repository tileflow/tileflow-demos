# Drinking Water Atlas

An interactive map for day 23 of the 2026 30DayMapChallenge, Senses: Taste. The glass represents 1,000 people in the selected place. The measure is the percentage of people using safely managed drinking water services, SDG indicator 6.1.1. The reference year is 2024. The WHO/UNICEF Joint Monitoring Programme (JMP) provides the national and world estimates. The atlas marks its own approximations in the card and the dataset.

## Open the map

[Explore Drinking Water Atlas](https://maps.tileflow.dev/drinking-water-atlas/). To run it locally, install the workspace dependencies with `pnpm install --frozen-lockfile`, then run `pnpm --filter @tileflow-demos/drinking-water-atlas dev`.

## Explore

Hover over a country to highlight its outline. The statistics card follows the selection. Click or tap a country, or choose it from the location menu, to open its glass. Click another country to switch. Click the water or press Escape to close the glass and clear the selection. Clicks on the glass leave the selection in place. A wheel or pinch gesture zooms the actual geographic camera around the pointer or fingers. Drag to move the map. The location menu includes the world aggregate.

Selecting a country frames it beside the transparent glass with a slight turn of the map. On a phone the country sits above it. The 1,000 dots lift off the map, cross the rim and glide straight into position. Green dots circulate above coral dots while the water level stays fixed. Labels show each group's count and percentage. You can drag and make small zoom adjustments with the glass open. Zooming in or out by 1.25 levels (about 2.4×) clears the selection at the current map position. Reduced-motion mode opens the completed view immediately.

Escape returns to the world view. End frames the selected glass. Share a location with `?country=THA&stage=glass`; stage values include `world`, `country` and `glass`. The earlier sample stage and links using `pais` or `etapa` still open.

## Edit and rebuild

- `src/tileflow.config.mjs` defines the Tileflow theme and layers. `src/globe.js` uses MapLibre's native camera and includes a Canvas fallback.
- `src/app.js` updates the figures and the glass when the selection changes. `src/particles.js` draws the vessel and the two populations within it.
- `public/data/agua.csv` and `public/data/agua.json` include the source year, method and explanatory note for each place. Their filenames are retained for compatibility.
- Run `pnpm --filter @tileflow-demos/drinking-water-atlas build` from the workspace root to build the map with Vite. The shared maps build sets the public base path.
- Run `python3 scripts/prepare_water.py` to rebuild the coverage data. The JSON records the source addresses and SHA-256 digests. Run `node scripts/prepare-geography.mjs` for the world dot lattice and `node scripts/prepare-detail.mjs` for the Natural Earth 1:10m geographic layers. The bathymetry uses depth ranges from Natural Earth. Rebuild it with `python3 scripts/prepare-bathymetry.py` (requires Shapely 2.x). Source regeneration requires internet access.
