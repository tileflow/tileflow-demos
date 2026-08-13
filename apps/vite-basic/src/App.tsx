import { Map } from "@tileflow/react";
import { useCallback, useMemo } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

const madridCenter: [number, number] = [-3.7038, 40.4168];
const madridZoom = 15;

const madridMarkers = [
  {
    id: "madrid",
    coordinates: madridCenter,
    label: "Madrid",
  },
];

export default function App() {
  const initialView = useMemo(readInitialViewFromUrl, []);
  const handleMapLoad = useCallback((map: MapLibreMap) => {
    const updateUrl = () => {
      writeViewToUrl({
        center: map.getCenter().toArray() as [number, number],
        zoom: map.getZoom(),
      });
    };

    updateUrl();
    map.on("moveend", updateUrl);
  }, []);

  return (
    <main className="demoShell">
      <section className="mapPanel" aria-label="Madrid map preview">
        <Map
          center={initialView.center}
          height="100%"
          map="madrid"
          markers={madridMarkers}
          onLoad={handleMapLoad}
          preferLocalDev={!import.meta.env.PROD}
          styleBaseUrl="/tileflow"
          zoom={initialView.zoom}
        />
      </section>
    </main>
  );
}

function readInitialViewFromUrl(): { center: [number, number]; zoom: number } {
  const searchParams = new URLSearchParams(window.location.search);
  const lat = parseNumber(searchParams.get("lat"));
  const lng = parseNumber(searchParams.get("lng") ?? searchParams.get("long"));
  const zoom = parseNumber(searchParams.get("zoom"));

  return {
    center:
      lat !== undefined && lng !== undefined && isValidCenter([lng, lat])
        ? [lng, lat]
        : madridCenter,
    zoom: zoom !== undefined && zoom >= 0 && zoom <= 24 ? zoom : madridZoom,
  };
}

function writeViewToUrl(view: { center: [number, number]; zoom: number }) {
  const url = new URL(window.location.href);
  url.searchParams.set("lat", formatCoordinate(view.center[1]));
  url.searchParams.set("lng", formatCoordinate(view.center[0]));
  url.searchParams.set("zoom", formatZoom(view.zoom));
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function parseNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isValidCenter(center: [number, number]): boolean {
  const [lng, lat] = center;
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function formatCoordinate(value: number): string {
  return trimNumber(value, 5);
}

function formatZoom(value: number): string {
  return trimNumber(value, 2);
}

function trimNumber(value: number, precision: number): string {
  return value.toFixed(precision).replace(/\.?0+$/, "");
}
