export type Coordinate = [longitude: number, latitude: number];

export function distanceKm(from: Coordinate, to: Coordinate): number {
  const rad = Math.PI / 180;
  const lat = (to[1] - from[1]) * rad;
  const lng = (to[0] - from[0]) * rad;
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(from[1] * rad) * Math.cos(to[1] * rad) * Math.sin(lng / 2) ** 2;

  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
