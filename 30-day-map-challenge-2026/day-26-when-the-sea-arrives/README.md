# Day 26 · When the sea arrives

**Water** asks for a map about that wet thing. [2026 challenge themes](https://30daymapchallenge.com/#2026-themes)

Where the sea could reach as it rises, decade by decade to 2150, in the IPCC's sea-level projections. Pick an emissions scenario, play the years, and hover any place to see when the sea reaches it. The figures count the land the sea takes in view and the people who live there.

The projections are the IPCC's; the flooding is our calculation. Each pixel compares the projected sea level with the ground's elevation, and water enters only where it can flow from today's ocean, so low land behind higher ground stays dry until the sea tops it. Land already below the projected sea in 2020, kept dry by dikes and pumps, is hatched. Mean sea level only: no tides, storm surges or waves.

## Run locally

In this directory, run the following with Node.js 24 and pnpm, then open http://127.0.0.1:5327 (the Map accepts that origin).

```sh
pnpm install
pnpm dev
```

The map is a managed Tileflow Map: `public/map/manifest.json` is its manifest.

## Data

`public/data` holds the prepared data; `scripts/` rebuilds it with Python ([uv](https://docs.astral.sh/uv/)) in a working directory of your choice:

| File | Source | Script |
| --- | --- | --- |
| `sea-level.bin` | IPCC AR6 regional projections, medium confidence, total with vertical land motion; SSP1-2.6, SSP2-4.5 and SSP5-8.5; 17th, 50th and 83rd percentiles; 2020–2150 | `fetch_ar6.py`, then `build_slr.py` (writes `slr.bin.gz`) |
| `population.pmtiles` | GHS-POP R2023A, epoch 2025, 30 arc-seconds, within 120 km of the coast | `build_pop.py` (needs the GHS-POP GeoTIFF and Natural Earth land in `raw/`) |
| `coastal-terrain.pmtiles` | DeltaDTM v1.1 at about 300 m, where Tileflow Terrain carries a surface model | `reduce_dtm.py`, then `build_coast.py` |

Sea-level projections: Fox-Kemper et al. (2021), IPCC AR6 WG1 Chapter 9; Garner et al. (2021), IPCC AR6 Sea Level Projections, doi:10.5281/zenodo.5914709; Kopp et al. (2023), FACTS v1.0. We thank the projection authors for developing and making the sea-level rise projections available, multiple funding agencies for supporting the development of the projections, and the NASA Sea Level Change Team for developing and hosting the IPCC AR6 Sea Level Projection Tool.

Population: Schiavina et al. (2023), GHS-POP R2023A, European Commission, Joint Research Centre (CC BY 4.0).

Coastal terrain: Pronk et al. (2024), DeltaDTM, *Scientific Data* 11, 273 (CC BY 4.0); produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

Elevation © [Mapterhorn](https://mapterhorn.com/attribution) sources; map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
