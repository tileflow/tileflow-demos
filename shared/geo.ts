export type Coordinate = [longitude: number, latitude: number];

export function distanceKm(from: Coordinate, to: Coordinate): number {
  const rad = Math.PI / 180;
  const lat = (to[1] - from[1]) * rad;
  const lng = (to[0] - from[0]) * rad;
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(from[1] * rad) * Math.cos(to[1] * rad) * Math.sin(lng / 2) ** 2;

  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type Bounds = [west: number, south: number, east: number, north: number];
export interface Credit { label: string; url?: string }

export function boundsOf(points: readonly (readonly [number, number, ...number[]])[]): Bounds {
  const [first] = points;
  if (!first) throw new Error("At least one position is required.");

  let [west, south] = first;
  let [east, north] = first;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}
