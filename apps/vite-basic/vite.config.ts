import react from "@vitejs/plugin-react";
import { tileflow } from "@tileflow/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tileflow(), react()],
});
