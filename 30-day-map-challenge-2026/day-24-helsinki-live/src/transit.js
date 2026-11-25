import {atOffset, mappedSections, matchFix, routePose} from './route-track.js';

// HSL joins the two real-time feeds by service date, route, direction and start time.
export function tripKey(trip) {
  return [trip.startDate, trip.routeId, trip.directionId, trip.startTime].join('|');
}

export function choosePattern(route, direction, stopIds = []) {
  const patterns = route?.patterns.filter((p) => p.direction === direction) ?? [];
  if (!stopIds.length || patterns.length < 2) return patterns[0];
  let best = patterns[0],
    bestScore = -Infinity;
  for (const p of patterns) {
    let next = 0,
      hits = 0,
      adjacent = 0;
    for (const stop of stopIds) {
      const i = p.stops.indexOf(stop, next);
      if (i < 0) continue;
      if (i === next) adjacent++;
      hits++;
      next = i + 1;
    }
    const score = hits * 4 + adjacent - Math.abs(p.stops.length - stopIds.length) * 0.015;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export function upcoming(stops, now) {
  return stops.filter((s) => !s.passed && !s.skipped && (s.departure || s.arrival) >= now - 3);
}

export function progress(bus, time) {
  const t = Math.max(0, Math.min(1, (time - bus.started) / bus.duration));
  return bus.fromOffset + (bus.offset - bus.fromOffset) * t;
}

// Only consecutive, route-matched fixes contribute to a tail. Keep the observation just
// before the cutoff so the tail retreats continuously when a vehicle stops.
const trailSeconds = 60;
const trailExpiry = 32;
function recordOffsets(previous, timestamp, offset) {
  if (offset == null) return [];
  const fixes = previous ? previous.recentOffsets.slice() : [];
  if (fixes.at(-1)?.[0] === timestamp) fixes.pop();
  fixes.push([timestamp, offset]);
  while (fixes.length > 1 && fixes[1][0] <= timestamp - trailSeconds) fixes.shift();
  return fixes;
}

export function recentTrail(bus, time, clockSeconds) {
  const fixes = bus.recentOffsets;
  const age = Math.max(0, clockSeconds - bus.timestamp);
  if (!bus.track || fixes.length < 2 || age >= trailExpiry) return [];
  const cutoff = bus.timestamp - trailSeconds * (1 - age / trailExpiry);
  const end = progress(bus, time);
  let i = 0;
  while (i + 1 < fixes.length && fixes[i + 1][0] <= cutoff) i++;
  const [stamp, offset] = fixes[i];
  let start = offset;
  if (stamp < cutoff && i + 1 < fixes.length) {
    const [nextStamp, nextOffset] = fixes[i + 1];
    start += ((cutoff - stamp) / (nextStamp - stamp)) * (nextOffset - offset);
  }
  start = Math.max(start, end - 800);
  for (const [entry, exit] of bus.track.gaps ?? []) {
    if (entry > end) break;
    if (end <= exit) return [];
    start = Math.max(start, exit);
  }
  return end - start >= 3 ? mappedSections(bus.track, start, end)[0] : [];
}

export function samplePose(bus, time, align) {
  if (bus.track) {
    const pose = routePose(bus.track, progress(bus, time), align);
    if (!pose.unlocated) return pose;
    return {coordinate: bus.rawCoordinate, bearing: bus.bearing, uncertain: true};
  }
  return {coordinate: bus.coordinate, bearing: bus.bearing};
}

export function sample(bus, time) {
  if (bus.track) return atOffset(bus.track, progress(bus, time));
  return bus.coordinate;
}

export function move(previous, update, time, road) {
  const same = previous?.key === update.key;
  if (
    same &&
    (update.timestamp < previous.timestamp ||
      (update.timestamp === previous.timestamp && (!update.precise || previous.precise)))
  )
    return previous;
  const gap = same ? update.timestamp - previous.timestamp : Infinity;
  const offset = matchFix(road?.track, road?.pattern, update, previous);
  const track = offset != null ? road.track : null;
  const canTrace = track && same && previous.track === track && gap <= 12;
  const rawCoordinate = update.coordinate,
    bearing = update.bearing ?? previous?.bearing ?? 0;
  // Reacquire immediately after a gap or diversion; never draw a straight line through a block.
  const coordinate = track ? atOffset(track, offset) : rawCoordinate;
  // GPS seconds are rounded. Pace the animation against delivery times, while
  // allowing a higher-frequency fix for the same instant to refine its endpoint.
  let duration = 100;
  if (canTrace) {
    const elapsed = time - previous.started;
    if (gap === 0) duration = Math.max(100, previous.duration - elapsed);
    else {
      const reported = gap * 1000;
      const cadence = Math.abs(elapsed - reported) < 1100 ? elapsed : reported;
      duration = Math.min(6000, Math.max(100, cadence));
    }
  }
  return {
    ...update,
    rawCoordinate,
    coordinate,
    bearing,
    track,
    offset,
    recentOffsets: recordOffsets(canTrace ? previous : null, update.timestamp, offset),
    fromOffset: canTrace ? progress(previous, time) : offset,
    started: time,
    duration,
  };
}
