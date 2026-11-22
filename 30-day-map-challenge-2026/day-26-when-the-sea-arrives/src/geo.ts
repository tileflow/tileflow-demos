export const EARTH = 40075016.68557849;

/** Web Mercator, 0..1 east and south. */
export function mercator(lng: number, lat: number): [number, number] {
  const s = Math.sin((lat * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

export function lngLat(u: number, v: number): [number, number] {
  return [u * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI];
}

/** Ground metres per Mercator unit at a latitude. */
export const metresPerUnit = (lat: number) => EARTH * Math.cos((lat * Math.PI) / 180);
