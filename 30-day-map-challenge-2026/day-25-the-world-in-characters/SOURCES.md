# Making The World in Characters

The browser application is maintained directly in `public/viewer.mjs` and `public/detail/`. Its editable modules handle projection, geographic sampling, type placement, collision detection, gesture transitions and GPU drawing. The globe uses 24,383 character marks and 100 name records. The three map styles and the generated geographic assets are checked in, so serving the application requires no geographic preprocessing.

## The original plate and the globe

From this challenge directory, Python 3 can regenerate the flat styles and the globe from the supplied typeset frame, ocean contours, world geometry and relief samples:

```sh
python3 scripts/visor-dev/prepare.py
python3 scripts/globo/build-globe.py
```

The original artwork is in `scripts/mapamundi/atlas.js`. Rebuild that standalone plate with `python3 scripts/mapamundi/build.py`. The result is `scripts/mapamundi/plate.html`. The Tileflow style definition and 1600 × 900 symbol capture are in `scripts/tile/`. To make a new captured frame after editing the original artwork, install that directory's dependencies with npm and run the following from the challenge root with Chrome installed:

```sh
npm install --prefix scripts/tile
node scripts/tile/export-frame.mjs scripts/mapamundi/plate.html scripts/tile/native
python3 scripts/visor-dev/prepare.py
```

For animation sources, install `npm install --prefix scripts/qa`, then run `node scripts/visor-dev/frames.mjs` and `node scripts/visor-dev/portrait-frames.mjs` after building the standalone plate. The wave and road positions are sampled before rasterization. The interactive runtime selects the active globe, regional atlas or street data.

## Tileflow and the street worker

The browser SDK is built from Tileflow SDK f6b85223e7859d80f27b13ae97ca4990406aa5b6. MapLibre GL JS 6.19.0 and esbuild 0.28.2 are pinned in the build tool's npm lockfile. Use Node 24+ and pnpm 11.13.1. In a checkout at that commit, run `pnpm install --frozen-lockfile` and `pnpm --filter @tileflow/dom... run build`. Then from this challenge directory, with `TILEFLOW_SDK_CHECKOUT` set to that checkout's absolute path:

```sh
npm ci --prefix scripts/visor-dev/sdk
node scripts/visor-dev/sdk/build.mjs public/runtime "$TILEFLOW_SDK_CHECKOUT"
node scripts/visor-dev/detail-data/build.mjs "$TILEFLOW_SDK_CHECKOUT"
node scripts/visor-dev/detail-data/check-geometry.mjs
node scripts/visor-dev/detail-data/check-worker.mjs
```

The last two checks run offline. They cover antimeridian geometry, clipping, polygon holes, ocean inheritance, caching, cancellation and concurrent tile reads. The character atlas is generated from the bundled JetBrains Mono font. With the SDK tool dependencies, Chrome and the QA dependencies installed, run `node scripts/visor-dev/build-glyph-atlas.mjs` to rebuild it.

## Geographic inputs

| Source | Rebuild and attribution |
| --- | --- |
| Natural Earth | `scripts/world/fetch.py` downloads the archives and verifies the recorded SHA-256 hashes. `scripts/world/prepare.py` builds the world data. The public-domain source URLs and hashes are recorded in `public/detail/natural-earth.json`. The Python data scripts use pyshp 2.3.1 and Shapely. |
| Relief and land mask | `scripts/relief/prepare.py` samples [NOAA ETOPO 2022](https://doi.org/10.25921/fd45-gt74). `scripts/visor-dev/landmask.py` uses Pillow. For higher resolution terrain, download the NetCDF URL recorded in `public/detail/terrain/index.json` as `scripts/visor-dev/topography.nc` and run `scripts/visor-dev/topography.py` with NumPy. |
| Iberian and regional geography | After fetching the Natural Earth archives, `scripts/visor-dev/navigation.py`, `scripts/iberia-media/build-network.py`, `scripts/iberia-media/geodata/build.py`, `scripts/iberia-media/build-relief.py` and `scripts/iberia-media/transition/build-surrounds.py` generate the regional network, labels and relief. The elevation-point input for `scripts/corona-region/geodata/build_peak_index.py` is bundled. |
| Spanish administrative areas | `scripts/corona-region/ign-regions.py` retrieves the official IGN extract and computes regional anchors. Obra derivada de BDLJE CC-BY 4.0 ign.es. `scripts/corona-region/make-border-countries.py` generates the country boundary rings from Natural Earth. |
| Madrid | `scripts/zoom-revision/districts.py` uses the supplied Ayuntamiento de Madrid input dated 31 August 2026. The data attribution and municipal terms are in `public/detail/madrid-districts.json`. The separate ODbL road and park database and its copying terms are in `public/detail/madrid-navigation/`. To regenerate those cells, use the Geofabrik URL and SHA-256 in its index, save the archive as `scripts/zoom-revision/madrid-open-gpkg.zip`, extract its GeoPackage as `scripts/zoom-revision/madrid.gpkg` and run `scripts/zoom-revision/madrid-navigation.py`. |
| Worldwide streets | The browser reads [Tileflow World and World Detail](https://api.tileflow.dev/tiles/world,world-detail/tiles.json) at runtime. Tileflow and OpenStreetMap credits are displayed with the data. |

SDK and renderer notices are in `public/runtime/`. The two typeface licenses are in `public/fonts/`. D3 and InternMap notices accompany the authoring libraries in `scripts/mapamundi/vendor/`.
