// A regular hexagonal grid laid on Web Mercator (u, v in 0..1, v pointing south), pointy-top.
// Level L has cells of size 2^(-L/3) (centre to corner): three levels per halving, so a change of
// level while zooming is a small step rather than a doubling.

export const SQ3 = Math.sqrt(3);
export const LEVELS_PER_OCTAVE = 3;

export const cellSize = (level: number) => 2 ** (-level / LEVELS_PER_OCTAVE);

/** The level, fractional, whose cells are `cellPx` CSS pixels apart at this map zoom. */
export const idealLevel = (zoom: number, cellPx: number) => LEVELS_PER_OCTAVE * Math.log2((SQ3 * 512 * 2 ** zoom) / cellPx);

/** The map zoom at which a level's cells are exactly `cellPx` apart. */
export const levelZoom = (level: number, cellPx: number) => level / LEVELS_PER_OCTAVE - Math.log2((SQ3 * 512) / cellPx);

export function centerOf(q: number, r: number, s: number): [number, number] {
  return [s * SQ3 * (q + r / 2), s * 1.5 * r];
}

export function cellAt(u: number, v: number, s: number): [number, number] {
  const qf = ((SQ3 / 3) * u - v / 3) / s;
  const rf = ((2 / 3) * v) / s;
  return cubeRound(qf, rf);
}

function cubeRound(qf: number, rf: number): [number, number] {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

export const NEIGHBOURS: ReadonlyArray<[number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export const key = (q: number, r: number) => `${q},${r}`;

export function lngLat(u: number, v: number): [number, number] {
  const lng = u * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI;
  return [lng, lat];
}

export function mercator(lng: number, lat: number): [number, number] {
  const s = Math.sin((lat * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

/** Metres per Mercator unit at a latitude. */
export const metresPerUnit = (lat: number) => 40075016.686 * Math.cos((lat * Math.PI) / 180);

/** Smooth deterministic noise in roughly -1..1, for organic island edges. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (a: number, b: number) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  };
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * sx;
  const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * sx;
  return a + (b - a) * sy;
}
