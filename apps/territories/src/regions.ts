import { boundsOf, type Coordinate } from "@tileflow-demos/shared/geo";

export type Metric = "deliveries" | "onTime";

export interface Region {
  id: string;
  name: string;
  deliveries: number;
  onTime: number;
  riders: number;
  ring: Coordinate[];
}

// The river and cross-street vertices are shared by adjoining dispatch areas.
const northWest: Coordinate = [-122.713, 45.562];
const northRiver: Coordinate = [-122.696, 45.567];
const northEast: Coordinate = [-122.616, 45.566];
const upperWest: Coordinate = [-122.711, 45.544];
const upperRiver: Coordinate = [-122.680, 45.544];
const upperEast: Coordinate = [-122.612, 45.546];
const lowerWest: Coordinate = [-122.708, 45.524];
const lowerRiver: Coordinate = [-122.669, 45.522];
const lowerEast: Coordinate = [-122.614, 45.523];
const southWest: Coordinate = [-122.695, 45.500];
const southRiver: Coordinate = [-122.668, 45.499];
const southEast: Coordinate = [-122.611, 45.501];

export const regions: Region[] = [
  { id: "northwest", name: "Northwest", deliveries: 286, onTime: 271, riders: 8,
    ring: [northWest, upperWest, upperRiver, northRiver, northWest] },
  { id: "albina", name: "Albina", deliveries: 341, onTime: 319, riders: 10,
    ring: [northRiver, upperRiver, upperEast, northEast, northRiver] },
  { id: "pearl", name: "Pearl", deliveries: 478, onTime: 465, riders: 12,
    ring: [upperWest, lowerWest, lowerRiver, upperRiver, upperWest] },
  { id: "eastbank", name: "Eastbank", deliveries: 428, onTime: 408, riders: 11,
    ring: [upperRiver, lowerRiver, lowerEast, upperEast, upperRiver] },
  { id: "west-end", name: "West End", deliveries: 262, onTime: 257, riders: 7,
    ring: [lowerWest, southWest, southRiver, lowerRiver, lowerWest] },
  { id: "hawthorne", name: "Hawthorne", deliveries: 365, onTime: 354, riders: 9,
    ring: [lowerRiver, southRiver, southEast, lowerEast, lowerRiver] },
];

export const regionBounds = boundsOf(regions.flatMap((region) => region.ring));

const number = new Intl.NumberFormat("en-US");
export const formatCount = (count: number) => number.format(count);
export const percentage = (successes: number, total: number) => 100 * successes / total;
export const metricNames = { deliveries: "Deliveries", onTime: "On-time rate" };

export const bands = {
  deliveries: [
    { min: 0, label: "<300", color: "#b2cbec" }, { min: 300, label: "300–349", color: "#83a8df" },
    { min: 350, label: "350–399", color: "#537bc5" }, { min: 400, label: "400+", color: "#364fa0" },
  ],
  onTime: [
    { min: 0, label: "<94%", color: "#b2cbec" }, { min: 94, label: "94–<96%", color: "#83a8df" },
    { min: 96, label: "96–<97%", color: "#537bc5" }, { min: 97, label: "97%+", color: "#364fa0" },
  ],
};

export function metricValue(region: Region, metric: Metric) {
  return metric === "deliveries" ? region.deliveries : percentage(region.onTime, region.deliveries);
}

export function regionColor(region: Region, metric: Metric) {
  const value = metricValue(region, metric);
  return bands[metric].filter(({ min }) => value >= min).at(-1)!.color;
}

export function regionFeatures(metric: Metric) {
  return { type: "FeatureCollection" as const, features: regions.map((region) => ({
    type: "Feature" as const, properties: { id: region.id, color: regionColor(region, metric) },
    geometry: { type: "Polygon" as const, coordinates: [region.ring] },
  })) };
}
