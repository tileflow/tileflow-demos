import { boundsOf, type Coordinate } from "@tileflow-demos/shared/geo";
import { Map } from "@tileflow/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { storeNumber, type Store } from "./stores";

interface Props {
  results: readonly { store: Store }[];
  selected?: Store;
  position: Coordinate | null;
  select: (id: string | null) => void;
  onLoad: () => void;
}

const positionId = "device-location";

export function ShopMap({ results, selected, position, select, onLoad }: Props) {
  const [map, setMap] = useState<MapLibreMap | null>(null);

  const annotations = useMemo(() => {
    const shops = results.map(({ store }) => ({
      id: store.id, kind: "marker" as const, coordinate: store.point, ariaLabel: store.name,
      marker: { content: { kind: "view" as const, name: "shop" } },
      popup: { content: { kind: "view" as const, name: "hours" } },
    }));
    if (!position) return shops;

    return [...shops, {
      id: positionId, kind: "marker" as const, coordinate: position, ariaLabel: "Your location",
      marker: { content: { kind: "view" as const, name: "location" } },
      tooltip: { content: { kind: "text" as const, text: "Your location" } },
    }];
  }, [results, position]);

  useEffect(() => {
    if (!map || !position || selected || !results.length) return;

    const nearest = results.slice(0, 3).map(({ store }) => store.point);
    map.fitBounds(boundsOf([position, ...nearest]), { padding: 40, maxZoom: 15, duration: 0 });
  }, [map, position, results, selected]);

  return (
    <Map source={{ map: "locator" }} height="100%" viewMode="2d" captureId="locator"
      onLoad={(loadedMap) => { setMap(loadedMap); onLoad(); }}
      center={selected?.point} zoom={selected ? 14.6 : undefined}
      annotations={annotations} interactionState={{ popup: selected ? { kind: "annotation", id: selected.id } : null }}
      onInteractionStateChange={({ popup }) => select(popup?.kind === "annotation" ? popup.id : null)}
      renderMarker={({ annotation }) => annotation.id === positionId
        ? <span className="location-pin" />
        : <span className="shop-pin" data-selected={selected?.id === annotation.id}>{storeNumber(annotation.id)}</span>}
      renderPopup={({ annotation }) => {
        const shop = results.find(({ store }) => store.id === annotation.id)?.store;
        return shop && <div className="shop-popup"><strong>{shop.name}</strong>
          <span>{shop.district}</span><span>Daily {shop.hours}</span></div>;
      }} />
  );
}
