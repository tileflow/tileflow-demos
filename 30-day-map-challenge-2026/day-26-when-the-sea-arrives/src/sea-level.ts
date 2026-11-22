// IPCC AR6 sea-level projections (medium confidence, total including vertical land motion) on
// their 1-degree grid, relative to the 1995–2014 mean. public/data/sea-level.bin (gzip) holds Int16
// centimetres, [scenario][quantile][year][lat 90..-90][lon -180..179], each value stored as the
// change from the previous decade; scripts/build-sea-level.py writes it from the published files.

export const SCENARIOS = [
  {id: 'ssp126', label: 'Low', long: 'Low emissions (SSP1-2.6)'},
  {id: 'ssp245', label: 'Intermediate', long: 'Intermediate emissions (SSP2-4.5)'},
  {id: 'ssp585', label: 'High', long: 'High emissions (SSP5-8.5)'},
] as const;
/** 17th, 50th and 83rd percentiles: the IPCC's likely range and its median. */
export const QUANTILES = [0.17, 0.5, 0.83] as const;
export const MEDIAN = 1;
export const YEARS = Array.from({length: 14}, (_, i) => 2020 + i * 10);
export const FIRST_YEAR = YEARS[0];
export const LAST_YEAR = YEARS[YEARS.length - 1];

const COLS = 360;
const ROWS = 181;
export const CELLS = COLS * ROWS;
const BLOCK = YEARS.length * CELLS;

export type SeaLevels = Int16Array;

export async function loadSeaLevels(url: string): Promise<SeaLevels> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sea levels: ${res.status}`);
  let bytes = await res.arrayBuffer();
  // the file is gzip; a server may already have undone that (Content-Encoding)
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const data = new Int16Array(bytes);
  for (let b = 0; b < SCENARIOS.length * QUANTILES.length; b++)
    for (let y = 1; y < YEARS.length; y++) {
      const at = b * BLOCK + y * CELLS;
      for (let c = 0; c < CELLS; c++) data[at + c] += data[at - CELLS + c];
    }
  return data;
}

/** The 14 decades of one scenario and percentile: what the water layer uploads. */
export const block = (data: SeaLevels, scenario: number, quantile: number) =>
  data.subarray((scenario * QUANTILES.length + quantile) * BLOCK, (scenario * QUANTILES.length + quantile + 1) * BLOCK);

/** A year as a fractional index into YEARS. */
export const yearIndex = (year: number) => Math.min(YEARS.length - 1, Math.max(0, (year - FIRST_YEAR) / 10));

/** The projected rise at a place, metres, interpolated in space and between decades. */
export function riseAt(field: Int16Array, lng: number, lat: number, year: number) {
  const x = (((lng + 180) % 360) + 360) % 360;
  const y = Math.min(ROWS - 1.0001, Math.max(0, 90 - lat));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = (x0 + 1) % COLS;
  const t = yearIndex(year);
  const i0 = Math.floor(t);
  const i1 = Math.min(YEARS.length - 1, i0 + 1);
  const ft = t - i0;
  const at = (i: number) => {
    const o = i * CELLS;
    const a = field[o + y0 * COLS + x0];
    const b = field[o + y0 * COLS + x1];
    const c = field[o + (y0 + 1) * COLS + x0];
    const d = field[o + (y0 + 1) * COLS + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
  return ((1 - ft) * at(i0) + ft * at(i1)) / 100;
}

/**
 * The first year the projected sea stands above `height` metres at a place, interpolated within
 * the decade, or null when it does not happen by the last projected year.
 */
export function yearReaching(field: Int16Array, lng: number, lat: number, height: number): number | null {
  let prev = riseAt(field, lng, lat, FIRST_YEAR);
  if (prev >= height) return FIRST_YEAR;
  for (let i = 1; i < YEARS.length; i++) {
    const cur = riseAt(field, lng, lat, YEARS[i]);
    if (cur >= height) return YEARS[i - 1] + (10 * (height - prev)) / Math.max(cur - prev, 1e-6);
    prev = cur;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// Water lines above mean sea level, from GTSM-ERA5-E (public/data/water-lines.bin, gzip): Int16
// centimetres on a 0.25-degree grid, [line][lat 90..-90 (721)][lon -180..179.75 (1440)].

export const LINES = [
  {id: 'mean', label: 'Mean sea', title: 'Mean sea level: the projections alone'},
  {id: 'tide', label: 'High tide', title: 'The water level exceeded 5 % of the time: a high tide'},
  {id: 'flood', label: 'Yearly flood', title: 'The highest still water level of a typical year: tide plus storm surge'},
] as const;
export const LINE_COLS = 1440;
export const LINE_ROWS = 721;
const LINE_CELLS = LINE_COLS * LINE_ROWS;

export async function loadLines(url: string): Promise<Int16Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`water lines: ${res.status}`);
  let bytes = await res.arrayBuffer();
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return new Int16Array(bytes);
}

/** One line's grid (0 = mean sea level has none). */
export const lineField = (lines: Int16Array, line: number) => (line > 0 ? lines.subarray((line - 1) * LINE_CELLS, line * LINE_CELLS) : undefined);

/** The line's height above mean sea level at a place, metres. */
export function lineAt(field: Int16Array | undefined, lng: number, lat: number) {
  if (!field) return 0;
  const x = ((((lng + 180) % 360) + 360) % 360) * 4;
  const y = Math.min(LINE_ROWS - 1.0001, Math.max(0, (90 - lat) * 4));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = (x0 + 1) % LINE_COLS;
  const a = field[y0 * LINE_COLS + x0];
  const b = field[y0 * LINE_COLS + x1];
  const c = field[(y0 + 1) * LINE_COLS + x0];
  const d = field[(y0 + 1) * LINE_COLS + x1];
  return ((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy) / 100;
}
