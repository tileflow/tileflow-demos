import maplibre from "maplibre-gl/package.json";
import type { NextConfig } from "next";
import { withTileflow } from "@tileflow/next";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_MAPLIBRE_VERSION: maplibre.version },
  experimental: { agentUpgrade: "security" },
  serverExternalPackages: ["@tileflow/dev"],
};

export default withTileflow(nextConfig);
