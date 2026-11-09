import type { Coordinate } from "@tileflow-demos/shared/geo";
import { requestLive } from "@tileflow-demos/shared/service-client";
import type { Credit } from "@tileflow-demos/shared/ui";

export interface SearchOrigin { label: string; point: Coordinate }
export interface AddressResult { place: SearchOrigin | null; credits: Credit[] }

export function findAddress(query: string, signal: AbortSignal) {
  return requestLive<AddressResult>(query, signal);
}

export function currentLocation(): Promise<SearchOrigin> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is unavailable in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ label: "your location", point: [coords.longitude, coords.latitude] }),
      (error) => reject(new Error(error.code === 1
        ? "Location access was declined. Search by neighborhood instead."
        : "Your location could not be found. Try again or search by neighborhood.")),
      { maximumAge: 60000, timeout: 8000 },
    );
  });
}
