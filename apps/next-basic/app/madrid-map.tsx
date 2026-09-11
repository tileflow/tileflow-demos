"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useState } from "react";
import { Map } from "@tileflow/react";

const madridCenter: [number, number] = [-3.7038, 40.4168];
const madridZoom = 15;
const madridAnnotations = [
  {
    ariaLabel: "Madrid",
    coordinate: madridCenter,
    id: "madrid",
    kind: "marker",
  },
] as const;

export function MadridMap() {
  const [initialView] = useState(readInitialViewFromUrl);
  const handleMapLoad = useCallback((map: MapLibreMap) => {
    const updateUrl = () => {
      writeViewToUrl({
        center: map.getCenter().toArray() as [number, number],
        zoom: map.getZoom(),
      });
    };

    updateUrl();
    map.on("moveend", updateUrl);
    map.once("remove", () => {
      map.off("moveend", updateUrl);
    });
  }, []);

  return (
    <section className="mapPanel" aria-label="Madrid map preview">
      <Map
        annotations={madridAnnotations}
        center={initialView.center}
        height="100%"
        onLoad={handleMapLoad}
        renderMarker={() => <span className="tileflow-marker" />}
        source={{ kind: "tileflow", map: "madrid" }}
        zoom={initialView.zoom}
      />
    </section>
  );
}

function readInitialViewFromUrl(): { center: [number, number]; zoom: number } {
  if (typeof window === "undefined") {
    return {
      center: madridCenter,
      zoom: madridZoom,
    };
  }

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
  url.searchParams.set("lat", trimNumber(view.center[1], 5));
  url.searchParams.set("lng", trimNumber(view.center[0], 5));
  url.searchParams.set("zoom", trimNumber(view.zoom, 2));
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

function trimNumber(value: number, precision: number): string {
  return value.toFixed(precision).replace(/\.?0+$/, "");
}
