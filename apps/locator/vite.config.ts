import { localService } from "@tileflow-demos/shared/local-service";
import { searchAddress } from "./server/search";
import { tileflow } from "@tileflow/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const addressSearch = localService("TILEFLOW_DEMO_SEARCH_KEY", searchAddress);

export default defineConfig({ plugins: [tileflow(), react(), addressSearch] });
