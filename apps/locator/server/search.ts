import { geocode } from "@tileflow/search/client";
import type { AddressResult } from "../src/location";

export async function searchAddress(query: string, apiKey: string, signal: AbortSignal): Promise<AddressResult> {
  const response = await geocode({
    query, bounds: [-9.25, 38.67, -9.07, 38.81], limit: 1, language: "en",
  }, { apiKey, signal });
  const [place] = response.results;

  return {
    place: place ? { label: place.label, point: place.position } : null,
    credits: response.attribution.map(({ text, url }) => ({ label: text, url })),
  };
}
