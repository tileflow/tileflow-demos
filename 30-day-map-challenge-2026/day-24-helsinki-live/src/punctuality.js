// Compare a prediction at one stop with the GTFS arrival for that same visit.
// A missing reference or stale feed always has status 'unknown'.
export function punctualityStatus(delta) {
  if (!Number.isFinite(delta)) return 'unknown';
  if (delta < -60) return 'early';
  if (delta < 120) return 'on-time';
  if (delta < 300) return 'late';
  return 'very-late';
}

const unknown = (call) => ({
  status: 'unknown',
  stopId: call?.id || null,
  eta: null,
  scheduled: null,
  delta: null,
});
const fresh = (stamp, now, age) => Number.isFinite(stamp) && stamp <= now + 5 && now - stamp < age;
const dayMillis = (date) => Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8));
const isSkipped = (call) => call.relationship === 1 || (call.skipped && call.relationship !== 2);

// Earliest and latest legal matches must agree. An update which lists a loop
// more than once can thus be resolved; an isolated ambiguous stop stays unknown.
function alignVisits(pattern, calls) {
  const [stops, sequences] = pattern;
  function sweep(fromEnd) {
    const matches = new Array(calls.length);
    let next = fromEnd ? stops.length : -1;
    for (let k = 0; k < calls.length; k++) {
      const i = fromEnd ? calls.length - 1 - k : k,
        call = calls[i];
      if (call.relationship === 3) continue;
      let index;
      if (Number.isInteger(call.sequence) && call.sequence > 0) {
        index = sequences ? sequences.indexOf(call.sequence) : call.sequence - 1;
      } else if (call.id) {
        index = fromEnd
          ? next > 0
            ? stops.lastIndexOf(call.id, next - 1)
            : -1
          : stops.indexOf(call.id, next + 1);
      } else {
        return null;
      }
      if (
        index < 0 ||
        index >= stops.length ||
        (call.id && stops[index] !== call.id) ||
        (fromEnd ? index >= next : index <= next)
      )
        return null;
      next = index;
      matches[i] = index;
    }
    return matches;
  }
  const first = sweep(false),
    last = sweep(true);
  return first && last ? first.map((slot, i) => (slot === last[i] ? slot : null)) : null;
}

// One trip object is reused by every vehicle/stop view until the next HSL feed.
const cache = new WeakMap();
function resolveTrip(table, trip) {
  if (!table || table.version !== 1 || !trip?.key || trip.ambiguous || (trip.relationship ?? 0) !== 0)
    return null;
  const cached = cache.get(trip);
  if (cached?.table === table) return cached.reference;
  const [day, route, direction, clock] = trip.key.split('|');
  let reference = null;
  if (
    /^\d{8}$/.test(day) &&
    day >= table.first &&
    day <= table.last &&
    /^\d{1,3}:[0-5]\d:[0-5]\d$/.test(clock)
  ) {
    const i = (dayMillis(day) - dayMillis(table.first)) / 86400000;
    const [h, m, s] = clock.split(':').map(Number),
      start = h * 3600 + m * 60 + s;
    const utcDate = new Date(dayMillis(day)).toISOString().slice(0, 10).replaceAll('-', '');
    const runs = utcDate === day ? (table.routes[route]?.[direction]?.[start] ?? []) : [];
    for (const [mask, pattern, profile] of runs) {
      const hex = table.masks[mask],
        nibble = hex.length - 1 - Math.floor(i / 4);
      if (nibble < 0 || !(parseInt(hex[nibble], 16) & (1 << i % 4))) continue;
      const visits = alignVisits(table.patterns[pattern], trip.stops);
      if (!visits) continue;
      if (reference) {
        reference = null;
        break;
      }
      reference = {
        epoch: table.starts[i] + start,
        visits,
        offsets: table.profiles[profile],
        stops: table.patterns[pattern][0],
        sequences: table.patterns[pattern][1],
      };
    }
  }
  cache.set(trip, {table, reference});
  return reference;
}

export function alreadyArrived(call, eta, now) {
  if (call.passed && (!call.departure || call.departure <= now)) return true;
  return Number.isFinite(eta) && eta > 0 && (eta < now - 3 || (call.arrived && eta <= now));
}

function stopResult(reference, trip, call, now) {
  if (!reference || !call || isSkipped(call) || (call.relationship ?? 0) !== 0) return unknown(call);
  const slot = reference.visits[trip.stops.indexOf(call)];
  const offset = Number.isInteger(slot) ? reference.offsets[slot] : null;
  if (!Number.isFinite(offset)) return unknown(call);
  const scheduled = reference.epoch + offset;
  const eta =
    Number.isFinite(call.arrival) && call.arrival > 0
      ? call.arrival
      : Number.isFinite(call.arrivalDelay)
        ? scheduled + call.arrivalDelay
        : null;
  if (eta === null || alreadyArrived(call, eta, now)) return unknown(call);
  const delta = eta - scheduled;
  return {status: punctualityStatus(delta), stopId: call.id || reference.stops[slot], eta, scheduled, delta};
}

const freshTrip = (trip, now, feedTime) =>
  trip && fresh(feedTime, now, 75) && (!trip.timestamp || fresh(trip.timestamp, now, 75));

export function stopPunctuality(table, trip, call, now, feedTime) {
  return freshTrip(trip, now, feedTime)
    ? stopResult(resolveTrip(table, trip), trip, call, now)
    : unknown(call);
}

// HSL describes the current boarding stop or next inbound stop. A fresh
// location cannot be sent backwards by a late update to an earlier visit.
function minimumVisit(reference, bus) {
  if (Number.isInteger(bus.stopSequence) && bus.stopSequence > 0) {
    const slot = reference.sequences ? reference.sequences.indexOf(bus.stopSequence) : bus.stopSequence - 1;
    return slot >= 0 && slot < reference.stops.length && (!bus.stopId || reference.stops[slot] === bus.stopId)
      ? slot
      : null;
  }
  if (!bus.stopId) return 0;
  const slot = reference.stops.indexOf(bus.stopId);
  return slot >= 0 && reference.stops.lastIndexOf(bus.stopId) === slot ? slot : null;
}

export function vehiclePunctuality(table, bus, trip, now, feedTime) {
  const missing = {...unknown(), callIndex: -1};
  if (
    !bus ||
    !fresh(bus.timestamp, now, 30) ||
    (bus.relationship ?? 0) !== 0 ||
    bus.key !== trip?.key ||
    !freshTrip(trip, now, feedTime)
  )
    return missing;
  const reference = resolveTrip(table, trip);
  if (!reference) return missing;
  const minimum = minimumVisit(reference, bus);
  if (minimum === null) return missing;
  for (const [i, call] of trip.stops.entries()) {
    if (isSkipped(call)) continue;
    const slot = reference.visits[i];
    if (Number.isInteger(slot) && slot < minimum) continue;
    const offset = Number.isInteger(slot) ? reference.offsets[slot] : null;
    const eta =
      call.arrival ||
      (Number.isFinite(offset) && Number.isFinite(call.arrivalDelay)
        ? reference.epoch + offset + call.arrivalDelay
        : null);
    if (alreadyArrived(call, eta, now)) {
      const inbound = (bus.status === 0 || bus.status === 2) && (bus.stopId || bus.stopSequence);
      if (
        inbound &&
        slot === minimum &&
        !call.arrived &&
        !(call.passed && (!call.departure || call.departure <= now))
      ) {
        // The fix is still approaching this visit. A stale estimate is not
        // evidence of arrival; require a newer actual report further along.
        const laterActual = trip.stops
          .slice(i + 1)
          .some(
            (s) =>
              (s.arrived && s.arrival >= bus.timestamp && s.arrival <= now) ||
              (s.passed && s.departure >= bus.timestamp && s.departure <= now),
          );
        if (!laterActual) return {...unknown(call), callIndex: i};
      }
      continue;
    }
    return {...stopResult(reference, trip, call, now), callIndex: i};
  }
  return missing;
}
