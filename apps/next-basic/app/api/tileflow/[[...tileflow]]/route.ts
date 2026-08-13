import { createTileflowRouteHandlers } from "@tileflow/next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, HEAD } = createTileflowRouteHandlers({
  routeBase: "/api/tileflow",
});
