const HIDDEN = 0,
  VISIBLE = 1,
  OUTSIDE = 2,
  UNKNOWN = 3;
const EARTH_RADIUS = 6371008.8;
// Octants clockwise from east. Each ray is a major-axis unit plus t minor-axis units.
const OCTANTS = [
  [1, 0, 0, -1],
  [0, -1, 1, 0],
  [0, -1, -1, 0],
  [-1, 0, 0, -1],
  [-1, 0, 0, 1],
  [0, 1, -1, 0],
  [0, 1, 1, 0],
  [1, 0, 0, 1],
];

function prepare(options) {
  const {
    heights,
    size,
    spacing,
    observerX = Math.floor(size / 2),
    observerY = Math.floor(size / 2),
    observerHeight = 1.7,
    targetHeight = 0,
    radius = Math.floor(size / 2) * spacing,
    curvature = 1,
  } = options;
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    heights.length !== size * size ||
    !Number.isInteger(observerX) ||
    observerX < 0 ||
    observerX >= size ||
    !Number.isInteger(observerY) ||
    observerY < 0 ||
    observerY >= size ||
    ![spacing, observerHeight, targetHeight, radius, curvature].every(Number.isFinite) ||
    spacing <= 0 ||
    radius < 0 ||
    observerHeight < 0 ||
    targetHeight < 0 ||
    curvature < 0
  ) {
    throw new RangeError('Invalid DEM geometry or visibility parameters');
  }
  const ground = heights[observerY * size + observerX];
  return {
    heights,
    size,
    spacing,
    observerX,
    observerY,
    observerHeight,
    targetHeight,
    radius,
    correction: curvature / (2 * EARTH_RADIUS),
    eye: Number.isFinite(ground) ? ground + observerHeight : NaN,
  };
}

function read(dem, x, y) {
  if (x < 0 || y < 0 || x >= dem.size || y >= dem.size) return NaN;
  const value = dem.heights[y * dem.size + x];
  return Number.isFinite(value) ? value : NaN;
}

// Sample where the ray crosses each major-axis row or column of DEM centers.
// Interpolate only the minor coordinate. An exact center needs one source sample.
function ringSample(dem, baseX, baseY, minorX, minorY, minor) {
  const lower = Math.floor(minor);
  const fraction = minor - lower;
  const x = baseX + minorX * lower,
    y = baseY + minorY * lower;
  const first = read(dem, x, y);
  if (fraction === 0) return first;
  const second = read(dem, x + minorX, y + minorY);
  return first + fraction * (second - first);
}

// A ray next to a data gap or DEM edge can have an indeterminate neighbour.
// Resolve those boundary targets along their own direction instead of blending NoData.
function boundaryHorizon(dem, k, j, majorX, majorY, minorX, minorY) {
  let horizon = -Infinity;
  const stepDistance = dem.spacing * Math.hypot(1, j / k);
  for (let n = 1; n < k; n++) {
    const h = ringSample(
      dem,
      dem.observerX + n * majorX,
      dem.observerY + n * majorY,
      minorX,
      minorY,
      (n * j) / k,
    );
    if (!Number.isFinite(h)) return NaN;
    const distance = n * stepDistance;
    horizon = Math.max(horizon, (h - dem.eye) / distance - dem.correction * distance);
  }
  return horizon;
}

function sweep(dem, mask) {
  const radiusCells = dem.radius / dem.spacing;
  const reach = Math.min(
    Math.floor(radiusCells),
    Math.max(
      dem.observerX,
      dem.observerY,
      dem.size - 1 - dem.observerX,
      dem.size - 1 - dem.observerY,
    ),
  );
  if (!reach || !Number.isFinite(dem.eye)) return;
  // Neighbouring rays are at most 1/2 DEM pixel apart at the outer edge.
  // Every target center queries the previous ring before that ring's horizon advances.
  const bins = Math.max(2, 2 * reach);
  const radiusSquared = radiusCells * radiusCells;
  for (const [majorX, majorY, minorX, minorY] of OCTANTS) {
    const horizons = new Float64Array(bins + 1).fill(-Infinity);
    const rayStep = new Float64Array(bins + 1);
    for (let b = 0; b <= bins; b++) rayStep[b] = dem.spacing * Math.hypot(1, b / bins);
    for (let k = 1; k <= reach; k++) {
      const baseX = dem.observerX + k * majorX,
        baseY = dem.observerY + k * majorY;
      if (baseX < 0 || baseY < 0 || baseX >= dem.size || baseY >= dem.size) break;
      for (let j = 0; j <= k && k * k + j * j <= radiusSquared; j++) {
        const x = baseX + j * minorX,
          y = baseY + j * minorY;
        if (x < 0 || y < 0 || x >= dem.size || y >= dem.size) break;
        const height = read(dem, x, y);
        const bin = (j * bins) / k,
          b = Math.floor(bin),
          f = bin - b;
        let horizon = horizons[b];
        if (k > 1 && f !== 0) {
          const next = horizons[b + 1];
          horizon =
            Number.isNaN(horizon) !== Number.isNaN(next)
              ? boundaryHorizon(dem, k, j, majorX, majorY, minorX, minorY)
              : horizon + f * (next - horizon);
        }
        const distance = dem.spacing * Math.hypot(k, j);
        const slope = (height + dem.targetHeight - dem.eye) / distance - dem.correction * distance;
        mask[y * dem.size + x] =
          !Number.isFinite(slope) || Number.isNaN(horizon)
            ? UNKNOWN
            : slope + 1e-12 >= horizon
              ? VISIBLE
              : HIDDEN;
      }
      if (k === reach) break;
      for (let b = 0; b <= bins; b++) {
        if (Number.isNaN(horizons[b])) continue;
        const h = ringSample(dem, baseX, baseY, minorX, minorY, (k * b) / bins);
        const d = k * rayStep[b];
        horizons[b] = Math.max(horizons[b], (h - dem.eye) / d - dem.correction * d);
      }
    }
  }
}

function analyze(options) {
  const dem = prepare(options);
  const mask = new Uint8Array(dem.heights.length).fill(OUTSIDE);
  if (Number.isFinite(dem.eye)) mask[dem.observerY * dem.size + dem.observerX] = VISIBLE;
  sweep(dem, mask);
  const counts = [0, 0, 0, 0],
    r = dem.radius / dem.spacing,
    r2 = r * r;
  let farthestVisible = null;
  // Metric cell-center convention. Cells of the disk beyond the DEM count as unknown.
  for (let dy = -Math.floor(r); dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(Math.max(0, r2 - dy * dy)));
    const y = dem.observerY + dy;
    if (y < 0 || y >= dem.size) {
      counts[UNKNOWN] += 2 * half + 1;
      continue;
    }
    const left = Math.max(0, dem.observerX - half),
      right = Math.min(dem.size - 1, dem.observerX + half);
    counts[UNKNOWN] += 2 * half + 1 - (right - left + 1);
    for (let x = left; x <= right; x++) {
      const i = y * dem.size + x;
      if (mask[i] === OUTSIDE) mask[i] = UNKNOWN;
      counts[mask[i]]++;
      if (mask[i] === VISIBLE) {
        const d = Math.hypot(x - dem.observerX, dy) * dem.spacing;
        farthestVisible = Math.max(farthestVisible ?? 0, d);
      }
    }
  }
  const cellArea = dem.spacing * dem.spacing,
    valid = counts[VISIBLE] + counts[HIDDEN];
  return {
    mask,
    stats: {
      visibleArea: counts[VISIBLE] * cellArea,
      hiddenArea: counts[HIDDEN] * cellArea,
      unknownArea: counts[UNKNOWN] * cellArea,
      visiblePercent: valid ? (100 * counts[VISIBLE]) / valid : null,
      farthestVisible,
      radius: dem.radius,
      edgeVisible: farthestVisible != null && farthestVisible >= dem.radius - dem.spacing,
    },
  };
}

function profile(options, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y))
    throw new RangeError('Profile targets must be integer grid centers');
  const dem = prepare(options);
  const dx = x - dem.observerX,
    dy = y - dem.observerY;
  const distance = Math.hypot(dx, dy) * dem.spacing;
  const bearing = distance ? ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360 : null;
  const result = {
    status: UNKNOWN,
    points: [],
    distance,
    bearing,
    clearance: null,
    blockerIndex: -1,
    firstIntersectionIndex: -1,
    minimumTargetHeight: null,
  };
  if (distance > dem.radius) {
    result.status = OUTSIDE;
    return result;
  }
  const target = read(dem, x, y);
  if (x < 0 || x >= dem.size || y < 0 || y >= dem.size) return result;

  const xMajor = Math.abs(dx) >= Math.abs(dy);
  const k = Math.max(Math.abs(dx), Math.abs(dy));
  const j = Math.min(Math.abs(dx), Math.abs(dy));
  const majorX = xMajor ? Math.sign(dx) : 0,
    majorY = xMajor ? 0 : Math.sign(dy);
  const minorX = xMajor ? 0 : Math.sign(dx),
    minorY = xMajor ? Math.sign(dy) : 0;
  const targetCorrected = target + dem.targetHeight - dem.correction * distance * distance;
  let missing = !Number.isFinite(target) || !Number.isFinite(dem.eye);
  let horizon = -Infinity,
    dominant = -1;
  for (let n = 0; n <= k; n++) {
    const fraction = k ? n / k : 0,
      d = distance * fraction;
    const h = ringSample(
      dem,
      dem.observerX + n * majorX,
      dem.observerY + n * majorY,
      minorX,
      minorY,
      k ? (n * j) / k : 0,
    );
    const corrected = h - dem.correction * d * d;
    const sightline = dem.eye + fraction * (targetCorrected - dem.eye);
    result.points.push({distance: d, elevation: h, corrected, sightline});
    if (!Number.isFinite(h)) missing = true;
    if (n === 0 || n === k || !Number.isFinite(h)) continue;
    const slope = (corrected - dem.eye) / d;
    if (slope > horizon) {
      horizon = slope;
      dominant = n;
    }
    if (corrected > sightline + 1e-12 * d && result.firstIntersectionIndex === -1)
      result.firstIntersectionIndex = n;
  }
  if (missing) return result;
  if (dominant === -1) {
    result.status = VISIBLE;
    result.minimumTargetHeight = 0;
    return result;
  }
  const threshold = dem.eye + horizon * distance;
  result.clearance = targetCorrected - threshold;
  result.minimumTargetHeight = Math.max(0, dem.targetHeight - result.clearance);
  result.status = result.clearance + 1e-12 * distance >= 0 ? VISIBLE : HIDDEN;
  result.blockerIndex = result.status === HIDDEN ? dominant : -1;
  return result;
}

export default {analyze, profile, EARTH_RADIUS, HIDDEN, VISIBLE, OUTSIDE, UNKNOWN};
