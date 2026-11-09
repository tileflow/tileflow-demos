import { elevationProfile } from "@tileflow/elevation/client";
import { route } from "@tileflow/routing/client";
import { pointAt, trails, type WalkData } from "../src/trails";

export async function calculateWalk(trailId: string, apiKey: string, signal: AbortSignal): Promise<WalkData | null> {
  const trail = trails.find(({ id }) => id === trailId);
  if (!trail) return null;

  const options = { apiKey, signal };
  const answer = await route({
    locations: trail.stops.map(({ index }) => pointAt(trail, index)),
    mode: "walking",
  }, options);
  const [walk] = answer.routes;
  if (!walk) return null;

  const profile = await elevationProfile({
    line: walk.geometry, interval: 40, maxSamples: 180,
  }, options);

  return {
    coordinates: walk.geometry.coordinates,
    samples: profile.samples.map(([, , height, meters]) => ({ height, meters })),
    distance: walk.distance,
    minutes: Math.round(walk.duration / 60),
    ascent: profile.summary.ascent,
    credits: [
      { label: answer.attribution, url: "https://www.openstreetmap.org/copyright" },
      { label: profile.attribution },
    ],
  };
}
