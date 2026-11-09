import { localService } from "@tileflow-demos/shared/local-service";
import { geocode } from "@tileflow/search/client";
import { tileflow } from "@tileflow/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { AddressResult } from "./src/location";

const addressSearch = localService("TILEFLOW_DEMO_SEARCH_KEY", async (query, apiKey, signal): Promise<AddressResult> => {
  const response = await geocode({
    query, bounds: [-9.25, 38.67, -9.07, 38.81], limit: 1, language: "en",
  }, { apiKey, signal });
  const [place] = response.results;

  return {
    place: place ? { label: place.label, point: place.position } : null,
    credits: response.attribution.map(({ text, url }) => ({ label: text, url })),
  };
});

export default defineConfig({ plugins: [tileflow(), react(), addressSearch] });
