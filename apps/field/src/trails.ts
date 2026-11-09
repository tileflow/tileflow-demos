import { distanceKm, type Coordinate } from "@tileflow-demos/shared/geo";
import type { Credit } from "@tileflow-demos/shared/ui";

interface Stop { index: number; name: string; note: string }
export interface Trail {
  id: string;
  name: string;
  terrain: string;
  description: string;
  minutes: number;
  track: [longitude: number, latitude: number, height: number][];
  stops: Stop[];
}

export const trails: Trail[] = [
  {
    id: "lagoon", name: "Lagoon to the coast", terrain: "Coastal trail",
    description: "Skirt Rodeo Lagoon, then climb the bluff above the Pacific.",
    minutes: 55,
    track: [
      [-122.5258, 37.8313, 9], [-122.5283, 37.8319, 12], [-122.5311, 37.8316, 8],
      [-122.5333, 37.8313, 7], [-122.5353, 37.8319, 8], [-122.5366, 37.8340, 20],
      [-122.5370, 37.8352, 35], [-122.5378, 37.8364, 48], [-122.5385, 37.8376, 61],
      [-122.5393, 37.8385, 55], [-122.5406, 37.8394, 72],
    ],
    stops: [
      { index: 0, name: "Lagoon edge", note: "Start beside the sheltered water." },
      { index: 4, name: "Beach crossing", note: "The track turns north at the beach." },
      { index: 10, name: "Pacific overlook", note: "An open bluff facing the ocean." },
    ],
  },
  {
    id: "ridge", name: "The ridge traverse", terrain: "Ridgeline trail",
    description: "Follow the ridge from the old battery to the Hawk Hill overlook.",
    minutes: 65,
    track: [
      [-122.5076, 37.8281, 146], [-122.5057, 37.8280, 151], [-122.5037, 37.8275, 168],
      [-122.5015, 37.8278, 177], [-122.4994, 37.8285, 170], [-122.4986, 37.8273, 164],
      [-122.4987, 37.8258, 183], [-122.4990, 37.8247, 198], [-122.4993, 37.8234, 210],
      [-122.5000, 37.8227, 226], [-122.5008, 37.8224, 235],
    ],
    stops: [
      { index: 0, name: "Battery approach", note: "The walk begins on the old service track." },
      { index: 4, name: "Ridge saddle", note: "A low point between the two climbs." },
      { index: 10, name: "Hawk Hill overlook", note: "The finish looks across the Golden Gate." },
    ],
  },
];

export const pointAt = (trail: Trail, index: number): Coordinate => {
  const [lng, lat] = trail.track[index];
  return [lng, lat];
};

export interface WalkData {
  coordinates: Coordinate[];
  samples: { meters: number; height: number | null }[];
  distance: number;
  ascent: number | null;
  minutes: number;
  credits: Credit[];
}

export function savedWalk(trail: Trail): WalkData {
  const coordinates = trail.track.map((_, i) => pointAt(trail, i));
  let distance = 0;
  let ascent = 0;
  const samples = trail.track.map((sample, i) => {
    if (i > 0) {
      distance += distanceKm(coordinates[i - 1], coordinates[i]) * 1000;
      ascent += Math.max(0, sample[2] - trail.track[i - 1][2]);
    }
    return { meters: distance, height: sample[2] };
  });

  return { coordinates, samples, distance, ascent, minutes: trail.minutes, credits: [] };
}
