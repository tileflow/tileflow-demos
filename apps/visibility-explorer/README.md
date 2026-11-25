# Visibility Explorer

[Open the worldwide Outdoors 3D map](https://maps.tileflow.dev/visibility-explorer/) or [open the wide terrain profile](https://maps.tileflow.dev/visibility-explorer/?layout=profile).

Start at Pico do Arieiro in Madeira, search for a peak or enter coordinates. Drag the hiker to choose a viewpoint. The previous radius, overlay and card disappear while you drag. Drop the hiker to calculate the new view, or press Escape to restore the old one. The hiker grows gradually as you zoom in.

Move the pointer across the terrain to read the distance, elevation profile and first obstruction. Click to lock the view. On a touch screen, tap the terrain or drag the target. Drag the background to pan. Within the analysis area, a filled green mountain marks a visible summit, an outlined brown mountain marks a hidden summit and a flag marks the selected or highlighted peak.

**Observer map** shows the Outdoors map from the hiker’s coordinates, with the camera 1.7 m above the rendered ground by default. Change **Eye height above ground** in Settings to try a seated or elevated viewpoint. Aiming turns the camera toward the selected point. Zooming out on the main map or enlarging the preview keeps the eye in place. On desktop, the profile sits at the lower left and the observer map at the lower right. On mobile, tap **Observer map** below the profile to open or close it.

The card’s ellipsis opens visible peaks, the 360° horizon, a close-up of the hiker and settings for radius, observer height and Earth curvature.

## Eye height and visibility

The camera’s optical origin is the selected longitude and latitude, at the elevation of the rendered Outdoors terrain plus the chosen eye height. The preview waits for elevation coverage and a verified camera pose. Changing the radius changes the area surveyed. Turning, resizing and changing radius keep the eyes in place.

The overview classifies cells on a 50 m grid. The foreground uses 5 m samples across a 640 m square around the observer. Point profiles, peak checks and the horizon use source elevation tiles along the rest of the ray when available. The sampler interpolates between source pixels. Smaller sample intervals improve the intersection estimate within the elevation model. Source resolution still determines which terrain features the model contains. At the opening location, source pixels are approximately 16 m across.

The browser audit reconstructs the optical origin from the inverse projection matrix. It also projects a georeferenced summit into the eye view and measures where that ray first hits the rendered terrain. At Pico do Arieiro the previous camera was 1.02 km behind the hiker and 682 m above its local ground. The corrected camera is at 1,797.86 m above sea level, 1.70 m above the ground at the observer. At Gornergrat in the Swiss Alps the same check gives a camera altitude of 3,130.61 m over ground at 3,128.91 m.

The following four sightlines start at Pico do Arieiro with an eye height of 1.70 m.

| Target | Ground distance | Eye-view check |
| --- | ---: | --- |
| Pico do Cedro | 942 m | The rendered ray reaches the summit. The profile marks it visible. |
| Pico Ruivo | 2.90 km | The foreground cuts the ray at 8.91 m. The profile says “Blocked nearby” and gives the model estimate of 9 m in the details. |
| Chiqueiros da Queimada | 3.53 km | The nearest rendered obstruction is 3.17 m away, also shown as “Blocked nearby”. |
| Eirinhas | 4.35 km | The source DEM places an obstruction about 53 m before the summit. The display mesh simplifies this final ridge and the ray just clears it. The profile flags this as a near-summit result. |

Raising the eyes to 10 m at the same coordinates clears the first slope toward Pico Ruivo. The next obstruction occurs at 2.85 km in both the profile and the rendered view, about 52 m before the summit.

The analytical profile includes the selected Earth-curvature and refraction model. The Outdoors scene uses a Mercator terrain mesh whose detail varies with distance. Summit positions, local vegetation, buildings and weather can change the real-world view, especially along grazing sightlines.

### Comparison with national mapping data

At Gornergrat (45.9833365° N, 7.7849888° E), the Swiss federal height service gives a ground elevation of **3,132.7 m**. Outdoors renders **3,128.9 m** at the same coordinates. The camera tracks its own surface to the configured 1.70 m, while the two terrain models differ by **3.8 m** at this point. [swisstopo point measurement](https://api3.geo.admin.ch/rest/services/height?easting=2626840.607890123&northing=1092477.9054255835&sr=2056) · [Service documentation](https://docs.geo.admin.ch/access-data/get-point-height.html)

Two 2 km sightlines start 1.70 m above each model's own ground. Both use the same geographic endpoints, a ground-level target, Earth curvature with zero refraction, and 1,001 samples at 2 m intervals. The Tileflow source has pixels about 13 m across here. The distances below locate the first terrain crossing in each model. [Swiss federal elevation profiles](https://docs.geo.admin.ch/access-data/get-elevation-profile.html)

| Destination from Gornergrat | Visibility in both models | Swiss federal first crossing | Tileflow first crossing |
| --- | --- | ---: | ---: |
| Grid east (45.98325427° N, 7.81079558° E) | Blocked | 1,255 m | 1,252 m |
| Grid west (45.98341282° N, 7.75918197° E) | Blocked | 22 m | 3 m |

The eastern destination at 1.5 km (45.98327539° N, 7.80434389° E) is visible in both models. For the western destination, the first few metres of slope differ enough to move the predicted obstruction by about 19 m. The compact profile says “Blocked nearby” whenever the first intersection is closer than the local terrain resolution. The details retain the estimated distance.

In Madeira, Outdoors gives **1,796.2 m** under the initial marker. The Portuguese weather service records **1,799 m** at its station about **65 m** away. The tourism board lists **1,818 m** for the summit. The station offers a nearby reference. These measurements describe different locations and cannot establish the exact real-world skyline from the marker. [IPMA station inventory, table AI.1](https://www.ipma.pt/resources.www/docs/im.publicacoes/edicoes.online/20250616/STWbCUdPBBMcGidIDmIc/met_20250616_20250616_fog_ex_es_pt.pdf#page=55) · [Madeira Tourism Board](https://www.visitmadeira.com/en/where-to-go/madeira/madeira-peaks/pico-do-areeiro/)

## Development

From the repository root, run `pnpm install --frozen-lockfile` and `pnpm --filter @tileflow-demos/visibility-explorer dev`. The gallery build sets `MAP_BASE=/visibility-explorer/` so the app, workers and sprites can load from the public path.

Run the camera and sightline checks with `pnpm --filter @tileflow-demos/visibility-explorer test`. For the browser checks, install Chromium with `pnpm --filter @tileflow-demos/visibility-explorer exec playwright install chromium`. With the app running, set `MAP_URL` to its URL and run the app’s `test:eye-view`, `test:browser` and `test:relocation` scripts.

The map uses Tileflow Outdoors, Tileflow World and Tileflow Terrain. Madeira includes a bundled 50 m elevation grid for the opening view. Other observer positions fetch terrain at runtime. The peak search includes a local gazetteer and can look up additional places online.
