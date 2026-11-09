import { requestLive } from "@tileflow-demos/shared/service-client";
import type { WalkData } from "./trails";

export function fetchWalk(trailId: string, signal: AbortSignal) {
  return requestLive<WalkData | null>(trailId, signal);
}
