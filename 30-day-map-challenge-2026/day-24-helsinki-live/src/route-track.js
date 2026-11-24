// Coordinates stay in WGS84. Distances and stop offsets are metres along the directed GTFS shape.
const DEG = Math.PI / 180;
const METRES = 6371008.8 * DEG;
const tracks = new WeakMap();

function delta(a, b) {
  return [(b[0] - a[0]) * METRES * Math.cos(((a[1] + b[1]) * DEG) / 2), (b[1] - a[1]) * METRES];
}
export function distance(a, b) {
  return Math.hypot(...delta(a, b));
}
export function heading(a, b) {
  const [east, north] = delta(a, b);
  return (Math.atan2(east, north) / DEG + 360) % 360;
}
export function turn(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}
export function segmentProjection(point, a, b) {
  const [dx, dy] = delta(a, b),
    [px, py] = delta(a, point);
  const t = Math.min(1, Math.max(0, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
  return {t, error: Math.hypot(px - t * dx, py - t * dy)};
}
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function networkTrack(network, shape) {
  return routeTrack(network.shapes[shape], network.roundabouts?.[shape], network.roundaboutGaps?.[shape]);
}

export function routeTrack(line, roundabouts, gaps) {
  if (!line || line.length < 2) return null;
  const cached = tracks.get(line);
  if (cached && (!roundabouts || cached.roundabouts) && (!gaps || cached.gaps)) return cached;
  const offsets = [0],
    bearings = [];
  for (let i = 1; i < line.length; i++) {
    offsets.push(offsets[i - 1] + distance(line[i - 1], line[i]));
    bearings.push(heading(line[i - 1], line[i]));
  }
  // Round only a local corner. The trim limits keep neighbouring bends disjoint and
  // keep the arc within 1.35 m of either leg on a right-angle street corner.
  const bends = [];
  let circle = 0;
  for (let i = 1; i < line.length - 1; i++) {
    while (roundabouts?.[circle] && roundabouts[circle][1] < i) circle++;
    if (roundabouts?.[circle] && roundabouts[circle][0] <= i) continue;
    const angle = turn(bearings[i - 1], bearings[i]);
    if (angle < 10 || angle > 150) continue;
    const incoming = offsets[i] - offsets[i - 1],
      outgoing = offsets[i + 1] - offsets[i];
    const trim = Math.min(8, 0.45 * incoming, 0.45 * outgoing, 5.4 / Math.max(0.6, Math.sin(angle * DEG)));
    if (trim < 0.25) continue;
    bends[i] = {
      start: offsets[i] - trim,
      end: offsets[i] + trim,
      entry: mix(line[i], line[i - 1], trim / incoming),
      exit: mix(line[i], line[i + 1], trim / outgoing),
    };
  }
  const track = {
    line, offsets, bearings, bends, gaps,
    length: offsets.at(-1),
    roundabouts: roundabouts?.map(([a, b]) => [offsets[a], offsets[b]]),
  };
  tracks.set(line, track);
  return track;
}

function sectionAt(track, offset) {
  let l = 1,
    r = track.offsets.length - 1;
  while (l < r) {
    const m = (l + r) >>> 1;
    if (track.offsets[m] < offset) l = m + 1;
    else r = m;
  }
  return l;
}

export function atOffset(track, offset) {
  const i = sectionAt(track, offset),
    start = track.offsets[i - 1],
    end = track.offsets[i];
  return mix(
    track.line[i - 1],
    track.line[i],
    Math.min(1, Math.max(0, (offset - start) / (end - start || 1))),
  );
}

function roadPoint(track, offset, align) {
  const i = sectionAt(track, offset);
  const vertex = track.bends[i] && offset >= track.bends[i].start ? i : i - 1;
  const bend = track.bends[vertex];
  function onRoad(coordinate, bearing) {
    return align ? align({coordinate, bearing}) : {coordinate, bearing};
  }
  if (!bend || offset < bend.start || offset > bend.end)
    return onRoad(atOffset(track, offset), track.bearings[i - 1]);
  // Match the entry and exit to their own street headings. Snapping a diagonal
  // heading at the apex can pick the crossing street or the opposite carriageway.
  const a = onRoad(bend.entry, track.bearings[vertex - 1]);
  const b = onRoad(bend.exit, track.bearings[vertex]);
  const v = track.line[vertex];
  const control = v.map((n, k) => n + (a.coordinate[k] - bend.entry[k] + b.coordinate[k] - bend.exit[k]) / 2);
  const t = (offset - bend.start) / (bend.end - bend.start);
  return {
    coordinate: mix(mix(a.coordinate, control, t), mix(control, b.coordinate, t), t),
    uncertain: Boolean(a.uncertain || b.uncertain),
  };
}

// Sample street corrections at fixed distances along the trip. A tile seam or a
// change of nearest segment then cannot shift a moving bus sideways in one frame.
function laneShift(track, offset, align) {
  let cache = track.laneCache;
  if (!cache || cache.align !== align || cache.version !== align.version) {
    cache = track.laneCache = {align, version: align.version, samples: new Map()};
  }
  if (!cache.samples.has(offset)) {
    const base = roadPoint(track, offset).coordinate;
    const match = roadPoint(track, offset, align);
    cache.samples.set(offset, {
      shift: match.coordinate.map((n, k) => n - base[k]),
      uncertain: match.uncertain,
    });
  }
  return cache.samples.get(offset);
}
function lanePoint(track, offset, align) {
  const base = roadPoint(track, offset).coordinate;
  if (track.gaps?.some(([a, b]) => offset >= a && offset <= b))
    return {coordinate: base, base, uncertain: true, unlocated: true};
  if (!align) return {coordinate: base, base};
  // The surveyed arc already follows the circulating carriageway. Taper the
  // ordinary street correction on the approaches, including while tiles reload.
  let weight = 1;
  for (const [entry, exit] of track.roundabouts ?? []) {
    if (entry > offset + 7) break;
    if (offset >= entry && offset <= exit) return {coordinate: base, base};
    weight = Math.min(weight, Math.max(entry - offset, offset - exit) / 7);
  }
  const start = Math.floor(offset / 10) * 10;
  const end = Math.min(start + 10, track.length);
  const a = laneShift(track, start, align),
    b = laneShift(track, end, align);
  const t = (offset - start) / (end - start || 1);
  const shift = mix(a.shift, b.shift, t * t * (3 - 2 * t));
  const coordinate = base.map((n, k) => n + shift[k] * weight);
  if (a.uncertain || b.uncertain) {
    // A missing road at the next anchor need not hide a bus on a confirmed
    // stretch. Validate its current position against the road at this offset.
    const here = roadPoint(track, offset, align);
    return {coordinate, base, uncertain: here.uncertain || distance(coordinate, here.coordinate) > 2.5};
  }
  return {coordinate, base};
}

export function routePose(track, offset, align) {
  const center = lanePoint(track, offset, align);
  const start = Math.max(0, offset - 6);
  const end = Math.min(track.length, offset + 6);
  // Average directed street headings over the length of the body. A short
  // segment across north must contribute a few degrees, not a full revolution.
  let i = sectionAt(track, start) - 1;
  let direction = track.bearings[i];
  let sum = 0;
  let hasLength = false;
  let ambiguous = false;
  for (; i < track.bearings.length && track.offsets[i] < end; i++) {
    const length = Math.min(end, track.offsets[i + 1]) - Math.max(start, track.offsets[i]);
    if (length <= 0) continue;
    const change = ((track.bearings[i] - (direction % 360) + 900) % 360) - 180;
    if (hasLength && Math.abs(change) > 165) ambiguous = true;
    hasLength = true;
    direction += change;
    sum += direction * length;
  }
  let bearing = end > start ? sum / (end - start) : direction;
  if (align) {
    const rear = lanePoint(track, start, align);
    const front = lanePoint(track, end, align);
    const correction =
      ((heading(rear.coordinate, front.coordinate) - heading(rear.base, front.base) + 540) % 360) - 180;
    // Nearby tile segments refine the centreline, but a lateral lane shift should
    // only partially steer a twelve-metre body at the edge of a junction.
    bearing += 0.5 * Math.max(-16, Math.min(16, correction));
  }
  return {
    coordinate: center.coordinate,
    bearing: ((bearing % 360) + 360) % 360,
    uncertain: center.uncertain || ambiguous,
    ...(center.unlocated && {unlocated: true}),
  };
}

export function routePreview(track, offset, metres, align) {
  const end = Math.min(track.length, offset + metres);
  if (end - offset < 2) return [];
  const points = [];
  // Subdivide locally, also sampling every GTFS vertex so short bends are retained.
  let section = sectionAt(track, offset);
  for (let at = offset; at < end;) {
    const p = lanePoint(track, at, align);
    if (p.uncertain) return points;
    points.push(p.coordinate);
    while (section < track.offsets.length && track.offsets[section] <= at) section++;
    at = Math.min(at + 5, track.offsets[section] ?? end, end);
  }
  const last = lanePoint(track, end, align);
  if (!last.uncertain) points.push(last.coordinate);
  return points;
}

// The two visible parts share the exact point on the directed trip shape.
export function splitShape(track, offset) {
  if (offset <= 0) return {remaining: track.line};
  if (offset >= track.length) return {passed: track.line};
  const i = sectionAt(track, offset);
  const point = atOffset(track, offset);
  return {passed: [...track.line.slice(0, i), point], remaining: [point, ...track.line.slice(i)]};
}

// Clip an ordered section of the route at each unverified at-grade crossing.
export function mappedSections(track, start = 0, end = track.length) {
  const parts = [];
  function append(a, b) {
    if (b <= a) return;
    const inside = track.line.slice(sectionAt(track, a), sectionAt(track, b));
    if (inside.length && track.offsets[sectionAt(track, a)] === a) inside.shift();
    parts.push([atOffset(track, a), ...inside, atOffset(track, b)]);
  }
  for (const [a, b] of track.gaps ?? []) {
    if (a >= end) break;
    append(start, Math.min(end, a));
    start = Math.max(start, b);
  }
  append(start, end);
  return parts;
}

export function shapeAhead(track, offset) {
  return [atOffset(track, offset), ...track.line.slice(sectionAt(track, offset))];
}

export function matchFix(track, pattern, fix, previous) {
  if (!track?.length) return null;
  const gap = previous?.key === fix.key ? fix.timestamp - previous.timestamp : Infinity;
  const prior = gap >= 0 && gap <= 20 && previous.track === track ? previous.offset : null;
  const windows = [];
  if (fix.stopId && pattern?.stopOffsets) {
    const visit =
      fix.stopSequence == null
        ? -1
        : pattern.sequences
          ? pattern.sequences.indexOf(fix.stopSequence)
          : fix.stopSequence - 1;
    const knownVisit = visit >= 0 && pattern.stops[visit] === fix.stopId;
    for (let i = 0; i < pattern.stops.length; i++) {
      if (pattern.stops[i] !== fix.stopId || (knownVisit && i !== visit)) continue;
      const end = pattern.stopOffsets[i];
      // GTFS-RT can retain the last stop briefly after leaving it.
      const start =
        fix.status === 1 && fix.speed != null && fix.speed < 0.6
          ? end - 46
          : (pattern.stopOffsets[i - 1] ?? 0) - 35;
      windows.push([start, end + 45]);
    }
  }
  const moving = fix.speed == null || fix.speed > 1.5;
  let best;
  const reach = Math.max(
    30,
    (Math.max(fix.speed ?? 8, previous?.speed ?? 0) * 1.8 + 5) * Math.min(gap, 20) + 14,
  );
  for (let i = 1; i < track.line.length; i++) {
    const lo = track.offsets[i - 1],
      hi = track.offsets[i];
    if (hi === lo || (prior != null && (hi < prior - 10 || lo > prior + reach))) continue;
    if (windows.length && !windows.some(([a, b]) => hi >= a && lo <= b)) continue;
    const a = track.line[i - 1],
      b = track.line[i];
    if (
      fix.coordinate[0] < Math.min(a[0], b[0]) - 0.0005 ||
      fix.coordinate[0] > Math.max(a[0], b[0]) + 0.0005 ||
      fix.coordinate[1] < Math.min(a[1], b[1]) - 0.00025 ||
      fix.coordinate[1] > Math.max(a[1], b[1]) + 0.00025
    )
      continue;
    const {t, error} = segmentProjection(fix.coordinate, a, b);
    if (error > 22) continue;
    const offset = lo + (hi - lo) * t;
    if (windows.length && !windows.some(([a, b]) => offset >= a && offset <= b)) continue;
    if (prior != null && (offset < prior - 10 || offset > prior + reach)) continue;
    let angle = moving && fix.bearing != null ? turn(fix.bearing, track.bearings[i - 1]) : 0;
    if (angle > 22 && (offset - lo < 9 || hi - offset < 9)) {
      const body = routePose(track, offset);
      if (!body.uncertain) angle = Math.min(angle, turn(fix.bearing, body.bearing));
    }
    if (angle > 86) continue;
    const drift = prior == null ? 0 : Math.abs(offset - prior - (fix.speed ?? 0) * gap);
    const score = error + angle * 0.13 + Math.min(24, drift * 0.23);
    if (!best || score < best.score) best = {offset, score};
  }
  if (!best) return null;
  if (
    prior != null &&
    fix.speed != null &&
    fix.speed < 0.5 &&
    previous.speed != null &&
    previous.speed < 0.5 &&
    Math.abs(best.offset - prior) < 10 &&
    distance(fix.coordinate, atOffset(track, prior)) < 12
  )
    return prior;
  if (prior != null && best.offset < prior + (moving ? 0 : 2.5)) return prior;
  return best.offset;
}
