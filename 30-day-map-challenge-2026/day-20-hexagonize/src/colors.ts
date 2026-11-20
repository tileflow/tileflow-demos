// The look of the reference: saturated toy-like colours, turquoise shallows, sand beaches,
// green lowlands, ochre and brown mountains and white peaks, deep royal-blue ocean.
export type RGB = [number, number, number];

type Stops = ReadonlyArray<readonly [number, RGB]>;

function ramp(stops: Stops, x: number): RGB {
  if (x <= stops[0][0]) return [...stops[0][1]];
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i];
    if (x <= b) {
      const [a, ca] = stops[i - 1];
      const t = (x - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return [...stops[stops.length - 1][1]];
}

export const SEA: Stops = [
  [0, [150, 236, 234]],
  [25, [104, 226, 238]],
  [60, [70, 210, 240]],
  [120, [46, 190, 242]],
  [220, [34, 168, 242]],
  [400, [30, 146, 236]],
  [900, [30, 118, 226]],
  [1650, [32, 94, 214]],
  [2600, [34, 74, 198]],
  [3600, [34, 58, 180]],
  [4900, [30, 44, 156]],
  [7000, [24, 32, 120]],
];

export const LAND: Stops = [
  [0, [140, 206, 50]],
  [200, [118, 194, 42]],
  [450, [94, 174, 38]],
  [750, [112, 168, 40]],
  [1000, [176, 176, 50]],
  [1250, [222, 168, 52]],
  [1550, [218, 132, 46]],
  [1900, [178, 98, 46]],
  [2150, [140, 76, 42]],
  [2400, [112, 64, 40]],
  [2550, [196, 186, 192]],
  [2700, [250, 251, 255]],
];

export const SAND: RGB = [244, 222, 164];
export const FRESH: RGB = [40, 170, 236];
/** Tints for what a new sea level changes: land under water, and sea floor laid bare. */
export const LOST: RGB = [214, 92, 168];
export const GAINED: RGB = [236, 222, 160];

export const seaColor = (depth: number) => ramp(SEA, depth);
export const landColor = (elev: number) => ramp(LAND, elev);

export const COVER_COLORS: Record<string, RGB> = {
  '': [176, 206, 120],
  trees: [40, 140, 62],
  grass: [142, 214, 76],
  shrub: [186, 196, 92],
  crop: [246, 206, 86],
  barren: [196, 150, 112],
  urban: [240, 92, 74],
  snow: [242, 246, 252],
  wetland: [70, 186, 170],
  sand: SAND,
};

export const COVER_LABELS: Record<string, string> = {
  trees: 'Forest',
  grass: 'Grassland',
  shrub: 'Shrubland',
  crop: 'Cropland',
  barren: 'Bare rock',
  urban: 'Built-up',
  snow: 'Snow & ice',
  wetland: 'Wetland',
  sand: 'Sand',
};

export const css = (c: RGB) => `rgb(${c.map(Math.round).join(',')})`;
export const gradient = (stops: Stops, max: number) =>
  `linear-gradient(90deg, ${stops.filter(([v]) => v <= max).map(([v, c]) => `${css(c)} ${((v / max) * 100).toFixed(1)}%`).join(', ')})`;
