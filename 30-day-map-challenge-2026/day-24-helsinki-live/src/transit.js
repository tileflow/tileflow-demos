import {atOffset, matchFix, routePose} from './route-track.js';

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

export function samplePose(bus, time, align) {
  return bus.track
    ? routePose(bus.track, progress(bus, time), align)
    : {coordinate: sample(bus, time), bearing: bus.bearing};
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
    fromOffset: canTrace ? progress(previous, time) : offset,
    started: time,
    duration,
  };
}
