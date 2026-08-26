import type { NextConfig } from "next";
import { withTileflow } from "@tileflow/next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@tileflow/dev"],
};

export default withTileflow(nextConfig);
