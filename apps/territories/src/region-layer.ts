import { tileflowGroundBeforeId } from "@tileflow/core/browser";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { regionFeatures, type Metric } from "./regions";

const sourceId = "dispatch-territories";
const fillId = "territory-fill";
const outlineId = "territory-selection";

export function paintRegions(map: MapLibreMap, metric: Metric) {
  const data = regionFeatures(metric);
  const source = map.getSource<GeoJSONSource>(sourceId);
  if (source) {
    void source.setData(data);
    return;
  }

  map.addSource(sourceId, { type: "geojson", data, attribution: "Dispatch areas by Tileflow (CC0)" });
  const before = tileflowGroundBeforeId(map);
  map.addLayer({ id: fillId, type: "fill", source: sourceId,
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.78 } }, before);
  map.addLayer({ id: "territory-borders", type: "line", source: sourceId,
    paint: { "line-color": "#ffffff", "line-width": 1.5 } }, before);
  map.addLayer({ id: outlineId, type: "line", source: sourceId, filter: ["==", ["get", "id"], ""],
    paint: { "line-color": "#172e62", "line-width": 4 } }, before);
}

export function highlightRegion(map: MapLibreMap, id: string | null) {
  map.setFilter(outlineId, ["==", ["get", "id"], id ?? ""]);
}

export function listenForRegion(map: MapLibreMap, select: (id: string | null) => void) {
  function click(event: MapMouseEvent) {
    const [feature] = map.queryRenderedFeatures(event.point, { layers: [fillId] });
    select(feature?.properties.id ?? null);
  }
  const enter = () => { map.getCanvas().style.cursor = "pointer"; };
  const leave = () => { map.getCanvas().style.cursor = ""; };
  map.on("click", click);
  map.on("mouseenter", fillId, enter);
  map.on("mouseleave", fillId, leave);

  return () => {
    map.off("click", click);
    map.off("mouseenter", fillId, enter);
    map.off("mouseleave", fillId, leave);
  };
}
