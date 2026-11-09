import { Map } from "@tileflow/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { showRoute } from "./route-layer";
import { pointAt, type Trail, type WalkData } from "./trails";

interface Props {
  trail: Trail;
  walk: WalkData;
  stopId: string | null;
  selectStop: (id: string | null) => void;
  onLoad: () => void;
}

export function TrailMap({ trail, walk, stopId, selectStop, onLoad }: Props) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const annotations = useMemo(() => trail.stops.map(({ index, name, note }) => ({
    id: `stop-${index}`, kind: "marker" as const, coordinate: pointAt(trail, index), ariaLabel: name,
    marker: { color: "#38563a" }, popup: { content: { kind: "text" as const, text: name + " · " + note } },
  })), [trail]);

  useEffect(() => {
    if (map) showRoute(map, walk.coordinates);
  }, [map, walk.coordinates]);

  return (
    <Map source={{ map: "field" }} captureId="field" height="100%" onLoad={(loadedMap) => {
      setMap(loadedMap);
      onLoad();
    }}
      annotations={annotations} interactionState={{ popup: stopId ? { kind: "annotation", id: stopId } : null }}
      onInteractionStateChange={({ popup }) => selectStop(popup?.kind === "annotation" ? popup.id : null)} />
  );
}
