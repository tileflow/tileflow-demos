const HIDDEN = 0,
  VISIBLE = 1,
  OUTSIDE = 2,
  UNKNOWN = 3;
const EARTH_RADIUS = 6371008.8,
  RAD = Math.PI / 180;
// One micrometre at the observer, applied to the same Float32 threshold in
// point and raster classifications. No physical clearance margin is assumed.
const HEIGHT_TOLERANCE_M = 1e-6;
const OCTANTS = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, 1, -1, 0],
  [-1, 0, 0, 1],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [0, -1, 1, 0],
  [1, 0, 0, -1],
];
const isHidden = (minimum, eye) => Math.fround(minimum) > eye + HEIGHT_TOLERANCE_M;

function prepare(options, detailed = false) {
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
    !Number.isInteger(observerY) ||
    observerX < 0 ||
    observerX >= size ||
    observerY < 0 ||
    observerY >= size ||
    ![spacing, observerHeight, targetHeight, radius, curvature].every(Number.isFinite) ||
    spacing <= 0 ||
    observerHeight < 0 ||
    targetHeight < 0 ||
    radius < 0 ||
    curvature < 0
  ) {
    throw new RangeError('Invalid discovery analysis grid');
  }
  const near = options.nearTerrain;
  const nearMid = near ? (near.size - 1) / 2 : 0;
  const ratio = near ? spacing / near.spacing : 1;
  const localGround = near?.heights[nearMid * near.size + nearMid];
  return {
    heights,
    size,
    spacing,
    ox: observerX,
    oy: observerY,
    observerHeight,
    targetHeight,
    near, nearMid, ratio, nearReach: nearMid / ratio,
    native: detailed ? options.nativeTerrain : null,
    ground: Number.isFinite(localGround) ? localGround : heights[observerY * size + observerX],
    radius,
    correction: curvature / (2 * EARTH_RADIUS),
  };
}

function sampleGrid(g, x, y) {
  const nx = Math.round(x),
    ny = Math.round(y);
  if (Math.abs(x - nx) < 1e-11) x = nx;
  if (Math.abs(y - ny) < 1e-11) y = ny;
  if (x < 0 || y < 0 || x > g.size - 1 || y > g.size - 1) return NaN;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    index = iy * g.size + ix,
    fx = x - ix,
    fy = y - iy;
  let a = g.heights[index];
  if (fx) a += fx * (g.heights[index + 1] - a);
  if (!fy) return a;
  let b = g.heights[index + g.size];
  if (fx) b += fx * (g.heights[index + g.size + 1] - b);
  return a + fy * (b - a);
}
function sample(g, x, y) {
  if (g.near && Math.max(Math.abs(x - g.ox), Math.abs(y - g.oy)) <= g.nearReach + 1e-11) {
    const local = sampleGrid(g.near, g.nearMid + (x - g.ox) * g.ratio, g.nearMid + (y - g.oy) * g.ratio);
    if (Number.isFinite(local)) return local;
  }
  if (g.native) {
    const z = g.native.heightAt((x - g.ox) * g.spacing, (g.oy - y) * g.spacing);
    if (Number.isFinite(z)) return z;
  }
  return sampleGrid(g, x, y);
}
// Visit both row and column boundaries: an oblique ray can otherwise skip
// the crest of a ridge. Endpoints are supplied exactly once by the caller.
function crossedEdges(dx, dy, start, end, visit) {
  const columns = Math.abs(dx), rows = Math.abs(dy);
  let column = Math.floor(start * columns + 1e-11) + 1;
  let row = Math.floor(start * rows + 1e-11) + 1;
  while (column < end * columns - 1e-11 || row < end * rows - 1e-11) {
    const across = column < end * columns - 1e-11 ? column / columns : Infinity;
    const down = row < end * rows - 1e-11 ? row / rows : Infinity;
    const f = Math.min(across, down);
    if (across <= f + 1e-12) column++;
    if (down <= f + 1e-12) row++;
    visit(f);
  }
}
function localEdges(g, dx, dy, visit) {
  if (!g.near) return 0;
  const end = Math.min(1, g.nearReach / Math.max(Math.abs(dx), Math.abs(dy)));
  crossedEdges(dx * g.ratio, dy * g.ratio, 0, end, visit);
  if (end < 1 - 1e-12) visit(end);
  return end;
}
function visitRay(g, dx, dy, callback) {
  const distance = g.spacing * Math.hypot(dx, dy);
  callback(0, g.ox, g.oy, g.ground, true);
  if (!distance) return;
  function visit(f) {
    const x = g.ox + dx * f, y = g.oy + dy * f;
    callback(f * distance, x, y, sample(g, x, y), false);
  }
  const end = localEdges(g, dx, dy, visit);
  if (g.native) {
    // Read the source pixels along the entire ray, including the final
    // approach to the summit. Half a pixel avoids skipping a narrow ridge.
    const step = Math.min(g.spacing, g.native.spacing) / 2;
    const steps = Math.ceil((1 - end) * distance / step);
    for (let i = 1; i < steps; i++) visit(end + (1 - end) * i / steps);
  } else crossedEdges(dx, dy, end, 1, visit);
  const x = g.ox + dx,
    y = g.oy + dy;
  callback(distance, x, y, sample(g, x, y), true);
}

function profile(options, x, y, {samples = true} = {}) {
  const g = prepare(options, true),
    dx = x - g.ox,
    dy = y - g.oy;
  const distance = g.spacing * Math.hypot(dx, dy),
    bearing = distance ? (Math.atan2(dx, -dy) / RAD + 360) % 360 : null;
  const z = sample(g, x, y),
    eye = g.ground + g.observerHeight;
  const target = z + g.targetHeight - g.correction * distance * distance;
  const usable = Number.isFinite(distance) && Number.isFinite(eye) && Number.isFinite(target);
  const out = {
    status: UNKNOWN,
    distance,
    bearing,
    elevation: Number.isFinite(z) ? z : null,
    angularElevationDeg: usable && distance ? Math.atan2(target - eye, distance) / RAD : null,
    minimumObserverHeightM: null,
    additionalObserverHeightM: null,
    minimumTargetHeightM: null,
    lowerBoundM: null,
    clearance: null,
    firstIntersectionIndex: -1,
    blockerIndex: -1,
    firstBlocker: null,
    determiningBlocker: null,
    points: [],
    complete: false,
  };
  if (!Number.isFinite(distance)) return out;
  if (distance > g.radius + 1e-7) {
    out.status = OUTSIDE;
    return out;
  }
  if (!usable) return out;
  let minimum = 0,
    targetMinimum = 0,
    incomplete = false,
    index = -1,
    minGap = Infinity;
  let previousDistance = NaN, firstClearDistance = NaN;
  visitRay(g, dx, dy, (d, px, py, h, isEndpoint) => {
    const previous = previousDistance;
    previousDistance = Number.isFinite(h) ? d : NaN;
    index++;
    const f = distance ? d / distance : 0,
      corrected = h - g.correction * d * d;
    const line = eye + f * (target - eye);
    const pt = {
      x: px,
      y: py,
      distance: d,
      elevation: Number.isFinite(h) ? h : null,
      corrected: Number.isFinite(corrected) ? corrected : null,
      sightline: line,
      minimumSightline: null,
    };
    if (samples) out.points.push(pt);
    if (!Number.isFinite(h)) {
      incomplete = true;
      return;
    }
    if (isEndpoint) return;
    const gap = line - corrected;
    minGap = Math.min(minGap, gap);
    // Use differences against the observer's terrain to avoid subtracting
    // nearly equal large absolute elevations after division near the target.
    const required = (corrected - g.ground - f * (target - g.ground)) / (1 - f);
    if (required > minimum) {
      minimum = required;
      out.blockerIndex = index;
      out.determiningBlocker = pt;
    }
    if (isHidden(required, g.observerHeight) && out.firstIntersectionIndex === -1) {
      out.firstIntersectionIndex = index;
      out.firstBlocker = pt;
      firstClearDistance = previous;
    }
    targetMinimum = Math.max(targetMinimum, g.targetHeight - gap / f);
  });
  // The first blocked sample is already inside the slope. Locate its actual
  // intersection with the sampled terrain so the chart and map mark the entry.
  if (Number.isFinite(firstClearDistance) && out.firstBlocker) {
    let clear = firstClearDistance, blocked = out.firstBlocker.distance;
    while (blocked - clear > .05) {
      const d = (clear + blocked) / 2, t = d / distance;
      const z = sample(g, g.ox + dx * t, g.oy + dy * t);
      if (!Number.isFinite(z)) break;
      if (z - g.correction * d * d > eye + t * (target - eye)) blocked = d;
      else clear = d;
    }
    const t = blocked / distance, x = g.ox + dx * t, y = g.oy + dy * t;
    const elevation = sample(g, x, y);
    const crossing = {x, y, distance: blocked, elevation, corrected: elevation - g.correction * blocked * blocked,
      sightline: eye + t * (target - eye), minimumSightline: null};
    if (blocked < out.firstBlocker.distance && Number.isFinite(elevation)) {
      if (samples) {
        out.points.splice(out.firstIntersectionIndex, 0, crossing);
        if (out.blockerIndex >= out.firstIntersectionIndex) out.blockerIndex++;
      }
      out.firstBlocker = crossing;
    }
  }
  out.clearance = Number.isFinite(minGap) ? minGap : null;
  out.lowerBoundM = minimum;
  out.complete = !incomplete;
  out.status = isHidden(minimum, g.observerHeight) ? HIDDEN : incomplete ? UNKNOWN : VISIBLE;
  if (!incomplete) {
    out.minimumObserverHeightM = minimum;
    out.minimumTargetHeightM = targetMinimum;
    out.additionalObserverHeightM =
      out.status === VISIBLE ? 0 : Math.max(0, minimum - g.observerHeight);
    if (samples)
      for (const pt of out.points) {
        const f = distance ? pt.distance / distance : 0;
        pt.minimumSightline = g.ground + minimum + f * (target - g.ground - minimum);
      }
  }
  return out;
}

function horizonRay(options, bearing) {
  const g = prepare(options, true),
    angle = ((bearing % 360) + 360) % 360,
    theta = angle * RAD;
  const result = {bearing: angle, angle: null, distance: null, x: null, y: null, complete: false};
  let best = -Infinity,
    missing = !Number.isFinite(g.ground);
  visitRay(
    g,
    (g.radius * Math.sin(theta)) / g.spacing,
    (-g.radius * Math.cos(theta)) / g.spacing,
    (d, x, y, h) => {
      if (!Number.isFinite(h)) {
        missing = true;
        return;
      }
      if (!d) return;
      const slope = (h - g.ground - g.observerHeight) / d - g.correction * d;
      if (slope > best) {
        best = slope;
        result.distance = d;
        result.x = x;
        result.y = y;
      }
    },
  );
  if (missing || best === -Infinity)
    return {...result, angle: null, distance: null, x: null, y: null};
  result.angle = Math.atan(best) / RAD;
  result.complete = true;
  return result;
}

// The search index is shared by every target in a narrow angular interval.
// Each tree node bounds all uncorrected terrain samples in a range of major-
// axis rows. A whole subtree can be discarded when even its highest terrain
// lies below the candidate sightline. Leaf refinements use the exact target
// direction. Thus angular bins affect speed only, never the returned height.
function scanOctant(g, raster, axes, reach, metrics) {
  const [mx, my, sx, sy] = axes,
    bins = Math.max(1, Math.ceil(reach / 4)),
    side = g.size;
  const majorStride = mx + side * my,
    minorStride = sx + side * sy,
    center = g.oy * side + g.ox;
  const fits = (x, y) => x >= 0 && x < side && y >= 0 && y < side;
  let base = 1;
  while (base <= reach) base *= 2;
  const treeSize = base * 2,
    upper = new Float64Array(treeSize * bins).fill(-Infinity);
  const missing = new Uint8Array(upper.length);
  metrics.indexPeakBytes = Math.max(metrics.indexPeakBytes, upper.byteLength + missing.byteLength);
  for (let b = 0; b < bins; b++) {
    const off = b * treeSize;
    for (let n = 1; n <= reach; n++) {
      const start = Math.floor((n * b) / bins),
        end = Math.ceil((n * (b + 1)) / bins);
      let top = -Infinity,
        hole = false;
      for (let j = start; j <= end; j++) {
        const x = g.ox + n * mx + j * sx,
          y = g.oy + n * my + j * sy;
        const z = fits(x, y) ? g.heights[center + n * majorStride + j * minorStride] : NaN;
        if (Number.isFinite(z)) top = Math.max(top, z);
        else hole = true;
      }
      upper[off + base + n] = top;
      missing[off + base + n] = hole;
    }
    for (let i = base - 1; i > 0; i--) {
      const child = off + 2 * i;
      upper[off + i] = Math.max(upper[child], upper[child + 1]);
      missing[off + i] = missing[child] | missing[child + 1];
    }
  }

  const radiusCells = g.radius / g.spacing,
    radiusSquared = radiusCells * radiusCells;
  let k, j, off, minHeight, incomplete, deltaTarget, curvePerStep;
  function include(n, z) {
    metrics.samplesTested++;
    if (!Number.isFinite(z)) {
      incomplete = true;
      return;
    }
    const required = (k * (z - g.ground - curvePerStep * n * n) - n * deltaTarget) / (k - n);
    if (required > minHeight) minHeight = required;
  }
  function refine(n) {
    const num = n * j, low = Math.floor(num / k), remainder = num % k;
    const i = center + n * majorStride + low * minorStride;
    let z = g.heights[i];
    if (remainder) z += (remainder / k) * (g.heights[i + minorStride] - z);
    include(n, z);
  }
  function search(node, lo, hi) {
    if (lo >= k - 1 || hi <= g.nearReach) return;
    const until = Math.min(hi, k - 2),
      i = off + node;
    // Raw terrain = corrected terrain + curvature term. The minimum straight
    // segment over the interval plus the nearest curvature term is a safe
    // lower bound on the raw obstacle elevation required to beat minHeight.
    const rise = (deltaTarget - minHeight) / k;
    const boundary =
      g.ground + minHeight + rise * (rise >= 0 ? lo : until) + curvePerStep * lo * lo;
    // The bound includes a tiny downward rounding allowance, so close
    // numerical ties reach the exact leaf calculation when necessary.
    const exactLevel = rise === 0 && curvePerStep === 0 && upper[i] - g.ground <= minHeight;
    if ((incomplete || !missing[i]) && (upper[i] < boundary - 1e-9 || exactLevel)) {
      metrics.prunedNodes++;
      return;
    }
    if (lo === hi) {
      refine(lo);
      return;
    }
    const mid = (lo + hi) >> 1;
    search(node * 2 + 1, mid + 1, hi);
    search(node * 2, lo, mid);
  }
  for (k = 1; k <= reach; k++) {
    for (j = 0; j <= k && k * k + j * j <= radiusSquared + 1e-9; j++) {
      const x = g.ox + k * mx + j * sx,
        y = g.oy + k * my + j * sy;
      if (!fits(x, y)) continue;
      const index = y * side + x;
      if (raster.validity[index] !== OUTSIDE) continue;
      const target = k <= g.nearReach ? sample(g, x, y) : g.heights[index];
      if (!Number.isFinite(target) || !Number.isFinite(g.ground)) {
        raster.validity[index] = UNKNOWN;
        continue;
      }
      metrics.targets++;
      metrics.directSampleCount += k - 1;
      minHeight = 0;
      incomplete = false;
      off = Math.min(bins - 1, Math.floor((j * bins) / k)) * treeSize;
      curvePerStep = g.correction * g.spacing * g.spacing * (1 + (j / k) ** 2);
      deltaTarget = target + g.targetHeight - g.ground - curvePerStep * k * k;
      if (g.near) {
        const dx = x - g.ox, dy = y - g.oy;
        localEdges(g, dx, dy, f => {
          include(k * f, sample(g, g.ox + dx * f, g.oy + dy * f));
        });
      }
      // The index handles major-axis crossings. Check the other edges using
      // the same samples as the point profile, skipping shared grid corners.
      if (j !== k) {
        for (let m = 1; m < j; m++) {
          const num = m * k, remainder = num % j;
          if (!remainder || num / j <= g.nearReach) continue;
          metrics.directSampleCount++;
          const i = center + Math.floor(num / j) * majorStride + m * minorStride;
          const a = g.heights[i], b = g.heights[i + majorStride];
          include(num / j, a + (remainder / j) * (b - a));
        }
      }
      if (k - 1 > g.nearReach) {
        // A near-target ridge often supplies the strongest lower bound.
        refine(k - 1);
        if (k > 2) search(1, 0, base - 1);
      }
      if (incomplete) {
        raster.validity[index] = UNKNOWN;
        raster.lowerBoundM[index] = minHeight;
      } else {
        raster.validity[index] = VISIBLE;
        raster.minimumObserverHeightM[index] = minHeight;
      }
    }
  }
}

function heightRaster(options) {
  const g = prepare(options),
    len = g.heights.length;
  const metrics = {
    algorithm: 'angular-interval-max-tree/grid-edges-v2',
    targets: 0,
    directSampleCount: 0,
    samplesTested: 0,
    prunedNodes: 0,
    indexPeakBytes: 0,
    milliseconds: 0,
  };
  const start = performance.now();
  const raster = {
    size: g.size,
    observerX: g.ox,
    observerY: g.oy,
    spacing: g.spacing,
    radius: g.radius,
    minimumObserverHeightM: new Float32Array(len).fill(NaN),
    validity: new Uint8Array(len).fill(OUTSIDE),
    lowerBoundM: new Float32Array(len).fill(NaN),
    metrics,
  };
  const center = g.oy * g.size + g.ox;
  raster.validity[center] = Number.isFinite(g.ground) ? VISIBLE : UNKNOWN;
  if (Number.isFinite(g.ground)) raster.minimumObserverHeightM[center] = 0;
  const reach = Math.min(
    Math.floor(g.radius / g.spacing),
    Math.max(g.ox, g.oy, g.size - 1 - g.ox, g.size - 1 - g.oy),
  );
  if (reach > 0) for (const axes of OCTANTS) scanOctant(g, raster, axes, reach, metrics);
  metrics.milliseconds = performance.now() - start;
  return raster;
}

function statusAt(raster, index, observerHeight) {
  const valid = raster.validity[index];
  if (valid === OUTSIDE) return OUTSIDE;
  if (valid === VISIBLE)
    return isHidden(raster.minimumObserverHeightM[index], observerHeight) ? HIDDEN : VISIBLE;
  const lower = raster.lowerBoundM[index];
  return Number.isFinite(lower) && isHidden(lower, observerHeight) ? HIDDEN : UNKNOWN;
}

function classify(raster, observerHeight) {
  if (!Number.isFinite(observerHeight) || observerHeight < 0)
    throw new RangeError('Invalid observer height');
  const {size, spacing, radius, observerX: ox, observerY: oy} = raster,
    mask = new Uint8Array(size * size).fill(OUTSIDE);
  const counts = [0, 0, 0, 0],
    r = radius / spacing,
    squared = r * r;
  let farthestSquared = -1;
  for (let dy = -Math.floor(r); dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(Math.max(0, squared - dy * dy))),
      y = oy + dy;
    if (y < 0 || y >= size) {
      counts[UNKNOWN] += half * 2 + 1;
      continue;
    }
    const left = Math.max(0, ox - half),
      right = Math.min(size - 1, ox + half);
    counts[UNKNOWN] += half * 2 + 1 - (right - left + 1);
    for (let x = left; x <= right; x++) {
      const index = y * size + x,
        status = statusAt(raster, index, observerHeight);
      mask[index] = status;
      counts[status]++;
      if (status === VISIBLE) farthestSquared = Math.max(farthestSquared, (x - ox) ** 2 + dy ** 2);
    }
  }
  const area = spacing * spacing,
    known = counts[VISIBLE] + counts[HIDDEN],
    total = known + counts[UNKNOWN];
  const fraction = known ? counts[VISIBLE] / known : null,
    farthestVisible = farthestSquared < 0 ? null : Math.sqrt(farthestSquared) * spacing;
  return {
    mask,
    stats: {
      radius,
      visibleArea: area * counts[VISIBLE],
      hiddenArea: area * counts[HIDDEN],
      knownArea: area * known,
      analyzedArea: area * total,
      unknownArea: area * counts[UNKNOWN],
      visibleFraction: fraction,
      visiblePercent: fraction === null ? null : fraction * 100,
      coverageFraction: total ? known / total : null,
      farthestVisible,
      edgeVisible: farthestVisible !== null && farthestVisible >= radius - spacing,
    },
  };
}

export default {profile, horizonRay, heightRaster, classify, statusAt, HEIGHT_TOLERANCE_M};
