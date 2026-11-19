# Follow your nose · Tileflow

**SNIFF!** — a colourful arcade smell map for day 19 of the 2026 30 Day Map Challenge. Pick a starting point on the map and explore real streets around the world with a character that brings a foggy neighbourhood to life.

## Run

```sh
pnpm install
pnpm dev
ppnpm test
pnpm build
```

The start screen opens at New York Harbor, or at your location when access is already granted. Tap the map, drag the character pin or pan to choose a starting point. “Use my location” can request access when you choose to use it.

Choose a place on the Tileflow map and select a character before playing. The dog spawns on a clear mapped street. Run with WASD, arrow keys, the mobile joystick, or by clicking the ground. Diagonal inputs have the same maximum speed as cardinal inputs, with a brief, frame-rate-independent acceleration and fast reversal. The manual camera bearing remains stable. Buildings and water block movement; mapped bridges remain usable. Street data streams as the player explores.

Space / Jump performs anticipation, a 5.6-metre cartoon arc with tucked paws and springing ears, and a compressed landing. Low construction fences, poop and potholes can be jumped. Tall worksite barriers close a street and require a detour; cars, buses and crowds remain dangerous. A fence cannot trap the dog if it lands on its edge. Hold E, Enter or Sniff to lower the muzzle and widen the explored area around the dog. The extra map colour stays as you move. A temporary trail shows the scent of a nearby dish, and explored streets show food whether or not the dog is sniffing. Hold Shift or Sprint for a faster run. Tap a spot to go there or drag to pan the map.

The dog has three hearts and 60 active seconds for the first bite, with shorter limits as cravings take more dishes. Each required bite refills the current timer. Choose a dog, T. rex, fox or capybara before playing. The city stays visible on the start screen, and the distance-based fog comes in when play starts. Walk over needed food to send its 3D model into the HUD: 100 points with up to ×3 combo; completed tastings add 300 points and one or two stars before the next selection appears. Any item of a needed category counts. Other food stays available for later. Ground items are at least 34 metres apart and paella pans are at least 90 metres apart. Hot food has rising steam. No roof icons, labels or ground discs.

Cars and buses follow closed road circuits and nudge the dog sideways on impact; there are no exhaust hazards. Poop, potholes and protest crowds cause damage. Damage produces one second of stumbling, dizzy stars and recovery, with two seconds of invulnerability. Ctrl / Rest heals one heart every three safe seconds with an animated 3D heart meter above the dog. Pause and hiding the page freeze round time. Large mobile action buttons support simultaneous movement and jumping. Original synthesised background music begins after a user gesture and can be muted with the sound button.

“▶ 30 s” plays a 30-second camera tour, then leaves the resulting map explorable. `?film=1` starts the tour after map loading. This is an in-browser animation, not a pre-rendered video export.

## Map and data

The basemap extends Tileflow Streets with a custom playful dawn theme: warm lanes, bright parks and turquoise water. A persistent world-space reveal mask composites opaque, softly moving fog over the full unexplored 3D scene; walking gradually restores the original colours. Three.js renders the dog, OSM building footprints and aroma effects in a MapLibre custom layer. Ceramic cups, pastries, ice cream and dishes are 3D meshes at street level, without roof ornaments, DOM labels or circular markers. Each building has a permanent deterministic pastel wall/roof pair independent of its business type. The dog uses ordinary depth testing, including its collar. The follow camera uses a damped position spring, a 16°/s yaw limit and a 5°/s downward pitch limit with clearance hysteresis. The bearing stays fixed while steering manually, so the camera cannot rotate the controls under the player. It still follows position and eases pitch for visibility. Automatic click-to-walk and the film can turn the camera. Sitting does not change its bearing, zoom or lighting. Intervening buildings fade softly while the camera adjusts; the dog keeps ordinary depth testing. The seated dog glances from side to side and wags its tail. A recovery indicator appears if it needs to heal.

The active street graph, buildings and business types stream from Tileflow World vector tiles. The loader obtains the current tile URL from public TileJSON, decodes tiles in a Web Worker, caches at most 32 tiles, and prefetches streets after 230 metres of movement. Roads are welded across tile seams and split at same-level intersections; different bridge levels are kept separate. All mapped components remain available. Private roads, roads marked no-foot, underground rail and motorways are excluded. Data gaps and disconnected components remain possible. Native basemap buildings are disabled to avoid overlapping geometry.

The exploration mask uses a sparse persistent grid with a sliding GPU window, so walking beyond the former 700-metre boundary retains earlier colour. The original Madrid OSM snapshot remains bundled as a regression fixture and is not the runtime world boundary.

These are playful interpretations of place types, not measured smells or business reviews. Bakeries and cafés represent pastries and coffee. Restaurants can yield paella, pizza, ramen, burgers or ice cream according to mapped business tags and names. Missing heights are estimated. Business points use footprint containment, with a maximum 8-metre nearest-footprint fallback. Fog reveals the original colours of all buildings and ground, independently of POI discovery.

Data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The derived neighbourhood and street datasets in `public/` retain that licence. Map tiles © Tileflow / OpenStreetMap; on-map attribution is retained.

To regenerate business/building data from an official OSM JSON map response, run `node scripts/prepare-neighbourhood.mjs /absolute/path/to/map.json`.

## Verification

`pnpm test` covers round scoring, harmless surplus food, healing, stun and invulnerability, sparse tastings, item density, fog persistence, diagonal speed, frame-rate-independent acceleration, reversal, wall and fence collisions, landing recovery, the jump arc, traffic direction, safe scent routing, route fading, graph connectivity, projections and camera smoothing. `pnpm build` also checks TypeScript. Browser QA covers mobile layout, city travel, gameplay and the changing map.

## Hosting

[Play SNIFF!](https://maps.tileflow.dev/sniff/). The shared maps Worker builds this app under
`/sniff/`. The deployment instructions are in [sites/maps](../../sites/maps/README.md).
