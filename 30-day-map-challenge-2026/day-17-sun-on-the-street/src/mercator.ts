/** The World tile grid used to measure sidewalks and project their shadows. */
export const TILE_ZOOM = 15;
export const EARTH = 40075016.68557849; // metres around the equator per Mercator unit

export const mercX = (longitude: number) => (longitude + 180) / 360;
export const mercY = (latitude: number) => (1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2;
export const latOfMercY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
