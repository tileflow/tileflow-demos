import { Map } from "@tileflow/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState } from "react";
import { highlightRegion, listenForRegion, paintRegions } from "./region-layer";
import type { Metric } from "./regions";

interface Props {
  metric: Metric;
  id: string | null;
  select: (id: string | null) => void;
  onLoad: () => void;
}

export function TerritoryMap({ metric, id, select, onLoad }: Props) {
  const [map, setMap] = useState<MapLibreMap | null>(null);

  useEffect(() => {
    if (map) paintRegions(map, metric);
  }, [map, metric]);

  useEffect(() => {
    if (map) highlightRegion(map, id);
  }, [map, id]);

  useEffect(() => {
    if (map) return listenForRegion(map, select);
  }, [map, select]);

  return <Map source={{ map: "territories" }} height="100%" viewMode="2d" captureId="territories" onLoad={(loadedMap) => {
    setMap(loadedMap);
    onLoad();
  }} />;
}
