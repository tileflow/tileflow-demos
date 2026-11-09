import { localService } from "@tileflow-demos/shared/local-service";
import { tileflow } from "@tileflow/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { calculateWalk } from "./server/walk";

const walkService = localService("TILEFLOW_DEMO_FIELD_KEY", calculateWalk);

export default defineConfig({ plugins: [tileflow(), react(), walkService] });
