import { configureTileflowMapLibre } from "@tileflow/react";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "@tileflow-demos/shared/styles.css";
import App from "./App";

configureTileflowMapLibre({ workerUrl });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
