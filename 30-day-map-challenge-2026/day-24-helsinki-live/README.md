# Helsinki Live

Day 24 · Network · 30 Day Map Challenge 2026

Explore Helsinki Regional Transport buses on Tileflow Streets. The map starts in 3D near the Lauttasaari corridor with a bus in service. Click a bus to highlight its complete trip and stops in berry while keeping the current camera view. Other buses keep their blue 100 m previews. Choose **Follow** to watch the selected bus at street level. Choose a destination after searching for a line to see the buses and ordered stops serving that direction. Stops in search show example routes and destinations. **Nearby stops** lists platforms by distance from the map centre, with an optional **Use my location** action. Open a departure to keep its boarding estimate on the bus card, or open a stop from a bus and use **Back** to restore the previous view. The full trip fades behind the selected bus as it advances. Pan to release the camera. Choose **Fit route** to zoom to the complete trip. Helsinki’s solar position selects the native Streets `timeOfDay` preset (dawn, day, dusk or night). Streets supplies the building materials and lighting. The controls follow the same period.

## Run

From the repository root, install with `pnpm install --frozen-lockfile` and run `pnpm --filter @tileflow-demos/helsinki-live dev`. For a production build use the same filter with `build` and `preview`.

## Transit data

- [HSL GTFS-RT](https://hsldevcom.github.io/gtfs_rt/) supplies observed vehicle locations and trip updates. The browser polls positions every three seconds and predictions every fifteen seconds. The service date, start time, route and direction identify a trip. A vehicle moves only between observations. Its last fix ages out after 90 seconds. The stop board uses live predictions and links to HSL's timetable.
- [HSL high-frequency positioning](https://digitransit.fi/en/developers/apis/5-realtime-api/vehicle-positions/high-frequency-positioning/) supplies one-second position and door readings where available for the selected bus. The selected bus opens its doors when an HFP reading reports an opening. The feed provides a combined door state, so the model moves its passenger doors together.
- [HSL's published GTFS ZIP](https://infopalvelut.storage.hsldev.com/gtfs/hsl.zip) supplies the route shapes, stop order and stop names. The catalogue includes its publication date and validity range. Refresh with `python3 scripts/prepare_network.py /path/to/hsl.zip` before the catalogue expires, then rebuild. Diversions can differ from the published street geometry.
- Transit data © Helsinki Regional Transport (HSL), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The initial catalogue was delivered on 24 November 2026. Map and map-data credits are provided by Streets.

## Vehicles and road placement

The 2026 Nobina Yutong U12-B is reconstructed from the Finnish manufacturer's [dimensions and equipment](https://www.yutong.fi/static/res/2026/6/6/product/cpzl/6b6b7eed47ad452a9c0f24c10b916cea.pdf), the [Nobina 1523 fleet record](https://bussikirjasto.fi/esb/kortti.php?haku=YMN-923), and [VynedJ's photograph of Nobina 1526](https://commons.wikimedia.org/wiki/File:Nobina_1526_20260822.jpg). The Helsinki configuration has a 12.17 m body, a 6.00 m wheelbase and front, middle and rear door groups with 2, 2 and 1 leaves. The mesh and its graphics are drawn in the demo. Verified Nobina fleet IDs 1503–1532 use this body; other vehicles have a generic symbol. The opening view prefers an active U12 on line 21. Select **Street view** to inspect the bus at street level.

Positions are matched to the directed shape of the vehicle's trip using the reported next stop, ordered distances from the GTFS schedule, heading and recent progress. The model interpolates between observations along the trip. At junctions it follows a bounded curve between the incoming and outgoing lanes and averages directed street headings over the 12 m body, with a bounded correction from the street geometry. A shape that doubles back within that span can fall back to a location dot. Animation timing accounts for observed delivery intervals as well as the whole-second GPS timestamps. Blue previews fade over the next 100 m of each recently located bus’s matched route. At street zoom it also uses the drivable centreline from loaded Streets tiles, respecting one-way carriageways. A dot marks the location when the route or carriageway cannot be reliably matched. This represents the vehicle's travel direction and an estimated road position; HSL does not publish a precise lane or individual door telemetry.

The dashboard credits Helsinki Region Transport with the [HSL/HRT mark from its developer site](https://github.com/HSLdevcom/dev.hsl.fi/blob/master/logo.png). The stop symbol is drawn for this map, following the blue bus-on-a-post convention of the [HSL journey planner](https://github.com/HSLdevcom/digitransit-ui/blob/v3/packages/digitransit-component/icon/src/assets/bus-stop-hsl.svg).

## Serving the demo

The repository's maps build mounts the demo at `/helsinki-live/`. Its two same-origin feed endpoints relay the public HSL protobuf responses, which lack browser CORS headers. Vite provides the endpoints in development and preview. The maps Worker provides them in the combined deployment. The WebSocket connection for the selected bus goes directly to HSL.
