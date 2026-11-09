import { tileflowGroundBeforeId } from "@tileflow/core/browser";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Coordinate } from "@tileflow-demos/shared/geo";

const sourceId = "field-walk";

export function showRoute(map: MapLibreMap, coordinates: Coordinate[]) {
  const geometry = { type: "LineString" as const, coordinates };
  const source = map.getSource<GeoJSONSource>(sourceId);
  if (source) {
    void source.setData(geometry);
  } else {
    map.addSource(sourceId, { type: "geojson", data: geometry });
    const before = tileflowGroundBeforeId(map);
    const layout = { "line-cap": "round", "line-join": "round" } as const;
    map.addLayer({ id: "walk-casing", type: "line", source: sourceId, layout,
      paint: { "line-color": "#fff7d9", "line-width": 7 } }, before);
    map.addLayer({ id: "walk-path", type: "line", source: sourceId, layout,
      paint: { "line-color": "#b2451f", "line-width": 4 } }, before);
  }

  const [first] = coordinates;
  let west = first[0], south = first[1], east = first[0], north = first[1];
  for (const [lng, lat] of coordinates) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  map.fitBounds([[west, south], [east, north]], { padding: 48, maxZoom: 15, duration: 0 });
}
